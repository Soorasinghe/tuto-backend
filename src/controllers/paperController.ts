import { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db, storage } from '../config/firebase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { cleanString, isOwnStorageUrl, toDate } from '../utils/teacherUtils';

// ─── Past papers ────────────────────────────────────────────────────────────
// Collection: past_papers
//   exam, subject, subject_slug, year, medium, paper_type, title, description
//   file_url, file_path, file_size
//   uploaded_by, uploader_name, uploader_role ('admin' | 'teacher')
//   status ('pending' | 'approved' | 'rejected'), rejection_reason
//   downloads, created_at, approved_at
//
// Admin uploads are published straight away. Teacher uploads wait for approval.

export const EXAMS = ['grade-5', 'ol', 'al', 'term-test'] as const;
export const PAPER_TYPES = ['paper', 'marking-scheme', 'model-paper'] as const;
export const MEDIUMS = ['Sinhala', 'English', 'Tamil'] as const;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getUser = async (uid: string) => {
  const doc = await db.collection('teachers').doc(uid).get();
  return doc.exists ? doc.data() : null;
};

// Turns a Firebase Storage download URL back into its object path (for deletes / migrations)
const pathFromUrl = (url: string): string => {
  const marker = '/o/';
  const i = url.indexOf(marker);
  if (i === -1) return '';
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
};

const toPublicPaper = (id: string, d: any) => ({
  id,
  exam: d.exam,
  subject: d.subject,
  subject_slug: d.subject_slug,
  year: d.year,
  medium: d.medium,
  paper_type: d.paper_type,
  title: d.title,
  description: d.description || '',
  file_url: d.file_url,
  file_size: d.file_size || 0,
  downloads: d.downloads || 0,
  // Only teacher uploads are credited publicly (with a link to their profile)
  uploader_id: d.uploader_role === 'teacher' ? d.uploaded_by : null,
  uploader_name: d.uploader_role === 'teacher' ? d.uploader_name : null,
  created_at: toDate(d.created_at)?.toISOString() || null,
});

const toManagePaper = (id: string, d: any) => ({
  ...toPublicPaper(id, d),
  uploaded_by: d.uploaded_by,
  uploader_name: d.uploader_name,
  uploader_role: d.uploader_role,
  status: d.status,
  rejection_reason: d.rejection_reason || '',
});

const sortPapers = (a: any, b: any) =>
  b.year - a.year ||
  a.subject.localeCompare(b.subject) ||
  PAPER_TYPES.indexOf(a.paper_type) - PAPER_TYPES.indexOf(b.paper_type);

// 🌍 GET /api/papers?exam=&subject=&year=&medium=&type=
// Filtering happens in memory so no composite Firestore indexes are needed.
export const listPapers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { exam, subject, year, medium, type } = req.query as Record<string, string | undefined>;
    const snap = await db.collection('past_papers').where('status', '==', 'approved').get();

    let papers = snap.docs.map((doc) => toPublicPaper(doc.id, doc.data()));
    if (exam) papers = papers.filter((p) => p.exam === exam);
    if (subject) papers = papers.filter((p) => p.subject_slug === subject || p.subject === subject);
    if (year) papers = papers.filter((p) => String(p.year) === String(year));
    if (medium) papers = papers.filter((p) => p.medium === medium);
    if (type) papers = papers.filter((p) => p.paper_type === type);

    papers.sort(sortPapers);
    res.status(200).json({ success: true, data: papers });
  } catch (error) {
    console.error('❌ Error listing papers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 POST /api/papers/:id/download — counts the download and returns the file link
export const downloadPaper = async (req: Request, res: Response): Promise<void> => {
  try {
    const ref = db.collection('past_papers').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.status !== 'approved') {
      res.status(404).json({ success: false, message: 'Paper not found.' });
      return;
    }
    ref.update({ downloads: FieldValue.increment(1) }).catch(console.error);
    res.status(200).json({ success: true, url: doc.data()?.file_url });
  } catch (error) {
    console.error('❌ Error downloading paper:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 POST /api/papers — teacher or admin uploads (the PDF is already in Storage)
export const createPaper = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const user = await getUser(uid);
    if (!user) {
      res.status(403).json({ success: false, message: 'Profile not found.' });
      return;
    }
    const isAdmin = user.role === 'admin';
    const b = req.body || {};

    const exam = b.exam;
    const paperType = b.paper_type;
    const medium = b.medium;
    const subject = cleanString(b.subject, 80);
    const year = Number(b.year);
    const thisYear = new Date().getFullYear();
    const fileUrl = b.file_url;
    const fileSize = Number(b.file_size) || 0;

    if (!EXAMS.includes(exam)) return void res.status(400).json({ success: false, message: 'Choose an exam.' });
    if (!PAPER_TYPES.includes(paperType)) return void res.status(400).json({ success: false, message: 'Choose a paper type.' });
    if (!MEDIUMS.includes(medium)) return void res.status(400).json({ success: false, message: 'Choose a medium.' });
    if (!subject) return void res.status(400).json({ success: false, message: 'Subject is required.' });
    if (!Number.isInteger(year) || year < 1990 || year > thisYear + 1) {
      return void res.status(400).json({ success: false, message: 'Enter a valid year.' });
    }
    if (!isOwnStorageUrl(fileUrl, 'past_papers', uid)) {
      return void res.status(400).json({ success: false, message: 'Please upload the PDF again.' });
    }
    if (fileSize > MAX_FILE_BYTES) {
      return void res.status(400).json({ success: false, message: 'PDF must be under 10 MB.' });
    }
    if (!isAdmin && b.rights_confirmed !== true) {
      return void res.status(400).json({ success: false, message: 'Please confirm you have the right to share this paper.' });
    }

    const typeLabel = { paper: 'Paper', 'marking-scheme': 'Marking Scheme', 'model-paper': 'Model Paper' }[paperType as string];
    const examLabel = { 'grade-5': 'Grade 5 Scholarship', ol: 'G.C.E. O/L', al: 'G.C.E. A/L', 'term-test': 'Term Test' }[exam as string];
    const title =
      cleanString(b.title, 150) || `${year} ${examLabel} ${subject} ${typeLabel} (${medium} Medium)`;

    const doc = await db.collection('past_papers').add({
      exam,
      subject,
      subject_slug: slugify(subject),
      year,
      medium,
      paper_type: paperType,
      title,
      description: cleanString(b.description, 500) || '',
      file_url: fileUrl,
      file_path: pathFromUrl(fileUrl),
      file_size: fileSize,
      uploaded_by: uid,
      uploader_name: user.name || '',
      uploader_role: isAdmin ? 'admin' : 'teacher',
      rights_confirmed: isAdmin ? true : b.rights_confirmed === true,
      status: isAdmin ? 'approved' : 'pending',
      rejection_reason: '',
      downloads: 0,
      created_at: new Date(),
      approved_at: isAdmin ? new Date() : null,
    });

    res.status(201).json({
      success: true,
      id: doc.id,
      message: isAdmin ? 'Paper published.' : 'Paper submitted. It will appear on the site once approved.',
    });
  } catch (error) {
    console.error('❌ Error creating paper:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 GET /api/papers/mine — a teacher's own uploads (any status)
export const getMyPapers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('past_papers').where('uploaded_by', '==', req.user!.uid).get();
    const papers = snap.docs.map((d) => toManagePaper(d.id, d.data())).sort(sortPapers);
    res.status(200).json({ success: true, data: papers });
  } catch (error) {
    console.error('❌ Error fetching my papers:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 DELETE /api/papers/:id — the uploader or an admin
export const deletePaper = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const ref = db.collection('past_papers').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists) return void res.status(404).json({ success: false, message: 'Paper not found.' });

    const data = doc.data()!;
    if (data.uploaded_by !== uid) {
      const user = await getUser(uid);
      if (user?.role !== 'admin') return void res.status(403).json({ success: false, message: 'Not allowed.' });
    }

    if (data.file_path) {
      await storage.bucket().file(data.file_path).delete().catch((e) => console.warn('File delete skipped:', e.message));
    }
    await ref.delete();
    res.status(200).json({ success: true, message: 'Paper deleted.' });
  } catch (error) {
    console.error('❌ Error deleting paper:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: GET /api/papers/admin/all — every paper, newest first, pending on top
export const adminListPapers = async (req: Request, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('past_papers').get();
    const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    const papers = snap.docs
      .map((d) => toManagePaper(d.id, d.data()))
      .sort((a, b) => order[a.status] - order[b.status] || (b.created_at || '').localeCompare(a.created_at || ''));
    res.status(200).json({ success: true, data: papers });
  } catch (error) {
    console.error('❌ Error listing papers for admin:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: PATCH /api/papers/:id/review  { action: 'approve' | 'reject', reason? }
export const reviewPaper = async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) {
      return void res.status(400).json({ success: false, message: 'Invalid action.' });
    }
    const ref = db.collection('past_papers').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists) return void res.status(404).json({ success: false, message: 'Paper not found.' });

    if (action === 'approve') {
      await ref.update({ status: 'approved', approved_at: new Date(), rejection_reason: '' });
    } else {
      await ref.update({ status: 'rejected', rejection_reason: cleanString(req.body?.reason, 300) || 'Not suitable' });
    }
    res.status(200).json({ success: true, message: action === 'approve' ? 'Paper approved.' : 'Paper rejected.' });
  } catch (error) {
    console.error('❌ Error reviewing paper:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
