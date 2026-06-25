import * as admin from 'firebase-admin';

// Decode the base64 string back into a JSON object
const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 || '', 'base64').toString('utf-8')
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Firebase Admin initialized via Base64 decoded credentials.");
}

export const db = admin.firestore();
export const storage = admin.storage();
export const auth = admin.auth(); // <-- THIS WAS THE MISSING PIECE!