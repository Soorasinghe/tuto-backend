import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore'; 
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export const syncTeacherProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
    const email = req.user?.email || '';
    const name = req.user?.name || 'New Tutor';

    if (!uid) {
      res.status(401).json({ success: false, message: 'Unauthorized: No valid user token.' });
      return;
    }

    const teacherRef = db.collection('teachers').doc(uid);
    const teacherDoc = await teacherRef.get();

    if (!teacherDoc.exists) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 7);

      const newProfile = {
        name,
        phone: '', 
        email,
        bio: '',
        role: 'teacher',
        subscription_tier: 'Premium', 
        is_verified: false,
        verification_status: 'Pending', 
        rejection_reason: '',           
        trial_ends_at: trialEndsAt,
        subscription_ends_at: null, 
        created_at: FieldValue.serverTimestamp(),
        institutes_attached: [],
        gallery_urls: [],
        profile_pic_url: req.user?.picture || '', 
        cover_url: '', 
        video_intro_url: '',
        profile_views: 0 
      };
      
      await teacherRef.set(newProfile);
      res.status(201).json({ success: true, message: 'Profile created!', data: newProfile });
      return;
    }

    res.status(200).json({ success: true, message: 'Profile already exists.', data: teacherDoc.data() });
  } catch (error) {
    console.error('❌ Error syncing teacher profile:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const registerTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, name, phone, email, bio } = req.body;

    if (!name || !phone) {
      res.status(400).json({ success: false, message: 'Name and phone number are required.' });
      return;
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const newTeacher = {
      name,
      phone,
      email: email || '',
      bio: bio || '',
      subscription_tier: 'Premium', 
      is_verified: false,
      verification_status: 'Pending', 
      rejection_reason: '',           
      trial_ends_at: trialEndsAt,
      subscription_ends_at: null, 
      created_at: new Date(),
      institutes_attached: [],
      gallery_urls: [],
      profile_pic_url: '',
      cover_url: '', 
      video_intro_url: '',
      profile_views: 0 
    };

    if (id) {
      await db.collection('teachers').doc(id).set(newTeacher);
      res.status(201).json({ success: true, teacherId: id, data: newTeacher });
    } else {
      const docRef = await db.collection('teachers').add(newTeacher);
      res.status(201).json({ success: true, teacherId: docRef.id, data: newTeacher });
    }
  } catch (error) {
    console.error('❌ Error registering teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const unlockContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const { studentName, grade } = req.body;

    if (!studentName || !grade) {
      res.status(400).json({ success: false, message: 'Student name and grade are required.' });
      return;
    }

    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    
    if (!teacherDoc.exists) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }

    const teacherData = teacherDoc.data();

    await db.collection('leads').add({
      teacher_id: teacherId,
      teacher_name: teacherData?.name,
      student_name: studentName,
      grade: grade,
      unlocked_at: new Date(),
      created_at: new Date(), 
    });

    res.status(200).json({ success: true, phone: teacherData?.phone });
  } catch (error) {
    console.error('❌ Error unlocking contact:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔥 HELPER: Checks expiry dates and returns the valid tier
const evaluateSubscriptionTier = (data: any): string => {
  let currentTier = data.subscription_tier || 'Basic';
  
  if (currentTier === 'Premium' || currentTier === 'Normal') {
    let isExpired = false;
    
    if (data.subscription_ends_at) {
      const exp = data.subscription_ends_at.toDate ? data.subscription_ends_at.toDate() : new Date(data.subscription_ends_at._seconds * 1000);
      if (new Date() > exp) isExpired = true;
    } else if (data.trial_ends_at) {
      const exp = data.trial_ends_at.toDate ? data.trial_ends_at.toDate() : new Date(data.trial_ends_at._seconds * 1000);
      if (new Date() > exp) isExpired = true;
    }

    if (isExpired) currentTier = 'Basic';
  }
  return currentTier;
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    
    const { 
      name, phone, bio, 
      subjects, locations, classModes, profile_pic_url, cover_url,
      nic_url, cert_url, 
      academicLevels, institutes, teachingMediums, 
      qualifications, trackRecord, videoUrl, gallery_urls
    } = req.body;

    if (!teacherId) {
      res.status(400).json({ success: false, message: 'Teacher ID is required.' });
      return;
    }

    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    if (!teacherDoc.exists) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }

    const currentTier = evaluateSubscriptionTier(teacherDoc.data());
    const isPremium = currentTier === 'Premium' || currentTier === 'Normal';

    const updateData: any = { updated_at: new Date() };

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (bio !== undefined) updateData.bio = bio;
    if (subjects) updateData.subjects = subjects;
    if (classModes) updateData.classModes = classModes;
    if (profile_pic_url !== undefined) updateData.profile_pic_url = profile_pic_url;
    if (cover_url !== undefined) updateData.cover_url = cover_url; 
    
    if (nic_url !== undefined) updateData.nic_url = nic_url;
    if (cert_url !== undefined) updateData.cert_url = cert_url;
    
    if (academicLevels) updateData.academicLevels = academicLevels;
    if (teachingMediums) updateData.teachingMediums = teachingMediums;
    if (qualifications) updateData.qualifications = qualifications;
    if (trackRecord) updateData.trackRecord = trackRecord;

    // 🔥 SECURITY GATES: Enforce limits based on tier
    if (!isPremium) {
      if (locations && locations.length > 1) updateData.locations = locations.slice(0, 1);
      else if (locations) updateData.locations = locations;

      if (institutes && institutes.length > 1) updateData.institutes = institutes.slice(0, 1);
      else if (institutes) updateData.institutes = institutes;

      // Wipe out premium-only data to save DB space
      updateData.videoUrl = '';
      updateData.gallery_urls = [];
    } else {
      if (locations) updateData.locations = locations;
      if (institutes) updateData.institutes = institutes;
      if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
      if (gallery_urls !== undefined) updateData.gallery_urls = gallery_urls;
    }

    updateData.verification_status = 'Pending';
    updateData.rejection_reason = '';

    await db.collection('teachers').doc(teacherId).update(updateData);

    res.status(200).json({ success: true, message: 'Teacher profile updated.', data: updateData });
  } catch (error) {
    console.error('❌ Error updating teacher profile:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
};

export const getTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const docRef = db.collection('teachers').doc(teacherId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }

    const data = doc.data();

    const actualTier = evaluateSubscriptionTier(data);
    if (actualTier === 'Basic' && data?.subscription_tier !== 'Basic') {
      docRef.update({ subscription_tier: 'Basic' }).catch(err => console.error('Auto-downgrade failed:', err));
    }

    await docRef.update({
      profile_views: FieldValue.increment(1)
    });
    
    res.status(200).json({ 
      success: true, 
      data: {
        id: doc.id,
        name: data?.name,
        bio: data?.bio,
        role: data?.role || 'user', 
        subjects: data?.subjects || [],
        locations: data?.locations || [],
        classModes: data?.classModes || [],
        profile_pic_url: data?.profile_pic_url || '',
        cover_url: data?.cover_url || '', 
        is_verified: data?.is_verified || false,
        verification_status: data?.verification_status || 'Pending', 
        rejection_reason: data?.rejection_reason || '',              
        subscription_tier: actualTier,                              
        trial_ends_at: data?.trial_ends_at,
        subscription_ends_at: data?.subscription_ends_at,                  
        created_at: data?.created_at,                                
        academicLevels: data?.academicLevels || [],
        institutes: data?.institutes || [],
        teachingMediums: data?.teachingMediums || [],
        qualifications: data?.qualifications || [],
        trackRecord: data?.trackRecord || [],
        videoUrl: data?.videoUrl || '',
        gallery_urls: data?.gallery_urls || [], // 🔥 Included so the frontend can render them!
        profile_views: (data?.profile_views || 0) + 1
      }
    });
  } catch (error) {
    console.error('❌ Error fetching single teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getTeacherLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;

    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    if (!teacherDoc.exists) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }
    
    const actualTier = evaluateSubscriptionTier(teacherDoc.data());
    if (actualTier === 'Basic' && teacherDoc.data()?.subscription_tier !== 'Basic') {
      db.collection('teachers').doc(teacherId).update({ subscription_tier: 'Basic' }).catch(console.error);
    }

    const snapshot = await db.collection('leads')
      .where('teacher_id', '==', teacherId)
      .get();

    const leads: any[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      let displayDate = "Recent";
      let sortTime = 0;
      
      if (data.created_at) {
        sortTime = typeof data.created_at.toDate === 'function'
          ? data.created_at.toDate().getTime()
          : data.created_at._seconds * 1000;
        
        displayDate = new Date(sortTime).toLocaleDateString();
      }

      const isPremium = actualTier === 'Premium'; 
      
      leads.push({
        id: doc.id,
        student_name: isPremium ? (data.student_name || "Anonymous") : "🔒 Upgrade to View Name",
        grade: isPremium ? (data.grade || "N/A") : "🔒 Hidden",
        date: displayDate,
        sortTime: sortTime,
        isLockedForFree: !isPremium 
      });
    });

    leads.sort((a, b) => b.sortTime - a.sortTime);

    res.status(200).json({ success: true, tier: actualTier, data: leads });
  } catch (error) {
    console.error('❌ Error fetching teacher leads:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const searchTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, location, level } = req.query;

    const snapshot = await db.collection('teachers').get();
    
    let teachers: any[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();

      const actualTier = evaluateSubscriptionTier(data);

      teachers.push({ 
        id: doc.id, 
        name: data.name,
        subjects: data.subjects || [],
        locations: data.locations || [],
        academicLevels: data.academicLevels || [],
        profile_pic_url: data.profile_pic_url || '',
        cover_url: data.cover_url || '',
        subscription_tier: actualTier, 
        is_verified: data.is_verified || false,
        profile_views: data.profile_views || 0
      });
    });

    if (subject) {
      teachers = teachers.filter(t => t.subjects && t.subjects.includes(subject as string));
    }
    
    if (location) {
      teachers = teachers.filter(t => 
        t.locations && t.locations.some((l: any) => l.district === location || l.city === location)
      );
    }
    
    if (level) {
      teachers = teachers.filter(t => t.academicLevels && t.academicLevels.includes(level as string));
    }

    res.status(200).json({ success: true, data: teachers });
  } catch (error) {
    console.error('❌ Error searching teachers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const rejectTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const { reason } = req.body;

    if (!teacherId) {
      res.status(400).json({ success: false, message: 'Teacher ID is required.' });
      return;
    }

    if (!reason || !reason.trim()) {
      res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      return;
    }

    await db.collection('teachers').doc(teacherId).update({
      is_verified: false,
      verification_status: 'Rejected', 
      rejection_reason: reason.trim(), 
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: 'Teacher application rejected with reason documented.' });
  } catch (error) {
    console.error('❌ Error rejecting teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};