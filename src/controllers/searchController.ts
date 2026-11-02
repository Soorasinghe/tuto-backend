import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { toPublicCard } from '../utils/teacherUtils';

// 🔒 Both endpoints are public, so they return ONLY card fields via toPublicCard().
// Never spread doc.data() here — it would leak phone numbers, emails and NIC scans.

const tierWeights: Record<string, number> = { Premium: 3, Normal: 2, Basic: 1 };

export const searchTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, level, province, district, city, village } = req.query;

    // Only verified teachers are searchable
    let query: FirebaseFirestore.Query = db.collection('teachers').where('is_verified', '==', true);

    // Firestore allows only ONE 'array-contains' per query, so subject goes to the DB
    if (typeof subject === 'string' && subject) {
      query = query.where('subjects', 'array-contains', subject);
    }

    const snapshot = await query.get();

    // Tier is evaluated from expiry dates here, so lapsed subscriptions
    // don't keep ranking at the top while waiting for the daily cron.
    let teachers = snapshot.docs.map((doc) => toPublicCard(doc.id, doc.data()));

    if (typeof level === 'string' && level) {
      teachers = teachers.filter((t) => t.academicLevels.includes(level));
    }

    if (village) {
      teachers = teachers.filter((t) => t.locations.some((loc: any) => loc.village === village));
    } else if (city) {
      teachers = teachers.filter((t) => t.locations.some((loc: any) => loc.city === city));
    } else if (district) {
      teachers = teachers.filter((t) => t.locations.some((loc: any) => loc.district === district));
    } else if (province) {
      teachers = teachers.filter((t) => t.locations.some((loc: any) => loc.province === province));
    }

    teachers.sort((a, b) => (tierWeights[b.subscription_tier] || 1) - (tierWeights[a.subscription_tier] || 1));

    res.status(200).json({ success: true, data: teachers });
  } catch (error) {
    console.error('❌ Error searching teachers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getTrendingTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db
      .collection('teachers')
      .where('is_verified', '==', true)
      .where('subscription_tier', '==', 'Premium')
      .orderBy('profile_views', 'desc')
      .limit(10)
      .get();

    // Drop anyone whose Premium has actually expired, then keep the top 5
    const trending = snapshot.docs
      .map((doc) => toPublicCard(doc.id, doc.data()))
      .filter((t) => t.subscription_tier === 'Premium')
      .slice(0, 5);

    res.status(200).json({ success: true, data: trending });
  } catch (error: any) {
    console.error('❌ Error fetching trending:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
