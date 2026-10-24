// config/firebase.js
// Initialise Firebase Admin SDK une seule fois pour tout le backend.
// Le backend utilise le SERVICE ACCOUNT (accès total), contrairement
// à l'app Flutter qui utilise le SDK client (accès limité par les
// règles de sécurité Firestore).

const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // Méthode recommandée : coller le fichier JSON de la clé de
    // service TEL QUEL dans une seule variable. JSON.parse() gère
    // nativement l'échappement des \n dans le champ private_key —
    // plus aucune extraction/conversion manuelle, donc plus aucun
    // risque de guillemets oubliés, de tirets corrompus par un
    // éditeur "intelligent", etc.
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Ancienne méthode (3 variables séparées), conservée en repli
    // pour compatibilité — accepte les deux formats de private_key
    // ("\n" littéraux ou vrais retours à la ligne).
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    });
  }

  admin.initializeApp({ credential });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
  
