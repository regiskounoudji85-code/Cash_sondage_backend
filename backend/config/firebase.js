// config/firebase.js
// Initialise Firebase Admin SDK une seule fois pour tout le backend.
// Le backend utilise le SERVICE ACCOUNT (accès total), contrairement
// à l'app Flutter qui utilise le SDK client (accès limité par les
// règles de sécurité Firestore).

const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  // FIREBASE_PRIVATE_KEY doit contenir la clé avec de VRAIS retours à
  // la ligne (pas des "\n" littéraux) — c'est ce que Railway permet de
  // coller directement dans l'éditeur de variable. On ne fait PLUS de
  // conversion ici : un .replace(/\\n/g, '\n') sur une valeur qui a
  // déjà de vrais retours à la ligne ne fait rien de mal en soi, mais
  // le risque venait du copier-coller qui altérait le format attendu.
  // On garde quand même un filet : si jamais la valeur contient encore
  // des "\n" littéraux (ancien format), on les convertit aussi — cette
  // version accepte les DEUX formats sans planter.
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
