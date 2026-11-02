import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  evaluateSubscriptionTier,
  toPublicProfile,
  toOwnerProfile,
  cleanString,
  cleanStringArray,
  cleanLocations,
  isOwnStorageUrl,
} from '../utils/teacherUtils';
import { checkRateLimit, getClientIp } from '../utils/rateLimit';

// Creates the Firestore profile on first login (email or Google).
// This is the ONLY way a teacher document gets created — the old public
// /register endpoint was removed because it let anyone overwrite any account.
export const syncTeacherProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
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
        name: cleanString(req.user?.name, 100) || cleanString(req.body?.name, 100) || 'New Tutor',
        phone: '',
        email: req.user?.email || '',
        bio: '',
        role: 'teacher', // 🔒 always 'teacher' — admin is only ever set manually in Firestore
        subscription_tier: 'Premium',
        is_verified: false,
        verification_status: 'Pending',
        rejection_reason: '',
        trial_ends_at: trialEndsAt,
        subscription_ends_at: null,
        created_at: FieldValue.serverTimestamp(),
        terms_accepted_at: req.body?.termsAccepted === true ? new Date() : null,
        institutes: [],
        gallery_urls: [],
        profile_pic_url: req.user?.picture || '',
        cover_url: '',
        videoUrl: '',
        profile_views: 0,
      };

      await teacherRef.set(newProfile);
      const created = await teacherRef.get();
      res.status(201).json({ success: true, message: 'Profile created!', data: toOwnerProfile(uid, created.data()) });
      return;
    }

    res.status(200).json({ success: true, message: 'Profile already exists.', data: toOwnerProfile(uid, teacherDoc.data()) });
  } catch (error) {
    console.error('❌ Error syncing teacher profile:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 GET /api/teachers/me — the logged-in teacher's full profile (incl. phone, NIC, role).
export const getMyProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const ref = db.collection('teachers').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }
    const data = doc.data();
    const actualTier = evaluateSubscriptionTier(data);
    if (actualTier === 'Basic' && data?.subscription_tier !== 'Basic') {
      ref.update({ subscription_tier: 'Basic' }).catch((err) => console.error('Auto-downgrade failed:', err));
    }
    res.status(200).json({ success: true, data: toOwnerProfile(uid, data) });
  } catch (error) {
    console.error('❌ Error fetching own profile:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 Public: student/parent asks for a teacher's number.
export const unlockContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const studentName = cleanString(req.body?.studentName, 80);
    const grade = cleanString(req.body?.grade, 50);

    if (!studentName || !grade) {
      res.status(400).json({ success: false, message: 'Student name and grade are required.' });
      return;
    }

    // 🔒 Stop scrapers / fake-lead spam: max 10 unlocks per hour per IP
    const allowed = await checkRateLimit('unlock', getClientIp(req), 10, 60 * 60 * 1000);
    if (!allowed) {
      res.status(429).json({ success: false, message: 'Too many requests. Please try again in a little while.' });
      return;
    }

    const teacherDoc = await db.collection('teachers').doc(teacherId).get();

    // 🔒 Only verified teachers' numbers are released
    if (!teacherDoc.exists || teacherDoc.data()?.is_verified !== true) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }

    const teacherData = teacherDoc.data();

    await db.collection('leads').add({
      teacher_id: teacherId,
      teacher_name: teacherData?.name || '',
      student_name: studentName,
      grade,
      unlocked_at: new Date(),
      created_at: new Date(),
    });

    res.status(200).json({ success: true, phone: teacherData?.phone || '' });
  } catch (error) {
    console.error('❌ Error unlocking contact:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 PATCH /:teacherId/profile — route is protected by verifyToken + requireSelf.
export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const body = req.body || {};

    const teacherRef = db.collection('teachers').doc(teacherId);
    const teacherDoc = await teacherRef.get();
    if (!teacherDoc.exists) {
      res.status(404).json({ success: false, message: 'Teacher not found.' });
      return;
    }

    const current = teacherDoc.data() || {};
    const currentTier = evaluateSubscriptionTier(current);
    const isPaid = currentTier === 'Premium' || currentTier === 'Normal';

    const updateData: any = { updated_at: new Date() };

    // ── Plain text fields (type + length checked) ──
    const name = cleanString(body.name, 100);
    if (name) updateData.name = name;
    const phone = cleanString(body.phone, 20);
    if (phone) updateData.phone = phone;
    const bio = cleanString(body.bio, 2000);
    if (bio !== undefined) updateData.bio = bio;

    const subjects = cleanStringArray(body.subjects, 30);
    if (subjects) updateData.subjects = subjects;
    const classModes = cleanStringArray(body.classModes, 10);
    if (classModes) updateData.classModes = classModes;
    const academicLevels = cleanStringArray(body.academicLevels, 10);
    if (academicLevels) updateData.academicLevels = academicLevels;
    const teachingMediums = cleanStringArray(body.teachingMediums, 5);
    if (teachingMediums) updateData.teachingMediums = teachingMediums;
    const qualifications = cleanStringArray(body.qualifications, 20, 300);
    if (qualifications) updateData.qualifications = qualifications;
    const trackRecord = cleanStringArray(body.trackRecord, 20, 300);
    if (trackRecord) updateData.trackRecord = trackRecord;

    // ── Uploaded file URLs: must be in this teacher's own Storage folder ──
    // (or unchanged from what's already saved)
    const checkUrl = (field: string, folder: string): boolean => {
      const value = body[field];
      if (value === undefined) return true;
      if (value === '' || value === current[field] || isOwnStorageUrl(value, folder, teacherId)) {
        updateData[field] = value;
        return true;
      }
      return false;
    };

    const urlChecks = [
      checkUrl('profile_pic_url', 'profile_pictures'),
      checkUrl('cover_url', 'covers'),
      checkUrl('nic_url', 'verifications'),
      checkUrl('cert_url', 'verifications'),
    ];
    // Google sign-in avatars are allowed for the profile picture
    if (!urlChecks[0] && typeof body.profile_pic_url === 'string' && body.profile_pic_url.startsWith('https://lh3.googleusercontent.com/')) {
      updateData.profile_pic_url = body.profile_pic_url;
      urlChecks[0] = true;
    }
    if (urlChecks.includes(false)) {
      res.status(400).json({ success: false, message: 'Invalid file URL. Please re-upload the image.' });
      return;
    }

    // ── Tier limits ──
    const locations = cleanLocations(body.locations, isPaid ? 50 : 1);
    if (locations) updateData.locations = locations;
    const institutes = cleanStringArray(body.institutes, isPaid ? 20 : 1);
    if (institutes) updateData.institutes = institutes;

    if (isPaid) {
      const videoUrl = cleanString(body.videoUrl, 300);
      if (videoUrl !== undefined) updateData.videoUrl = videoUrl;

      if (body.gallery_urls !== undefined) {
        const gallery = cleanStringArray(body.gallery_urls, 12, 1000) || [];
        const existing: string[] = current.gallery_urls || [];
        const valid = gallery.every((u) => existing.includes(u) || isOwnStorageUrl(u, 'gallery', teacherId));
        if (!valid) {
          res.status(400).json({ success: false, message: 'Invalid gallery image URL.' });
          return;
        }
        updateData.gallery_urls = gallery;
      }
    }
    // Basic teachers: premium media is simply not updated (and hidden publicly
    // by toPublicProfile), so it comes back if they re-subscribe.

    updateData.verification_status = 'Pending';
    updateData.rejection_reason = '';

    await teacherRef.update(updateData);

    res.status(200).json({ success: true, message: 'Teacher profile updated.', data: updateData });
  } catch (error) {
    console.error('❌ Error updating teacher profile:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
};

// 🌍 Public profile page — returns ONLY public fields (no phone/email/NIC/role).
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
      docRef.update({ subscription_tier: 'Basic' }).catch((err) => console.error('Auto-downgrade failed:', err));
    }

    // Only count a view when the page asks for it (the server-side metadata
    // fetch passes no flag, so one visit = one view instead of two).
    const countView = req.query.view === '1';
    if (countView) {
      docRef.update({ profile_views: FieldValue.increment(1) }).catch(console.error);
    }

    const profile = toPublicProfile(doc.id, data);
    if (countView) profile.profile_views += 1;

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    console.error('❌ Error fetching single teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 GET /:teacherId/leads — route is protected by verifyToken + requireSelf.
export const getTeacherLeads = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    const snapshot = await db.collection('leads').where('teacher_id', '==', teacherId).get();

    const isPremium = actualTier === 'Premium';
    const leads: any[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const created = data.created_at?.toDate ? data.created_at.toDate() : null;
      const sortTime = created ? created.getTime() : 0;

      leads.push({
        id: doc.id,
        student_name: isPremium ? data.student_name || 'Anonymous' : '🔒 Upgrade to View Name',
        grade: isPremium ? data.grade || 'N/A' : '🔒 Hidden',
        date: created ? created.toLocaleDateString() : 'Recent',
        sortTime,
        isLockedForFree: !isPremium,
      });
    });

    leads.sort((a, b) => b.sortTime - a.sortTime);

    res.status(200).json({ success: true, tier: actualTier, data: leads });
  } catch (error) {
    console.error('❌ Error fetching teacher leads:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin only (route protected by verifyToken + verifyAdmin)
export const rejectTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.params.teacherId as string;
    const reason = cleanString(req.body?.reason, 500);

    if (!reason) {
      res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      return;
    }

    await db.collection('teachers').doc(teacherId).update({
      is_verified: false,
      verification_status: 'Rejected',
      rejection_reason: reason,
      updated_at: new Date(),
    });

    res.status(200).json({ success: true, message: 'Teacher application rejected with reason documented.' });
  } catch (error) {
    console.error('❌ Error rejecting teacher:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
