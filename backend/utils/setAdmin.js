// utils/setAdmin.js
// Script à lancer manuellement (jamais exposé via une route API) pour
// donner les droits admin à un utilisateur, via son UID Firebase.
//
// Usage : node utils/setAdmin.js <uid>

const { auth } = require('../config/firebase');

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node utils/setAdmin.js <uid>');
  process.exit(1);
}

auth.setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`✅ L'utilisateur ${uid} est maintenant admin.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erreur:', err);
    process.exit(1);
  });
