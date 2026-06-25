import { Request, Response } from 'express';
import { db } from '../config/firebase';

export const searchTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, level, province, district, city, village } = req.query;

    // 🔥 1. DATABASE-LEVEL FILTERING (The Heavy Lifting)
    // Always filter verified teachers at the database level so we don't download inactive accounts.
    let query: any = db.collection('teachers').where('is_verified', '==', true);

    // Firestore only allows ONE 'array-contains' per query. 
    // Subject is usually the most restrictive, so we let the database handle it.
    if (subject) {
      query = query.where('subjects', 'array-contains', subject as string);
    }

    const snapshot = await query.get();
    
    let teachers: any[] = [];
    snapshot.forEach((doc: any) => {
      teachers.push({ id: doc.id, ...doc.data() });
    });

    // 🚀 2. MEMORY-LEVEL FILTERING (The Fine Tuning)
    // We are now only filtering a tiny subset of teachers, so memory usage is virtually zero.
    
    // Apply Academic Level Filter
    if (level) {
      teachers = teachers.filter(t => t.academicLevels && t.academicLevels.includes(level as string));
    }

    // Apply Hierarchical Location Filters
    if (village) {
      teachers = teachers.filter(t => t.locations?.some((loc: any) => loc.village === village));
    } else if (city) {
      teachers = teachers.filter(t => t.locations?.some((loc: any) => loc.city === city));
    } else if (district) {
      teachers = teachers.filter(t => t.locations?.some((loc: any) => loc.district === district));
    } else if (province) {
      teachers = teachers.filter(t => t.locations?.some((loc: any) => loc.province === province));
    }

    // Apply Sorting by Tier
    const tierWeights: Record<string, number> = {
      'Premium': 3,
      'Normal': 2,
      'Basic': 1
    };

    teachers.sort((a, b) => {
      const weightA = tierWeights[a.subscription_tier || 'Basic'];
      const weightB = tierWeights[b.subscription_tier || 'Basic'];
      return weightB - weightA; 
    });

    res.status(200).json({ success: true, data: teachers });
  } catch (error) {
    console.error('❌ Error searching teachers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


export const getTrendingTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🔥 PRODUCTION FIX: Force the database to do all the sorting and limiting.
    // This prevents downloading hundreds of Premium teachers just to show 5.
    const snapshot = await db.collection('teachers')
      .where('is_verified', '==', true)
      .where('subscription_tier', '==', 'Premium') 
      .orderBy('profile_views', 'desc') // Database sorts it!
      .limit(5)                         // Database only sends exactly 5!
      .get();
      
    const trending: any[] = [];
    snapshot.forEach((doc: any) => {
      trending.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({ success: true, data: trending });
  } catch (error: any) {
    console.error('❌ Error fetching trending:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};