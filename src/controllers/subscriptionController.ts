import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { PAID_TIERS, PLAN_PRICES, isOwnStorageUrl, toDate, cleanString } from '../utils/teacherUtils';

const PERIOD_DAYS = 30;

// 🔒 Teacher submits a bank slip. The teacher ID comes from the verified token,
// never from the request body.
export const submitManualPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.uid;
    const { tier, receiptUrl } = req.body || {};

    if (!PAID_TIERS.includes(tier)) {
      res.status(400).json({ success: false, message: 'Please choose a valid plan.' });
      return;
    }

    if (!receiptUrl || !isOwnStorageUrl(receiptUrl, 'receipts', teacherId)) {
      res.status(400).json({ success: false, message: 'Please upload your bank slip again.' });
      return;
    }

    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    if (!teacherDoc.exists) {
      res.status(404).json({ success: false, message: 'Teacher profile not found.' });
      return;
    }

    // One pending slip at a time stops the admin queue being flooded
    const existing = await db
      .collection('subscriptions')
      .where('teacher_id', '==', teacherId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!existing.empty) {
      res.status(409).json({ success: false, message: 'You already have a payment waiting for review.' });
      return;
    }

    await db.collection('subscriptions').add({
      teacher_id: teacherId,
      tier,
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

// 🔒 Admin only
export const getPendingSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('subscriptions').where('status', '==', 'pending').get();

    const pending = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const subData = doc.data();
        let teacherName = 'Unknown Teacher';
        if (subData.teacher_id) {
          const teacherDoc = await db.collection('teachers').doc(subData.teacher_id).get();
          if (teacherDoc.exists) teacherName = teacherDoc.data()?.name || 'Unnamed Teacher';
        }
        return {
          id: doc.id,
          teacher_id: subData.teacher_id || '',
          teacher_name: teacherName,
          tier: subData.tier || 'Normal',
          receipt_url: subData.receipt_url || '',
          date: toDate(subData.created_at)?.toLocaleDateString() || 'Recent',
        };
      })
    );

    res.status(200).json({ success: true, data: pending });
  } catch (error) {
    console.error('❌ Error fetching pending subscriptions:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin only. Runs in a transaction so the same slip can't be approved twice.
export const approveSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const subRef = db.collection('subscriptions').doc(id);

    const result = await db.runTransaction(async (tx) => {
      const subDoc = await tx.get(subRef);
      if (!subDoc.exists) return { status: 404, message: 'Subscription not found.' };

      const subData = subDoc.data()!;
      if (subData.status !== 'pending') return { status: 409, message: `This payment is already ${subData.status}.` };
      if (!PAID_TIERS.includes(subData.tier)) return { status: 400, message: 'Invalid tier on this payment.' };

      const teacherRef = db.collection('teachers').doc(subData.teacher_id);
      const teacherDoc = await tx.get(teacherRef);
      if (!teacherDoc.exists) return { status: 404, message: 'Teacher not found.' };

      // Early renewal: extend from the current end date instead of losing remaining days
      const now = new Date();
      const currentEnd = toDate(teacherDoc.data()?.subscription_ends_at);
      const periodStart = currentEnd && currentEnd > now ? currentEnd : now;
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + PERIOD_DAYS);

      tx.update(subRef, {
        status: 'active',
        period_start: periodStart,
        period_end: periodEnd,
        approved_at: now,
        amount: PLAN_PRICES[subData.tier] || 0, // price at the time of approval
      });
      tx.update(teacherRef, { subscription_tier: subData.tier, subscription_ends_at: periodEnd });
      return { status: 200, message: 'Subscription activated successfully.' };
    });

    res.status(result.status).json({ success: result.status === 200, message: result.message });
  } catch (error) {
    console.error('❌ Error approving subscription:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin only
export const rejectSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const reason = cleanString(req.body?.reason, 500) || 'Invalid slip';
    const subRef = db.collection('subscriptions').doc(id);

    const subDoc = await subRef.get();
    if (!subDoc.exists) {
      res.status(404).json({ success: false, message: 'Subscription not found.' });
      return;
    }
    if (subDoc.data()?.status !== 'pending') {
      res.status(409).json({ success: false, message: 'Only pending payments can be rejected.' });
      return;
    }

    await subRef.update({ status: 'rejected', rejection_reason: reason, rejected_at: new Date() });
    res.status(200).json({ success: true, message: 'Subscription rejected.' });
  } catch (error) {
    console.error('❌ Error rejecting subscription:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
