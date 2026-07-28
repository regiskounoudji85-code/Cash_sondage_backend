// routes/auth.js
// L'inscription/connexion elle-même (email, Google, téléphone) se fait
// CÔTÉ FLUTTER avec le SDK Firebase Auth client. Ce backend n'a qu'un
// rôle : créer/compléter le profil Firestore après la première
// connexion, et générer un code de parrainage unique.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 (ambiguïté)
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// POST /api/auth/sync
// Appelé par l'app juste après la connexion Firebase (email/Google/tel).
// Body: { phone?, momoNumber?, displayName?, referralCodeUsed?, country }
router.post('/sync', verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { phone, momoNumber, displayName, referralCodeUsed, country } = req.body;

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      // Utilisateur déjà connu, on retourne juste son profil
      return res.json({ user: userDoc.data() });
    }

    // Nouvel utilisateur : on valide le code de parrainage s'il y en a un
    let referredBy = null;
    if (referralCodeUsed) {
      const parrainSnap = await db.collection('users')
        .where('referralCode', '==', referralCodeUsed.toUpperCase())
        .limit(1)
        .get();
      if (!parrainSnap.empty) {
        referredBy = referralCodeUsed.toUpperCase();
      }
      // Si le code n'existe pas, on ignore silencieusement plutôt que
      // de bloquer l'inscription — un mauvais code ne doit jamais
      // empêcher quelqu'un de créer son compte.
    }

    const newUser = {
      email: email || null,
      phone: phone || null,
      momoNumber: momoNumber || null,
      displayName: displayName || 'Utilisateur',
      points: 0,
      totalEarned: 0,
      vipLevel: 'bronze',
      referralCode: generateReferralCode(),
      referredBy,
      referralCount: 0,
      referralBonusEarned: 0,
      status: 'active',
      country: country || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userRef.set(newUser);

    // On crée l'enregistrement de parrainage en "pending" — le bonus
    // ne sera versé que quand ce nouvel utilisateur complète son
    // premier sondage (voir routes/surveys.js), pour éviter les faux
    // comptes créés juste pour toucher le bonus.
    if (referredBy) {
      const parrainSnap = await db.collection('users')
        .where('referralCode', '==', referredBy)
        .limit(1)
        .get();
      const parrainId = parrainSnap.docs[0].id;

      await db.collection('referrals').add({
        referrerId: parrainId,
        referredId: uid,
        bonusPoints: 500,
        status: 'pending',
        confirmedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.json({ user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la synchronisation du profil' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  const userDoc = await db.collection('users').doc(req.user.uid).get();
  if (!userDoc.exists) return res.status(404).json({ error: 'Profil introuvable' });
  res.json({ user: userDoc.data() });
});

module.exports = router;
