import crypto from 'crypto';
import { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { cleanString, evaluateSubscriptionTier, isOwnStorageUrl, toDate } from '../utils/teacherUtils';

// ─── Teacher blog ───────────────────────────────────────────────────────────
// Collection: blogs
//   title, slug, content (simple Markdown, rendered safely on the frontend — no HTML),
//   excerpt, subject, cover_url, reading_minutes
//   author_id, author_name, author_pic, author_role
//   status: 'draft' | 'pending' | 'published' | 'rejected', rejection_reason
//   views, created_at, updated_at, published_at
//
// Moderation: a teacher's FIRST post waits for admin approval. Once a teacher
// has a post approved they are marked `blog_trusted` and later posts and edits
// go live straight away (admins can still remove anything). Admin posts are
// always published immediately.
//
// Plan limit: Basic teachers can publish 2 posts per month; paid plans unlimited.

const BASIC_MONTHLY_LIMIT = 2;
const MIN_CONTENT = 200;
const MAX_CONTENT = 20000;

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Plain-text preview: strip Markdown symbols
const makeExcerpt = (md: string) =>
  md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>`]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const readingMinutes = (md: string) => Math.max(1, Math.round(md.split(/\s+/).filter(Boolean).length / 200));

const toCard = (id: string, d: any) => ({
  id,
  slug: d.slug,
  title: d.title,
  excerpt: d.excerpt || '',
  subject: d.subject || '',
  cover_url: d.cover_url || '',
  reading_minutes: d.reading_minutes || 1,
  author_id: d.author_role === 'admin' ? null : d.author_id,
  author_name: d.author_role === 'admin' ? 'Tuto.lk Team' : d.author_name,
  author_pic: d.author_role === 'admin' ? '' : d.author_pic || '',
  views: d.views || 0,
  published_at: toDate(d.published_at)?.toISOString() || null,
});

const toFull = (id: string, d: any) => ({ ...toCard(id, d), content: d.content || '' });

const toManage = (id: string, d: any) => ({
  ...toFull(id, d),
  author_id: d.author_id,
  author_name: d.author_name,
  author_role: d.author_role,
  status: d.status,
  rejection_reason: d.rejection_reason || '',
  created_at: toDate(d.created_at)?.toISOString() || null,
  updated_at: toDate(d.updated_at)?.toISOString() || null,
});

const byNewest = (a: any, b: any) =>
  (b.published_at || b.updated_at || b.created_at || '').localeCompare(a.published_at || a.updated_at || a.created_at || '');

// 🌍 GET /api/blogs?subject=&author=&limit=
export const listPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, author } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
    const snap = await db.collection('blogs').where('status', '==', 'published').get();
    let posts = snap.docs.map((d) => toCard(d.id, d.data()));
    if (subject) posts = posts.filter((p) => p.subject === subject);
    if (author) posts = posts.filter((p) => p.author_id === author);
    posts.sort(byNewest);
    res.status(200).json({ success: true, data: posts.slice(0, limit) });
  } catch (error) {
    console.error('❌ Error listing posts:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 GET /api/blogs/post/:slug — one published post with its content
export const getPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('blogs').where('slug', '==', req.params.slug as string).limit(1).get();
    const doc = snap.docs[0];
    if (!doc || doc.data().status !== 'published') {
      return void res.status(404).json({ success: false, message: 'Post not found.' });
    }
    res.status(200).json({ success: true, data: toFull(doc.id, doc.data()) });
  } catch (error) {
    console.error('❌ Error fetching post:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🌍 POST /api/blogs/:id/view — counts a read (called once from the browser)
export const countView = async (req: Request, res: Response): Promise<void> => {
  try {
    const ref = db.collection('blogs').doc(req.params.id as string);
    const doc = await ref.get();
    if (doc.exists && doc.data()?.status === 'published') {
      await ref.update({ views: FieldValue.increment(1) });
    }
    res.status(200).json({ success: true });
  } catch {
    res.status(200).json({ success: true }); // never bother the reader with this
  }
};

// Validates the editable fields; returns an error message or the clean values
const readBody = (b: any, uid: string) => {
  const title = cleanString(b.title, 120);
  const content = typeof b.content === 'string' ? b.content.replace(/\r\n/g, '\n').trim() : '';
  if (!title || title.length < 5) return { error: 'Give your post a title (at least 5 characters).' };
  if (content.length < MIN_CONTENT) return { error: `Your post is too short — write at least ${MIN_CONTENT} characters.` };
  if (content.length > MAX_CONTENT) return { error: `Your post is too long (max ${MAX_CONTENT.toLocaleString()} characters).` };
  const cover = typeof b.cover_url === 'string' ? b.cover_url : '';
  if (cover && !isOwnStorageUrl(cover, 'blog_covers', uid)) return { error: 'Please upload the cover image again.' };
  return {
    values: {
      title,
      content,
      subject: cleanString(b.subject, 80) || '',
      cover_url: cover,
      excerpt: makeExcerpt(content),
      reading_minutes: readingMinutes(content),
    },
  };
};

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

// Decides the status a teacher's post gets when they submit it
const submitStatus = async (uid: string, author: any, isAdmin: boolean, excludeId?: string) => {
  if (isAdmin) return { status: 'published' as const };

  if (author.is_verified !== true) {
    return { error: 'Your profile must be verified before you can publish posts.', code: 403 };
  }

  if (evaluateSubscriptionTier(author) === 'Basic') {
    const mine = await db.collection('blogs').where('author_id', '==', uid).get();
    const since = monthStart();
    const thisMonth = mine.docs.filter((d) => {
      if (d.id === excludeId) return false;
      const x = d.data();
      const when = toDate(x.published_at) || toDate(x.created_at);
      return ['published', 'pending'].includes(x.status) && when && when >= since;
    }).length;
    if (thisMonth >= BASIC_MONTHLY_LIMIT) {
      return {
        error: `The Basic plan includes ${BASIC_MONTHLY_LIMIT} posts a month. Upgrade to publish more.`,
        code: 402,
        upgrade: true,
      };
    }
  }

  return { status: author.blog_trusted === true ? ('published' as const) : ('pending' as const) };
};

// 🔒 POST /api/blogs  { title, content, subject, cover_url, submit: boolean }
export const createPost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const authorDoc = await db.collection('teachers').doc(uid).get();
    const author = authorDoc.data();
    if (!author) return void res.status(403).json({ success: false, message: 'Profile not found.' });
    const isAdmin = author.role === 'admin';

    const parsed = readBody(req.body || {}, uid);
    if ('error' in parsed) return void res.status(400).json({ success: false, message: parsed.error });

    let status: string = 'draft';
    if (req.body?.submit === true) {
      const s = await submitStatus(uid, author, isAdmin);
      if ('error' in s) return void res.status(s.code!).json({ success: false, message: s.error, upgrade: !!s.upgrade });
      status = s.status;
    }

    const base = slugify(parsed.values.title) || 'post';
    const slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date();

    const doc = await db.collection('blogs').add({
      ...parsed.values,
      slug,
      author_id: uid,
      author_name: author.name || '',
      author_pic: author.profile_pic_url || '',
      author_role: isAdmin ? 'admin' : 'teacher',
      status,
      rejection_reason: '',
      views: 0,
      created_at: now,
      updated_at: now,
      published_at: status === 'published' ? now : null,
    });

    res.status(201).json({ success: true, id: doc.id, slug, status, message: statusMessage(status) });
  } catch (error) {
    console.error('❌ Error creating post:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const statusMessage = (status: string) =>
  ({
    draft: 'Draft saved.',
    pending: 'Submitted! Your post will go live once the Tuto.lk team approves it.',
    published: 'Published! Your post is live.',
  } as Record<string, string>)[status] || 'Saved.';

// 🔒 PATCH /api/blogs/:id — the author edits (or submits) their post
export const updatePost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const ref = db.collection('blogs').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists) return void res.status(404).json({ success: false, message: 'Post not found.' });
    const post = doc.data()!;
    if (post.author_id !== uid) return void res.status(403).json({ success: false, message: 'You can only edit your own posts.' });

    const author = (await db.collection('teachers').doc(uid).get()).data() || {};
    const isAdmin = author.role === 'admin';

    const parsed = readBody(req.body || {}, uid);
    if ('error' in parsed) return void res.status(400).json({ success: false, message: parsed.error });

    let status: string = post.status === 'rejected' ? 'draft' : post.status;
    if (req.body?.submit === true || post.status === 'published') {
      // Already-live posts stay live for trusted authors; others go back to review
      const s = await submitStatus(uid, author, isAdmin, doc.id);
      if ('error' in s) return void res.status(s.code!).json({ success: false, message: s.error, upgrade: !!s.upgrade });
      status = s.status;
    }

    const now = new Date();
    await ref.update({
      ...parsed.values,
      author_name: author.name || post.author_name,
      author_pic: author.profile_pic_url || post.author_pic || '',
      status,
      rejection_reason: '',
      updated_at: now,
      published_at: status === 'published' ? post.published_at || now : null,
    });

    res.status(200).json({ success: true, id: doc.id, slug: post.slug, status, message: statusMessage(status) });
  } catch (error) {
    console.error('❌ Error updating post:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 GET /api/blogs/mine — the author's posts in every status
export const getMyPosts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('blogs').where('author_id', '==', req.user!.uid).get();
    res.status(200).json({ success: true, data: snap.docs.map((d) => toManage(d.id, d.data())).sort(byNewest) });
  } catch (error) {
    console.error('❌ Error fetching my posts:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 DELETE /api/blogs/:id — author or admin
export const deletePost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uid = req.user!.uid;
    const ref = db.collection('blogs').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists) return void res.status(404).json({ success: false, message: 'Post not found.' });
    if (doc.data()!.author_id !== uid) {
      const me = (await db.collection('teachers').doc(uid).get()).data();
      if (me?.role !== 'admin') return void res.status(403).json({ success: false, message: 'Not allowed.' });
    }
    await ref.delete();
    res.status(200).json({ success: true, message: 'Post deleted.' });
  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: GET /api/blogs/admin/all — pending first
export const adminListPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const snap = await db.collection('blogs').get();
    const order: Record<string, number> = { pending: 0, published: 1, rejected: 2, draft: 3 };
    const posts = snap.docs
      .map((d) => toManage(d.id, d.data()))
      .filter((p) => p.status !== 'draft')
      .sort((a, b) => order[a.status] - order[b.status] || byNewest(a, b));
    res.status(200).json({ success: true, data: posts });
  } catch (error) {
    console.error('❌ Error listing posts for admin:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// 🔒 Admin: PATCH /api/blogs/:id/review  { action: 'approve' | 'reject' | 'unpublish', reason? }
export const reviewPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body || {};
    if (!['approve', 'reject', 'unpublish'].includes(action)) {
      return void res.status(400).json({ success: false, message: 'Invalid action.' });
    }
    const ref = db.collection('blogs').doc(req.params.id as string);
    const doc = await ref.get();
    if (!doc.exists) return void res.status(404).json({ success: false, message: 'Post not found.' });
    const post = doc.data()!;

    if (action === 'approve') {
      await ref.update({ status: 'published', rejection_reason: '', published_at: post.published_at || new Date() });
      // The author has proven themselves — future posts go live without waiting
      if (post.author_role === 'teacher') {
        await db.collection('teachers').doc(post.author_id).update({ blog_trusted: true }).catch(() => {});
      }
    } else {
      const reason = cleanString(req.body?.reason, 300) || (action === 'reject' ? 'Does not meet our guidelines' : 'Removed by admin');
      await ref.update({ status: 'rejected', rejection_reason: reason });
      // Unpublishing for a problem means the author's next posts are reviewed again
      if (action === 'unpublish' && post.author_role === 'teacher') {
        await db.collection('teachers').doc(post.author_id).update({ blog_trusted: false }).catch(() => {});
      }
    }
    res.status(200).json({ success: true, message: action === 'approve' ? 'Post published.' : 'Post taken down.' });
  } catch (error) {
    console.error('❌ Error reviewing post:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
