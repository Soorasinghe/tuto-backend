import { Request, Response } from 'express';
import { db } from '../config/firebase';

export const submitManualPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { teacherId, tier, receiptUrl } = req.body;

    if (!teacherId || !tier || !receiptUrl) {
      res.status(400).json({ success: false, message: 'Missing required fields.' });
      return;
    }

    await db.collection('subscriptions').add({
      teacher_id: teacherId,
      tier: tier,
      status: 'pending',
      receipt_url: receiptUrl,
      created_at: new Date(),
    });

    res.status(200).json({ success: true, message: 'Payment submitted for review.' });
  } catch (error) {
    console.error('❌ Error submitting payment:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getPendingSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('subscriptions').where('status', '==', 'pending').get();
    const pending: any[] = [];
    
    for (const doc of snapshot.docs) {
      const subData = doc.data();
      
      let teacherName = "Unknown Teacher";
      if (subData.teacher_id) {
        const teacherDoc = await db.collection('teachers').doc(subData.teacher_id).get();
        if (teacherDoc.exists) {
          teacherName = teacherDoc.data()?.name || "Unnamed Teacher";
        }
      }

      let displayDate = "Recent";
      if (subData.created_at) {
        if (typeof subData.created_at.toDate === 'function') {
          displayDate = subData.created_at.toDate().toLocaleDateString();
        } else if (subData.created_at._seconds) {
          displayDate = new Date(subData.created_at._seconds * 1000).toLocaleDateString();
        }
      }

      pending.push({
        id: doc.id,
        teacher_id: subData.teacher_id || "",
        teacher_name: teacherName,
        tier: subData.tier || "Normal",
        receipt_url: subData.receipt_url || "",
        date: displayDate,
      });
    }

    res.status(200).json({ success: true, data: pending });
  } catch (error) {
    console.error('❌ Error fetching pending subscriptions:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: String(error) });
  }
};

export const approveSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    const subRef = db.collection('subscriptions').doc(id);
    const subDoc = await subRef.get();
    
    if (!subDoc.exists) {
      res.status(404).json({ success: false, message: 'Subscription not found.' });
      return;
    }

    const subData = subDoc.data();
    const teacherId = subData?.teacher_id;
    const tier = subData?.tier;

    // 🔥 FIX: Set the exact 30-day window
    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    await subRef.update({
      status: 'active',
      period_start: periodStart,
      period_end: periodEnd
    });

    // Write the new expiry date directly to the Teacher document
    await db.collection('teachers').doc(teacherId).update({
      subscription_tier: tier,
      subscription_ends_at: periodEnd 
    });

    res.status(200).json({ success: true, message: 'Subscription activated successfully.' });
  } catch (error) {
    console.error('❌ Error approving subscription:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔥 NEW: Reject a payment slip
export const rejectSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    await db.collection('subscriptions').doc(id).update({
      status: 'rejected',
      rejection_reason: reason || 'Invalid slip'
    });

    res.status(200).json({ success: true, message: 'Subscription rejected.' });
  } catch (error) {
    console.error('❌ Error rejecting subscription:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};