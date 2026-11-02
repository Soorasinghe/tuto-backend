// Shared helpers for turning raw teacher documents into safe API responses.
//
// 🔒 SECURITY RULE: Never send `...doc.data()` to a public endpoint.
// Teacher documents contain private data (phone, email, NIC/certificate scans,
// rejection reasons, role). Public endpoints must go through the whitelists below.

export const PAID_TIERS = ['Normal', 'Premium'] as const;
export type Tier = 'Basic' | 'Normal' | 'Premium';

// Monthly plan prices in LKR — keep in sync with app/dashboard/billing/page.tsx
export const PLAN_PRICES: Record<string, number> = { Normal: 990, Premium: 1990 };

export const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

// Checks expiry dates and returns the tier the teacher is actually entitled to right now.
export const evaluateSubscriptionTier = (data: any): Tier => {
  const stored: Tier = data?.subscription_tier || 'Basic';
  if (stored === 'Basic') return 'Basic';

  const now = new Date();
  const paidEnd = toDate(data?.subscription_ends_at);
  const trialEnd = toDate(data?.trial_ends_at);

  if (paidEnd && paidEnd > now) return stored;
  if (trialEnd && trialEnd > now) return stored;
  return 'Basic';
};

// Fields shown on search result cards / trending widget.
export const toPublicCard = (id: string, data: any) => {
  const tier = evaluateSubscriptionTier(data);
  return {
    id,
    name: data?.name || '',
    subjects: data?.subjects || [],
    academicLevels: data?.academicLevels || [],
    teachingMediums: data?.teachingMediums || [],
    classModes: data?.classModes || [],
    locations: data?.locations || [],
    profile_pic_url: data?.profile_pic_url || '',
    cover_url: data?.cover_url || '',
    subscription_tier: tier,
    is_verified: data?.is_verified || false,
    profile_views: data?.profile_views || 0,
  };
};

// Fields shown on the public teacher profile page. No phone/email/NIC/role here —
// the phone number is only released through the /unlock flow.
export const toPublicProfile = (id: string, data: any) => {
  const card = toPublicCard(id, data);
  const isPaid = card.subscription_tier !== 'Basic';
  return {
    ...card,
    bio: data?.bio || '',
    institutes: data?.institutes || [],
    qualifications: data?.qualifications || [],
    trackRecord: data?.trackRecord || [],
    // Premium-only media is hidden once a subscription lapses
    videoUrl: isPaid ? data?.videoUrl || '' : '',
    gallery_urls: isPaid ? data?.gallery_urls || [] : [],
  };
};

// Full profile, only for the owner (GET /api/teachers/me).
export const toOwnerProfile = (id: string, data: any) => ({
  ...toPublicProfile(id, data),
  // Owner sees their stored media even if hidden publicly, so it isn't lost on re-save
  videoUrl: data?.videoUrl || '',
  gallery_urls: data?.gallery_urls || [],
  phone: data?.phone || '',
  email: data?.email || '',
  role: data?.role || 'teacher',
  nic_url: data?.nic_url || '',
  cert_url: data?.cert_url || '',
  verification_status: data?.verification_status || 'Pending',
  rejection_reason: data?.rejection_reason || '',
  trial_ends_at: toDate(data?.trial_ends_at)?.toISOString() || null,
  subscription_ends_at: toDate(data?.subscription_ends_at)?.toISOString() || null,
  created_at: toDate(data?.created_at)?.toISOString() || null,
});

// ─── Input sanitisers ────────────────────────────────────────────────────────

export const cleanString = (value: any, maxLen: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLen);
};

export const cleanStringArray = (value: any, maxItems: number, maxLen = 200): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
};

export const cleanLocations = (value: any, maxItems: number) => {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((l) => l && typeof l === 'object')
    .slice(0, maxItems)
    .map((l) => ({
      province: cleanString(l.province, 100) || '',
      district: cleanString(l.district, 100) || '',
      city: cleanString(l.city, 100) || '',
      village: cleanString(l.village, 100) || '',
    }));
};

// ─── Firebase Storage URL checks ─────────────────────────────────────────────
// Uploaded files must live in the uploader's own folder: <folder>/<uid>/...
// (Older uploads used flat paths like profile_pictures/<uid>_123.jpg, so those
// are accepted too when they start with the uid.)

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'tuto-lk.firebasestorage.app';

export const isOwnStorageUrl = (url: string, folder: string, uid: string): boolean => {
  if (typeof url !== 'string') return false;
  const base = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`;
  if (!url.startsWith(base)) return false;
  const objectPath = decodeURIComponent(url.slice(base.length).split('?')[0]);
  return (
    objectPath.startsWith(`${folder}/${uid}/`) || // new layout
    objectPath.startsWith(`${folder}/${uid}_`)     // legacy layout
  );
};
