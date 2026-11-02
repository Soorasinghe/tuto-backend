import * as admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Credentials come from one of two places:
//  • Vercel: GOOGLE_APPLICATION_CREDENTIALS_BASE64 (the service-account JSON, base64-encoded,
//    because Vercel mangles the newlines in a raw private key)
//  • Local dev: GOOGLE_APPLICATION_CREDENTIALS (path to firebase-service-account.json)
const loadServiceAccount = (): admin.ServiceAccount => {
  const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (b64) {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  }

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  }

  throw new Error(
    'Firebase credentials missing: set GOOGLE_APPLICATION_CREDENTIALS_BASE64 (Vercel) ' +
      'or GOOGLE_APPLICATION_CREDENTIALS (path to the service-account JSON, for local dev).'
  );
};

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'tuto-lk.firebasestorage.app',
  });
  console.log('🔥 Firebase Admin initialized.');
}

export const db = admin.firestore();
export const storage = admin.storage();
export const auth = admin.auth();
