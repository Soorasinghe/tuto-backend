import crypto from 'crypto';
import { Request } from 'express';
import { db } from '../config/firebase';

// Firestore-backed fixed-window rate limiter.
// In-memory limiters don't work on Vercel (every request can hit a fresh
// serverless instance), so the counter lives in the `rate_limits` collection.
// IPs are hashed before storage so we don't keep raw IP addresses.
//
// Tip: add a Firestore TTL policy on `rate_limits.expires_at` (Firestore console →
// TTL) so old counters are deleted automatically.

export const getClientIp = (req: Request): string => {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first || req.socket.remoteAddress || 'unknown').trim();
};

const hash = (value: string) =>
  crypto.createHash('sha256').update(`${process.env.RATE_LIMIT_SALT || 'tuto'}:${value}`).digest('hex').slice(0, 32);

/**
 * Returns true if the action is allowed, false if the limit is exceeded.
 * @param bucket   name of the action, e.g. "unlock"
 * @param key      who is acting, e.g. the client IP
 * @param limit    max actions per window
 * @param windowMs window length in ms
 */
export const checkRateLimit = async (
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> => {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const ref = db.collection('rate_limits').doc(`${bucket}_${hash(key)}_${windowStart}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data()?.count || 0 : 0;
    if (count >= limit) return false;
    tx.set(ref, {
      count: count + 1,
      bucket,
      expires_at: new Date(windowStart + windowMs * 2),
    });
    return true;
  });
};
