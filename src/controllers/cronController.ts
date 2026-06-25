import { Request, Response } from 'express';
import { db } from '../config/firebase';

export const runDailyDowngrades = async (req: Request, res: Response): Promise<void> => {
  // 1. SECURITY: Ensure only our automated cron job can trigger this
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret !== (process.env.CRON_SECRET || 'tuto_super_secret_cron_key_2026')) {
    res.status(403).json({ success: false, message: 'Unauthorized Cron Request' });
    return;
  }

  try {
    const now = new Date();
    const batch = db.batch();
    let downgradedCount = 0;

    // 2. Fetch all teachers who are currently Premium or Normal
    const premiumTeachers = await db.collection('teachers')
      .where('subscription_tier', 'in', ['Premium', 'Normal'])
      .get();

    for (const doc of premiumTeachers.docs) {
      const data = doc.data();
      const teacherId = doc.id;
      let shouldDowngrade = true; // Assume they need a downgrade unless proven otherwise

      // Check 1: Is their 7-day trial still active?
      if (data.trial_ends_at) {
        const trialEnd = typeof data.trial_ends_at.toDate === 'function' 
          ? data.trial_ends_at.toDate() 
          : new Date(data.trial_ends_at._seconds * 1000);
        
        if (trialEnd > now) {
          shouldDowngrade = false; // Trial is still active!
        }
      }

      // Check 2: If trial is expired, do they have an active paid subscription?
      if (shouldDowngrade) {
        const activeSubs = await db.collection('subscriptions')
          .where('teacher_id', '==', teacherId)
          .where('status', '==', 'active')
          .get();

        activeSubs.forEach(subDoc => {
          const subData = subDoc.data();
          if (subData.period_end) {
             const periodEnd = typeof subData.period_end.toDate === 'function' 
              ? subData.period_end.toDate() 
              : new Date(subData.period_end._seconds * 1000);
             
             if (periodEnd > now) {
               shouldDowngrade = false; // They have a valid, unexpired manual payment!
             }
          }
        });
      }

      // 3. Apply the Downgrade if both checks failed
      if (shouldDowngrade) {
        batch.update(doc.ref, { subscription_tier: 'Basic' });
        downgradedCount++;
      }
    }

    // Commit all downgrades to the database simultaneously
    if (downgradedCount > 0) {
      await batch.commit();
    }

    console.log(`🧹 Cron Job Complete: Downgraded ${downgradedCount} teachers.`);
    res.status(200).json({ success: true, downgradedCount });

  } catch (error) {
    console.error('❌ Error running daily downgrades:', error);
    res.status(500).json({ success: false, message: 'Cron Job Failed' });
  }
};