// routes/withdrawal.js
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

// POST /api/withdrawal/request
// Body: { source: "survey"|"bonus", method: "momo_mtn"|"momo_moov"|"paypal", destinationAccount }
// "survey" = solde des sondages complétés (seuil 14 000 FCFA par défaut)
// "bonus"  = solde missions + parrainage, séparé (seuil 15 000 FCFA par défaut)
router.post('/request', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { method, destinationAccount, source } = req.body;

  if (!['survey', 'bonus'].includes(source)) {
    return res.status(400).json({ error: 'Source de retrait invalide (survey ou bonus)' });
  }
  if (!['momo_mtn', 'momo_moov', 'paypal'].includes(method)) {
    return res.status(400).json({ error: 'Méthode de retrait invalide' });
  }
  if (!destinationAccount) {
    return res.status(400).json({ error: 'Compte destinataire requis' });
  }

  try {
    const configDoc = await db.collection('config').doc('app').get();
    const cfg = configDoc.data() || {};
    // 1 point = 1 FCFA par défaut, comme partout ailleurs dans l'app
    // (missions, parrainage, soldes affichés). Sans cette valeur par
    // défaut, un champ non configuré rendait le calcul NaN et
    // contournait silencieusement la vérification de seuil.
    const pointToFcfaRate = cfg.pointToFcfaRate ?? 1;
    // Seuils séparés — valeurs par défaut si pas encore réglées dans Firestore.
    const threshold = source === 'survey'
      ? (cfg.withdrawalThresholdSurveyFcfa ?? 14000)
      : (cfg.withdrawalThresholdBonusFcfa ?? 15000);
    const field = source === 'survey' ? 'surveyPoints' : 'bonusPoints';

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const points = userDoc.data()[field] || 0;
    const balanceFcfa = points * pointToFcfaRate;

    if (balanceFcfa < threshold) {
      return res.status(400).json({
        error: `Seuil de retrait non atteint (${balanceFcfa}/${threshold} FCFA)`,
      });
    }

    // Vérifie qu'il n'y a pas déjà une demande en attente SUR CETTE SOURCE
    // (les deux compartiments peuvent avoir chacun une demande en cours).
    const pendingSnap = await db.collection('withdrawals')
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .where('source', '==', source)
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return res.status(400).json({ error: 'Une demande de retrait est déjà en attente pour ce solde' });
    }

    // On réserve les points immédiatement, dans le bon compartiment —
    // via applyPointsChange pour que ça apparaisse dans le registre des
    // transactions (utilisé par le Dashboard Admin).
    await applyPointsChange(userId, -points, source === 'survey' ? 'withdrawal_survey' : 'withdrawal_bonus', null);

    const withdrawalRef = await db.collection('withdrawals').add({
      userId,
      source,
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
  
