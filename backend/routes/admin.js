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
      title, sponsor, sponsorLogo, introDescription,
      pointsReward, durationMinutes, targetCriteria,
      maxResponses, expiresAt, questions, featured,
    } = req.body;

    if (!title || !sponsor) {
      return res.status(400).json({ error: 'Le titre et l\'annonceur sont obligatoires.' });
    }

    // Bug corrigé : new Date(expiresAt) sur une valeur vide/mal formée
    // produit un "Invalid Date", qui faisait planter Firestore au moment
    // de l'écriture avec "Invalid time value". On valide AVANT d'écrire.
    let expiresAtDate = null;
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Date d\'expiration invalide.' });
      }
      expiresAtDate = parsed;
    }

    // Valide la structure des questions avant d'écrire quoi que ce soit —
    // mieux vaut un rejet propre à la création qu'un sondage à moitié
    // utilisable découvert plus tard par un utilisateur.
    let cleanQuestions = [];
    if (Array.isArray(questions)) {
      cleanQuestions = questions.map((q, i) => {
        if (!q.text) {
          throw new Error(`Question ${i + 1} invalide : un texte est requis.`);
        }
        // "text" = réponse libre écrite par l'utilisateur, pas d'options.
        // Les autres types (choix) exigent au moins 2 options.
        const type = q.type === 'text' ? 'text'
          : q.type === 'multiple_choice' ? 'multiple_choice'
          : 'single_choice';

        if (type !== 'text' && (!Array.isArray(q.options) || q.options.length < 2)) {
          throw new Error(`Question ${i + 1} invalide : au moins 2 options sont requises pour une question à choix.`);
        }

        return {
          id: q.id || `q${i + 1}`,
          text: q.text,
          type,
          options: type === 'text' ? [] : q.options,
        };
      });
    }

    const surveyRef = await db.collection('surveys').add({
      title, sponsor, sponsorLogo: sponsorLogo || null,
      introDescription: introDescription || '',
      questions: cleanQuestions,
      featured: !!featured,
      pointsReward, durationMinutes,
      targetCriteria: targetCriteria || {},
      status: 'active',
      maxResponses, currentResponses: 0,
      createdBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: expiresAtDate,
    });

    res.json({ success: true, surveyId: surveyRef.id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Erreur lors de la création du sondage' });
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

// DELETE /api/admin/surveys/:id — retire le sondage de la liste des
// sondages disponibles. Les réponses déjà soumises et les points déjà
// crédités aux utilisateurs restent intacts (collection surveyResponses
// et transactions non touchées) — supprimer un sondage n'annule jamais
// rétroactivement ce qui a déjà été gagné.
router.delete('/surveys/:id', async (req, res) => {
  try {
    const ref = db.collection('surveys').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Sondage introuvable' });
    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du sondage' });
  }
});

// GET /api/admin/surveys/:id/responses/summary — répartition des
// réponses par question/option, pour voir ce que les utilisateurs ont
// réellement répondu sans avoir à fouiller Firestore à la main.
router.get('/surveys/:id/responses/summary', async (req, res) => {
  try {
    const surveyDoc = await db.collection('surveys').doc(req.params.id).get();
    if (!surveyDoc.exists) return res.status(404).json({ error: 'Sondage introuvable' });
    const survey = surveyDoc.data();

    const responsesSnap = await db.collection('surveyResponses')
      .where('surveyId', '==', req.params.id)
      .get();
    const responses = responsesSnap.docs.map((d) => d.data());

    const questions = survey.questions || [];
    const summary = questions.map((q) => {
      if (q.type === 'text') {
        // Question texte libre : pas de comptage possible, on renvoie
        // directement les réponses écrites par les utilisateurs.
        const textAnswers = responses
          .map((r) => r.answers?.[q.id])
          .filter((a) => a && String(a).trim() !== '');
        return { questionId: q.id, text: q.text, type: 'text', textAnswers };
      }

      const counts = q.options.map(() => 0);
      responses.forEach((r) => {
        const answerIdx = parseInt(r.answers?.[q.id], 10);
        if (!isNaN(answerIdx) && counts[answerIdx] !== undefined) counts[answerIdx]++;
      });
      return {
        questionId: q.id,
        text: q.text,
        type: 'single_choice',
        options: q.options.map((opt, i) => ({ text: opt, count: counts[i] })),
      };
    });

    res.json({ totalResponses: responses.length, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des réponses' });
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
  
