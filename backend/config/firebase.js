// config/firebase.js
// Initialise Firebase Admin SDK une seule fois pour tout le backend.
// Le backend utilise le SERVICE ACCOUNT (accès total), contrairement
// à l'app Flutter qui utilise le SDK client (accès limité par les
// règles de sécurité Firestore).

const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Les \n sont stockés comme texte littéral dans le .env,
      // il faut les reconvertir en vrais retours à la ligne.
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
