// routes/adminPromoCodes.js
//
// Endpoints admin (montés sous /api/admin, protégés par verifyToken +
// requireAdmin au niveau de server.js) :
//   GET    /api/admin/promo-codes
//   POST   /api/admin/promo-codes
//   PATCH  /api/admin/promo-codes/:id
//   DELETE /api/admin/promo-codes/:id
//
// Endpoint public utilisateur (à monter séparément, voir server.js) :
//   POST   /api/promo-codes/redeem   { code }
//
// Collection Firestore : "promoCodes"
// { code, rewardPoints, maxUses, usedCount, expiresAt, status: 'active'|'expired', createdAt }
//
// Le bonus d'un code promo est crédité dans le compartiment BONUS
// (bonusPoints, seuil de retrait 15 000 FCFA) — comme les missions et le
// parrainage — jamais dans le solde sondages, pour ne pas court-circuiter
// le rythme prévu. Passe par applyPointsChange pour que ce soit tracé
// dans les transactions comme tout le reste.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

router.get('/promo-codes', async (req, res) => {
  try {
    const snap = await db.collection('promoCodes').orderBy('createdAt', 'desc').get();
    const promoCodes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ promoCodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/promo-codes', async (req, res) => {
  try {
    const { code, rewardPoints, maxUses, expiresAt } = req.body;
    if (!code || !rewardPoints) return res.status(400).json({ error: 'Code et récompense sont obligatoires.' });

    const codeUpper = code.toUpperCase().trim();
    const existing = await db.collection('promoCodes').where('code', '==', codeUpper).get();
    if (!existing.empty) return res.status(409).json({ error: 'Ce code existe déjà.' });

    const docRef = await db.collection('promoCodes').add({
      code: codeUpper,
      rewardPoints,
      maxUses: maxUses || null,
      usedCount: 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/promo-codes/:id', async (req, res) => {
  try {
    const { status, maxUses, expiresAt } = req.body;
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (maxUses !== undefined) updates.maxUses = maxUses;
    if (expiresAt !== undefined) updates.expiresAt = new Date(expiresAt);

    await db.collection('promoCodes').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/promo-codes/:id', async (req, res) => {
  try {
    await db.collection('promoCodes').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ---------- Route CÔTÉ UTILISATEUR pour utiliser un code ----------
// Montée séparément sur /api (voir server.js), avec l'authentification
// utilisateur normale (verifyToken), pas les droits admin.
const publicRouter = express.Router();

publicRouter.post('/promo-codes/redeem', verifyToken, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code manquant.' });

    const codeUpper = code.toUpperCase().trim();
    const snap = await db.collection('promoCodes').where('code', '==', codeUpper).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'Code introuvable.' });

    const doc = snap.docs[0];
    const data = doc.data();

    if (data.status !== 'active') return res.status(400).json({ error: "Ce code n'est plus actif." });
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      await doc.ref.update({ status: 'expired' });
      return res.status(400).json({ error: 'Ce code a expiré.' });
    }
    if (data.maxUses && data.usedCount >= data.maxUses) {
      return res.status(400).json({ error: "Ce code a atteint sa limite d'utilisation." });
    }

    // Crédite le solde bonus (pas le solde sondages), et incrémente le
    // compteur d'utilisation du code — applyPointsChange se charge déjà
    // d'écrire la transaction correspondante, pas besoin de le refaire ici.
    const newBalance = await applyPointsChange(req.user.uid, data.rewardPoints, 'promo_code_redeemed', doc.id);
    await doc.ref.update({ usedCount: admin.firestore.FieldValue.increment(1) });

    res.json({ success: true, rewardPoints: data.rewardPoints, newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = { adminRouter: router, publicRouter };
