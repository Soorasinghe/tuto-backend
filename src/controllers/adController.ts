import { Request, Response } from 'express';
import { db } from '../config/firebase';

// Admin uploads or updates an ad
export const createAd = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🔥 NEW: Extract the placement from the request body
    const { title, imageUrl, linkUrl, isActive, placement } = req.body;
    
    // Default to 'Top' if an older frontend version sends a request without it
    const adPlacement = placement || 'Top';

    if (!imageUrl || !linkUrl) {
      res.status(400).json({ success: false, message: 'Image URL and Link URL are required.' });
      return;
    }

    // 🔥 FIXED: Only deactivate ads that share the SAME placement
    if (isActive) {
      const activeAds = await db.collection('ads').where('isActive', '==', true).get();
      const batch = db.batch();
      
      activeAds.forEach((doc: any) => {
        const existingData = doc.data();
        // Check if the active ad is in the exact same slot as the new one we are uploading
        // (Treat missing placements as 'Top' for backward compatibility)
        const existingPlacement = existingData.placement || 'Top';
        
        if (existingPlacement === adPlacement) {
          batch.update(doc.ref, { isActive: false });
        }
      });
      await batch.commit();
    }

    await db.collection('ads').add({
      title: title || 'Premium Sponsor',
      imageUrl,
      linkUrl,
      isActive: isActive || false,
      placement: adPlacement, // 🔥 NEW: Save placement to the database
      created_at: new Date()
    });

    res.status(200).json({ success: true, message: `New ${adPlacement} ad campaign launched successfully!` });
  } catch (error) {
    console.error('❌ Error creating ad:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// Admin fetches all ads to manage them (Admin Panel)
export const getAllAds = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('ads').orderBy('created_at', 'desc').get();
    const ads: any[] = [];
    
    snapshot.forEach((doc: any) => {
      ads.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({ success: true, data: ads });
  } catch (error) {
    console.error('❌ Error fetching ads:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// Student Homepage fetches ALL currently active ads across the platform
export const getActiveAd = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🔥 FIXED: Removed .limit(1) so it fetches both the Top and Sidebar active ads
    const snapshot = await db.collection('ads').where('isActive', '==', true).get();
    
    if (snapshot.empty) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const activeAds: any[] = [];
    snapshot.forEach((doc: any) => {
      activeAds.push({ id: doc.id, ...doc.data() });
    });

    // Return the full array of active ads so the frontend can map them
    res.status(200).json({ success: true, data: activeAds });
  } catch (error) {
    console.error('❌ Error fetching active ads:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};