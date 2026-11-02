import crypto from 'crypto';
import { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { cleanString, evaluateSubscriptionTier, toDate } from '../utils/teacherUtils';
import { checkRateLimit, getClientIp } from '../utils/rateLimit';

// ─── Tuition requests ("looking for a teacher") ─────────────────────────────
// Parents/students post what they need without an account. The request is
// public, but the phone number is ONLY released to verified teachers on a
// paid plan (incl. the free trial) — that's both privacy protection and a
// reason for teachers to upgrade.
//
// Collection: tuition_requests
//   subject, level, medium, mode ('Online' | 'Physical' | 'Either'),
//   district, city, details, poster_name, poster_role ('Parent' | 'Student'),
//   contact_phone (PRIVATE), whatsapp (bool), manage_key_hash (PRIVATE),
//   status ('open' | 'closed' | 'removed'), contacted_by [teacher uids],
//   contact_count, views, created_at, expires_at

const MODES = ['Online', 'Physical', 'Either'] as const;
const ROLES = ['Parent', 'Student'] as const;
const LIFETIME_DAYS = 30;

// Sri Lankan mobile numbers: 07XXXXXXXX or +947XXXXXXXX → stored as 07XXXXXXXX
const normalisePhone = (raw: any): string | null => {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  const m = digits.match(/^(?:\+94|0094|94|0)(7\d{8})$/);
  return m ? `0${m[1]}` : null;
};

const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

const isLive = (d: any) => {
  const exp = toDate(d.expires_at);
  return d.status === 'open' && (!exp || exp > new Date());
};

const toPublicRequest = (id: string, d: any) => ({
  id,
  subject: d.subject,
  level: d.level || '',
  medium: d.medium || '',
  mode: d.mode,
  district: d.district || '',
  city: d.city || '',
  details: d.details || '',
  poster_name: (d.poster_name || '').split(' ')[0], // first name only in public
  poster_role: d.poster_role,
  status: isLive(d) ? 'open' : d.status === 'open' ? 'expired' : d.status,
  contact_count: d.contact_count || 0,
  created_at: toDate(d.created_at)?.toISOString() || null,
  expires_at: toDate(d.expires_at)?.toISOString() || null,
});

// 🌍 GET /api/requests?subject=&district=&mode=
export const listRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, district, mode } = req.query as Record<string, string | undefined>;
    const snap = await db.collection('tuition_requests').where('status', '==', 'open').get();

    let list = snap.docs.filter((d) => isLive(d.data())).map((d) => toPublicRequest(d.id, d.data()));
    if (subject) {
      const s = subject.toLowerCase();
      list = list.filter((r) => r.subject.toLowerCase().includes(s));
    }
    if (district) list = list.filter((r) => r.district === district || r.mode === 'Online');
    if (mode === 'Online') list = list.filter((r) => r.mode !== 'Physical');
    if (mode === 'Physical') list = list.filter((r) => r.mode !== 'Online');

    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error('❌ Error listing requests:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 GET /api/requests/:id
export const getRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await db.collection('tuition_requests').doc(req.params.id as string).get();
    if (!doc.exists || doc.data()?.status === 'removed') {
      return void res.status(404).json({ success: false, message: 'Request not found.' });
    }
    res.status(200).json({ success: true, data: toPublicRequest(doc.id, doc.data()) });
  } catch (error) {
    console.error('❌ Error fetching request:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 POST /api/requests — rate-limited, no account needed
export const createRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body || {};

    // Honeypot: real users never fill this hidden field
    if (b.website) return void res.status(200).json({ success: true, id: 'ok', manageKey: '' });

    const subject = cleanString(b.subject, 80);
    const mode = b.mode;
    const posterName = cleanString(b.poster_name, 60);
    const posterRole = b.poster_role;
    const phone = normalisePhone(b.contact_phone);
    const district = cleanString(b.district, 50) || '';

    if (!subject) return void res.status(400).json({ success: false, message: 'Which subject do you need a teacher for?' });
    if (!MODES.includes(mode)) return void res.status(400).json({ success: false, message: 'Choose online, physical or either.' });
    if (mode !== 'Online' && !district) {
      return void res.status(400).json({ success: false, message: 'Choose your district for physical classes.' });
    }
    if (!posterName) return void res.status(400).json({ success: false, message: 'Please enter your name.' });
    if (!ROLES.includes(posterRole)) return void res.status(400).json({ success: false, message: 'Are you a parent or a student?' });
    if (!phone) return void res.status(400).json({ success: false, message: 'Enter a valid Sri Lankan mobile number (07XXXXXXXX).' });
    if (b.consent !== true) {
      return void res.status(400).json({ success: false, message: 'Please agree to share your number with verified teachers.' });
    }

    // 🔒 Max 3 requests per day per IP, and per phone number
    const day = 24 * 60 * 60 * 1000;
    const okIp = await checkRateLimit('request_ip', getClientIp(req), 3, day);
    const okPhone = okIp && (await checkRateLimit('request_phone', phone, 3, day));
    if (!okIp || !okPhone) {
      return void res.status(429).json({ success: false, message: 'You have posted several requests today. Please try again tomorrow.' });
    }

    const manageKey = crypto.randomBytes(16).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + LIFETIME_DAYS);

    const doc = await db.collection('tuition_requests').add({
      subject,
      level: cleanString(b.level, 60) || '',
      medium: cleanString(b.medium, 30) || '',
      mode,
      district: mode === 'Online' ? cleanString(b.district, 50) || '' : district,
      city: cleanString(b.city, 60) || '',
      details: cleanString(b.details, 600) || '',
      poster_name: posterName,
      poster_role: posterRole,
      contact_phone: phone,
      whatsapp: b.whatsapp === true,
      manage_key_hash: hashKey(manageKey),
      status: 'open',
      contacted_by: [],
      contact_count: 0,
      created_at: new Date(),
      expires_at: expires,
    });

    // The manage key is shown ONCE to the poster so they can close the request later
    res.status(201).json({ success: true, id: doc.id, manageKey });
  } catch (error) {
    console.error('❌ Error creating request:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 PATCH /api/requests/:id/close  { key } — poster closes their own request
export const closeRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.body?.key;
    const ref = db.collection('tuition_requests').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists || typeof key !== 'string' || hashKey(key) !== doc.data()?.manage_key_hash) {
      return void res.status(403).json({ success: false, message: 'This link is not valid.' });
    }
    await ref.update({ status: 'closed', closed_at: new Date() });
    res.status(200).json({ success: true, message: 'Request closed. We hope you found a great teacher!' });
  } catch (error) {
    console.error('❌ Error closing request:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 POST /api/requests/:id/contact — verified teacher on a paid plan gets the number
export const contactRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const teacherDoc = await db.collection('teachers').doc(uid).get();
    const teacher = teacherDoc.data();
    if (!teacher) return void res.status(403).json({ success: false, code: 'NO_PROFILE', message: 'Teacher profile not found.' });

    const isAdmin = teacher.role === 'admin';
    if (!isAdmin && teacher.is_verified !== true) {
      return void res.status(403).json({
        success: false,
        code: 'NOT_VERIFIED',
        message: 'Your profile must be verified before you can contact students.',
      });
    }
    if (!isAdmin && evaluateSubscriptionTier(teacher) === 'Basic') {
      return void res.status(402).json({
        success: false,
        code: 'UPGRADE',
        message: 'Upgrade to Normal or Premium to see student contact numbers.',
      });
    }

    const ref = db.collection('tuition_requests').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists || !isLive(doc.data())) {
      return void res.status(404).json({ success: false, message: 'This request is no longer open.' });
    }
    const d = doc.data()!;

    // Count each teacher once
    if (!isAdmin && !(d.contacted_by || []).includes(uid)) {
      await ref.update({ contacted_by: FieldValue.arrayUnion(uid), contact_count: FieldValue.increment(1) });
    }

    res.status(200).json({
      success: true,
      data: { name: d.poster_name, phone: d.contact_phone, whatsapp: d.whatsapp === true },
    });
  } catch (error) {
    console.error('❌ Error releasing request contact:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: GET /api/requests/admin/all — includes phone numbers
export const adminListRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('tuition_requests').get();
    const list = snap.docs
      .map((d) => ({ ...toPublicRequest(d.id, d.data()), poster_name: d.data().poster_name, contact_phone: d.data().contact_phone }))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error('❌ Error listing requests for admin:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: PATCH /api/requests/:id/remove — spam / abuse
export const removeRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const ref = db.collection('tuition_requests').doc(req.params.id as string);
    if (!(await ref.get()).exists) return void res.status(404).json({ success: false, message: 'Request not found.' });
    await ref.update({ status: 'removed', removed_at: new Date() });
    res.status(200).json({ success: true, message: 'Request removed.' });
  } catch (error) {
    console.error('❌ Error removing request:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
