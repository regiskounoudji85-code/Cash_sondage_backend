// routes/referral.js
// Le parrainage est INCITATIF : il ajoute un bonus, mais ne conditionne
// jamais l'accès aux gains déjà acquis par l'utilisateur (voir
// routes/withdrawal.js — le seuil de retrait ne dépend que des points).

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

// GET /api/referral/me
// Retourne le code de parrainage de l'utilisateur + la liste de ses
// filleuls confirmés (avec bonus déjà touché) et en attente.
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const { referralCode, referralCount, referralBonusEarned } = userDoc.data();

    const referralsSnap = await db.collection('referrals')
      .where('referrerId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const referrals = referralsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({
      referralCode,
      referralCount,
      referralBonusEarned,
      referrals,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement du parrainage' });
  }
});

module.exports = router;
