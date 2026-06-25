import * as admin from 'firebase-admin';

// Explicitly pull these from Vercel's Environment Variables
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // Ensure your private key has its newlines correctly parsed
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as any),
  });
  console.log("🔥 Firebase Admin successfully initialized with explicit config.");
}

export const db = admin.firestore();
export const storage = admin.storage();