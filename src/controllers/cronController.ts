import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { evaluateSubscriptionTier } from '../utils/teacherUtils';

export const runDailyDowngrades = async (req: Request, res: Response): Promise<void> => {
  // 1. SECURITY: Only our scheduled job may trigger this. Fails CLOSED if the
  //    CRON_SECRET env var is missing (no hardcoded fallback).
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.authorization === `Bearer ${secret}`;   // Vercel Cron
  const header = req.headers['x-cron-secret'] === secret;            // manual / other schedulers
  if (!secret || (!bearer && !header)) {
    res.status(403).json({ success: false, message: 'Unauthorized Cron Request' });
    return;
  }

  try {
    // 2. Fetch all teachers currently stored as Premium or Normal
    const paidTeachers = await db.collection('teachers')
      .where('subscription_tier', 'in', ['Premium', 'Normal'])
      .get();

    // 3. Same rule as the API uses everywhere (trial OR paid period still running)
    const toDowngrade = paidTeachers.docs.filter((doc) => evaluateSubscriptionTier(doc.data()) === 'Basic');

    // Firestore batches are limited to 500 writes
    for (let i = 0; i < toDowngrade.length; i += 450) {
      const batch = db.batch();
      toDowngrade.slice(i, i + 450).forEach((doc) => batch.update(doc.ref, { subscription_tier: 'Basic' }));
      await batch.commit();
    }

    console.log(`🧹 Cron Job Complete: Downgraded ${toDowngrade.length} teachers.`);
    res.status(200).json({ success: true, downgradedCount: toDowngrade.length });
  } catch (error) {
    console.error('❌ Error running daily downgrades:', error);
    res.status(500).json({ success: false, message: 'Cron Job Failed' });
  }
};
