import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { toDate, evaluateSubscriptionTier, PLAN_PRICES } from '../utils/teacherUtils';

export const getAdminStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();

    // Start of the current month in Sri Lanka time (UTC+05:30), as a UTC Date
    const SL_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const slNow = new Date(now.getTime() + SL_OFFSET_MS);
    const monthStart = new Date(Date.UTC(slNow.getUTCFullYear(), slNow.getUTCMonth(), 1) - SL_OFFSET_MS);

    const [teachersSnap, approvedThisMonth] = await Promise.all([
      db.collection('teachers').get(),
      db.collection('subscriptions').where('approved_at', '>=', monthStart).get(),
    ]);

    let totalTeachers = 0;
    let premiumCount = 0; // actually paying (paid period still running)
    let trialCount = 0;   // on a running free trial, not paid yet
    let pendingVerifications = 0;

    teachersSnap.forEach((doc: any) => {
      const data = doc.data();
      if (data.role === 'admin') return;
      totalTeachers++;

      // Use expiry dates, not the stored tier, so lapsed plans don't count
      if (evaluateSubscriptionTier(data) !== 'Basic') {
        const paidEnd = toDate(data.subscription_ends_at);
        if (paidEnd && paidEnd > now) premiumCount++;
        else trialCount++;
      }

      if (!data.is_verified && data.verification_status === 'Pending') {
        pendingVerifications++;
      }
    });

    let revenue = 0;
    approvedThisMonth.forEach((doc: any) => {
      const sub = doc.data();
      if (sub.status !== 'active') return;
      // Older approvals have no stored amount — fall back to the plan price
      revenue += typeof sub.amount === 'number' ? sub.amount : PLAN_PRICES[sub.tier] || 0;
    });

    res.status(200).json({
      success: true,
      data: {
        totalTeachers,
        premiumCount,
        trialCount,
        pendingVerifications,
        monthlyRevenue: `LKR ${revenue.toLocaleString('en-US')}`,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching admin stats:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getPendingTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('teachers')
      .where('is_verified', '==', false)
      .where('verification_status', '==', 'Pending')
      .get();

    const pendingList: any[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      pendingList.push({
        id: doc.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        nic_url: data.nic_url || '',
        cert_url: data.cert_url || ''
      });
    });

    res.status(200).json({ success: true, data: pendingList });
  } catch (error) {
    console.error('❌ Error fetching pending verification queue:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const approveTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string; 
    
    await db.collection('teachers').doc(id).update({
      is_verified: true,
      verification_status: 'Approved' 
    });
    
    res.status(200).json({ success: true, message: 'Teacher verified successfully' });
  } catch (error) {
    console.error('❌ Error approving teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getAllTeachersForAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('teachers').orderBy('name', 'asc').get();
    const teachers: any[] = [];

    // 🔥 FIX: Safe Date Parser to prevent N/A errors on the frontend
    const safeDate = (dateVal: any) => {
      if (!dateVal) return null;
      if (dateVal.toDate) return dateVal.toDate().toISOString();
      if (dateVal._seconds) return new Date(dateVal._seconds * 1000).toISOString();
      return new Date(dateVal).toISOString();
    };

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      teachers.push({
        id: doc.id,
        name: data.name || "Unnamed Teacher",
        email: data.email || "No Email",
        phone: data.phone || "No Phone",
        subscription_tier: data.subscription_tier || "Basic",
        is_verified: data.is_verified || false,
        subjects: data.subjects || [],
        // Convert to safe standard strings
        created_at: safeDate(data.created_at),
        trial_ends_at: safeDate(data.trial_ends_at),
        subscription_ends_at: safeDate(data.subscription_ends_at) 
      });
    });

    res.status(200).json({ success: true, data: teachers });
  } catch (error) {
    console.error('❌ Error fetching all teachers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateTeacherStatusManually = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { subscription_tier, is_verified } = req.body || {};

    const updateData: any = {};

    if (subscription_tier !== undefined) {
      if (!['Basic', 'Normal', 'Premium'].includes(subscription_tier)) {
        res.status(400).json({ success: false, message: 'Invalid subscription tier.' });
        return;
      }
      updateData.subscription_tier = subscription_tier;

      // A paid tier needs an end date, otherwise the expiry check instantly
      // drops the teacher back to Basic. Give a manual upgrade 30 days.
      if (subscription_tier !== 'Basic') {
        const teacherDoc = await db.collection('teachers').doc(id).get();
        const currentEnd = toDate(teacherDoc.data()?.subscription_ends_at);
        if (!currentEnd || currentEnd <= new Date()) {
          const end = new Date();
          end.setDate(end.getDate() + 30);
          updateData.subscription_ends_at = end;
        }
      }
    }

    if (typeof is_verified === 'boolean') {
      updateData.is_verified = is_verified;
      updateData.verification_status = is_verified ? 'Approved' : 'Unverified';
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, message: 'Nothing to update.' });
      return;
    }

    await db.collection('teachers').doc(id).update(updateData);

    res.status(200).json({ success: true, message: 'Teacher updated successfully' });
  } catch (error) {
    console.error('❌ Error updating teacher manually:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
