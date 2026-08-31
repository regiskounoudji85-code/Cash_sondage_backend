// routes/adminReferrals.js
//
// Endpoints (montés sous /api/admin, déjà protégés par verifyToken +
// requireAdmin au niveau de server.js) :
//   GET   /api/admin/referrals            → KPI + top parrains
//   GET   /api/admin/settings/referral     → config actuelle
//   PATCH /api/admin/settings/referral     → mise à jour config
//
// Utilise le champ "referredBy" (uid du parrain) posé sur le compte du
// filleul à l'inscription (routes/auth.js), et "referralBonusEarned"
// (PAS "referralEarnings") déjà incrémenté sur le compte du parrain à
// chaque bonus confirmé (routes/surveys.js).
//
// La config settings/referral est déjà branchée : referrerRewardPoints
// et refereeRewardPoints sont lus par routes/auth.js et routes/surveys.js
// à chaque nouveau parrainage — modifier ces valeurs ici a un effet réel.
// maxReferrals (illimité si null) est aussi respecté à l'inscription.

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

router.get('/referrals', async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const referredUsers = users.filter((u) => u.referredBy);
    const referrerCounts = {}; // uid -> nombre de filleuls

    referredUsers.forEach((u) => {
      referrerCounts[u.referredBy] = (referrerCounts[u.referredBy] || 0) + 1;
    });

    const activeReferrers = Object.keys(referrerCounts).length;
    const conversionRate = users.length > 0 ? Math.round((referredUsers.length / users.length) * 100) : 0;

    // Top 10 parrains, triés par nombre de filleuls
    const topReferrerIds = Object.entries(referrerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([uid]) => uid);

    const topReferrers = topReferrerIds.map((uid) => {
      const user = users.find((u) => u.id === uid);
      return {
        id: uid,
        name: (user && user.displayName) || 'Utilisateur supprimé',
        referrals: referrerCounts[uid],
        earnings: (user && user.referralBonusEarned) || 0,
      };
    });

    const totalDistributed = users.reduce((sum, u) => sum + (u.referralBonusEarned || 0), 0);

    res.json({
      totalReferred: referredUsers.length,
      activeReferrers,
      totalDistributed,
      conversionRate,
      topReferrers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/settings/referral', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('referral').get();
    res.json(doc.exists ? doc.data() : {
      referrerRewardPoints: 500,
      refereeRewardPoints: 0,
      maxReferrals: null, // null = illimité
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/settings/referral', async (req, res) => {
  try {
    const { referrerRewardPoints, refereeRewardPoints, maxReferrals } = req.body;
    await db.collection('settings').doc('referral').set(
      { referrerRewardPoints, refereeRewardPoints, maxReferrals },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
