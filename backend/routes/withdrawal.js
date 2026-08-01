// routes/withdrawal.js
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

// POST /api/withdrawal/request
// Body: { method: "momo_mtn"|"momo_moov"|"paypal", destinationAccount }
router.post('/request', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { method, destinationAccount } = req.body;

  if (!['momo_mtn', 'momo_moov', 'paypal'].includes(method)) {
    return res.status(400).json({ error: 'Méthode de retrait invalide' });
  }
  if (!destinationAccount) {
    return res.status(400).json({ error: 'Compte destinataire requis' });
  }

  try {
    const configDoc = await db.collection('config').doc('app').get();
    const { withdrawalThresholdFcfa, pointToFcfaRate } = configDoc.data();

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const points = userDoc.data().points || 0;
    const balanceFcfa = points * pointToFcfaRate;

    // SEULE condition de retrait : avoir atteint le seuil de points.
    // Pas de condition de parrainage.
    if (balanceFcfa < withdrawalThresholdFcfa) {
      return res.status(400).json({
        error: `Seuil de retrait non atteint (${balanceFcfa}/${withdrawalThresholdFcfa} FCFA)`,
      });
    }

    // Vérifie qu'il n'y a pas déjà une demande en attente
    const pendingSnap = await db.collection('withdrawals')
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return res.status(400).json({ error: 'Une demande de retrait est déjà en attente' });
    }

    // On réserve les points immédiatement (évite qu'il les dépense
    // ailleurs pendant que la demande est en attente de validation)
    await userRef.update({
      points: admin.firestore.FieldValue.increment(-points),
    });

    const withdrawalRef = await db.collection('withdrawals').add({
      userId,
      amountFcfa: balanceFcfa,
      pointsDeducted: points,
      method,
      destinationAccount,
      status: 'pending',
      adminNote: null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: null,
      processedBy: null,
    });

    res.json({ success: true, withdrawalId: withdrawalRef.id, amountFcfa: balanceFcfa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la demande de retrait' });
  }
});

// GET /api/withdrawal/history
router.get('/history', verifyToken, async (req, res) => {
  const snap = await db.collection('withdrawals')
    .where('userId', '==', req.user.uid)
    .orderBy('requestedAt', 'desc')
    .get();
  res.json({ withdrawals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

// GET /api/withdrawal/recent-public
// Flux PUBLIC et RÉEL des derniers retraits approuvés, anonymisé
// (prénom + initiale). Remplace les fausses notifications : ça donne
// la même dynamique de preuve sociale mais sans rien inventer.
router.get('/recent-public', async (req, res) => {
  try {
    const snap = await db.collection('withdrawals')
      .where('status', '==', 'paid')
      .orderBy('processedAt', 'desc')
      .limit(20)
      .get();

    const items = await Promise.all(snap.docs.map(async (d) => {
      const w = d.data();
      const userDoc = await db.collection('users').doc(w.userId).get();
      const name = userDoc.exists ? userDoc.data().displayName : 'Utilisateur';
      return {
        displayName: anonymize(name),
        country: userDoc.exists ? userDoc.data().country : null,
        amountFcfa: w.amountFcfa,
        processedAt: w.processedAt,
      };
    }));

    res.json({ items });
  } catch (err) {
    console.error('Erreur /withdrawal/recent-public :', err.message);
    res.status(200).json({ items: [] }); // on renvoie une liste vide plutôt que de planter
  }
});

function anonymize(name) {
  if (!name) return 'Utilisateur';
  const parts = name.trim().split(' ');
  return parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
}

module.exports = router;
        
