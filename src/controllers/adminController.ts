import { Request, Response } from 'express';
import { db } from '../config/firebase'; 

export const getAdminStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('teachers').get();
    
    let totalTeachers = 0;
    let premiumCount = 0;
    let pendingVerifications = 0;

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      totalTeachers++;
      
      if (data.subscription_tier === 'Premium' || data.subscription_tier === 'Normal') {
        premiumCount++;
      }
      
      if (!data.is_verified && data.verification_status === 'Pending') {
        pendingVerifications++;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalTeachers,
        premiumCount,
        pendingVerifications,
        monthlyRevenue: "LKR 0" 
      }
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
    const { subscription_tier, is_verified } = req.body;

    const updateData: any = {};
    if (subscription_tier) updateData.subscription_tier = subscription_tier;
    
    if (typeof is_verified === 'boolean') {
      updateData.is_verified = is_verified;
      if (!is_verified) {
        updateData.verification_status = 'Unverified';
      }
    }

    await db.collection('teachers').doc(id).update(updateData);

    res.status(200).json({ success: true, message: 'Teacher updated successfully' });
  } catch (error) {
    console.error('❌ Error updating teacher manually:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};