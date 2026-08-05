// routes/admin.js
// Toutes ces routes exigent verifyToken + requireAdmin (voir index.js)

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { applyPointsChange } = require('../utils/points');

// ---------- SONDAGES ----------

// POST /api/admin/surveys — créer un sondage (côté annonceur/admin)
router.post('/surveys', async (req, res) => {
  try {
    const {
      title, sponsor, sponsorLogo, description,
      pointsReward, durationMinutes, targetCriteria,
      maxResponses, expiresAt,
    } = req.body;

    const surveyRef = await db.collection('surveys').add({
      title, sponsor, sponsorLogo: sponsorLogo || null, description,
      pointsReward, durationMinutes,
      targetCriteria: targetCriteria || {},
      status: 'active',
      maxResponses, currentResponses: 0,
      createdBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(expiresAt),
    });

    res.json({ success: true, surveyId: surveyRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du sondage' });
  }
});

// PATCH /api/admin/surveys/:id — pause/reprise/modification
router.patch('/surveys/:id', async (req, res) => {
  try {
    await db.collection('surveys').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour du sondage' });
  }
});

// ---------- UTILISATEURS ----------

// GET /api/admin/users?limit=50&cursor=xxx
router.get('/users', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  let query = db.collection('users').orderBy('createdAt', 'desc').limit(limit);
  if (req.query.cursor) {
    const cursorDoc = await db.collection('users').doc(req.query.cursor).get();
    query = query.startAfter(cursorDoc);
  }
  const snap = await query.get();
  res.json({ users: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

// PATCH /api/admin/users/:id/status — suspendre/bannir un utilisateur
router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body; // active | suspended | banned
  if (!['active', 'suspended', 'banned'].includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  await db.collection('users').doc(req.params.id).update({ status });
  res.json({ success: true });
});

// ---------- RETRAITS ----------

// GET /api/admin/withdrawals?status=pending
router.get('/withdrawals', async (req, res) => {
  const status = req.query.status || 'pending';
  const snap = await db.collection('withdrawals')
    .where('status', '==', status)
    .orderBy('requestedAt', 'asc')
    .get();
  res.json({ withdrawals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

// POST /api/admin/withdrawals/:id/approve
// L'admin confirme qu'il a bien envoyé l'argent via MoMo/PayPal.
router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const ref = db.collection('withdrawals').doc(req.params.id);
    await ref.update({
      status: 'paid',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: req.user.uid,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la validation du retrait' });
  }
});

// POST /api/admin/withdrawals/:id/reject
// Body: { reason }. Recrédite les points au user (ils avaient été
// réservés au moment de la demande, voir routes/withdrawal.js).
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const ref = db.collection('withdrawals').doc(req.params.id);
    const doc = await ref.get();
    const w = doc.data();

    if (w.status !== 'pending') {
      return res.status(400).json({ error: 'Ce retrait a déjà été traité' });
    }

    // Le type de transaction distingue le compartiment à recréditer :
    // un retrait "survey" rejeté doit revenir dans surveyPoints, un
    // retrait "bonus" rejeté doit revenir dans bonusPoints.
    const refundType = w.source === 'bonus' ? 'admin_adjustment_bonus' : 'admin_adjustment_survey';
    await applyPointsChange(w.userId, w.pointsDeducted, refundType, ref.id);

    await ref.update({
      status: 'rejected',
      adminNote: req.body.reason || null,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: req.user.uid,
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du rejet du retrait' });
  }
});

// ---------- STATISTIQUES ----------

// GET /api/admin/stats — vue d'ensemble pour le dashboard
router.get('/stats', async (req, res) => {
  try {
    const [usersSnap, surveysSnap, pendingWithdrawalsSnap, paidWithdrawalsSnap] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('surveys').where('status', '==', 'active').count().get(),
      db.collection('withdrawals').where('status', '==', 'pending').get(),
      db.collection('withdrawals').where('status', '==', 'paid').get(),
    ]);

    const pendingTotal = pendingWithdrawalsSnap.docs.reduce((sum, d) => sum + d.data().amountFcfa, 0);
    const paidTotal = paidWithdrawalsSnap.docs.reduce((sum, d) => sum + d.data().amountFcfa, 0);

    res.json({
      totalUsers: usersSnap.data().count,
      activeSurveys: surveysSnap.data().count,
      pendingWithdrawalsCount: pendingWithdrawalsSnap.size,
      pendingWithdrawalsFcfa: pendingTotal,
      totalPaidFcfa: paidTotal,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des statistiques' });
  }
});

module.exports = router;
            
