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
      // Utilisateur déjà connu : on complète son profil si le nom ou le
      // téléphone manquent encore (comptes créés avant l'ajout de ces
      // champs obligatoires), sans jamais écraser des valeurs déjà en place.
      const existing = userDoc.data();
      const updates = {};
      if (!existing.phone && phone) updates.phone = phone;
      if ((!existing.displayName || existing.displayName === 'Utilisateur') && displayName) {
        updates.displayName = displayName;
      }
      if (Object.keys(updates).length > 0) {
        await userRef.update(updates);
        return res.json({ user: { ...existing, ...updates } });
      }
      return res.json({ user: existing });
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
      surveyPoints: 0,
      bonusPoints: 0,
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

      // Montant configurable depuis le Dashboard Admin (settings/referral),
      // avec une valeur par défaut si jamais réglée.
      const referralConfigDoc = await db.collection('settings').doc('referral').get();
      const referralConfig = referralConfigDoc.exists ? referralConfigDoc.data() : {};
      const referrerRewardPoints = referralConfig.referrerRewardPoints ?? 500;
      const maxReferrals = referralConfig.maxReferrals; // null/undefined = illimité

      let withinLimit = true;
      if (maxReferrals !== null && maxReferrals !== undefined) {
        const parrainDoc = parrainSnap.docs[0];
        withinLimit = (parrainDoc.data().referralCount || 0) < maxReferrals;
      }

      if (withinLimit) {
        await db.collection('referrals').add({
          referrerId: parrainId,
          referredId: uid,
          bonusPoints: referrerRewardPoints,
          status: 'pending',
          confirmedAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      // Si la limite est atteinte, le compte est quand même créé
      // normalement — seul le bonus de parrainage n'est pas généré.
    }

    res.json({ user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la synchronisation du profil' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  const userRef = db.collection('users').doc(req.user.uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return res.status(404).json({ error: 'Profil introuvable' });

  const data = userDoc.data();

  // Suivi du streak de connexion (jours consécutifs), mis à jour au
  // maximum une fois par jour civil — sert de base à la mission
  // "connecte-toi N jours d'affilée".
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const lastKey = data.lastCheckinDay || null;

  if (lastKey !== todayKey) {
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const newStreak = lastKey === yesterdayKey ? (data.loginStreak || 0) + 1 : 1;
    await userRef.update({ loginStreak: newStreak, lastCheckinDay: todayKey });
    data.loginStreak = newStreak;
    data.lastCheckinDay = todayKey;
  }

  res.json({ user: data });
});

// PATCH /api/auth/profile — modifier son nom/téléphone depuis les Paramètres,
// à tout moment (contrairement à /sync qui ne complète qu'une seule fois
// les comptes créés avant l'ajout de ces champs obligatoires).
router.patch('/profile', verifyToken, async (req, res) => {
  const { displayName, phone } = req.body;
  if (!displayName || !phone) {
    return res.status(400).json({ error: 'Le nom et le téléphone sont obligatoires.' });
  }
  const userRef = db.collection('users').doc(req.user.uid);
  await userRef.update({ displayName, phone });
  const updated = await userRef.get();
  res.json({ user: updated.data() });
});

module.exports = router;
           
