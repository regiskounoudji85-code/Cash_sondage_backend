// routes/surveys.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

// GET /api/surveys
// Retourne les sondages actifs, filtrés grossièrement selon le profil
// utilisateur (pays). Un filtrage plus fin (âge, genre) peut être fait
// côté client ou affiné ici plus tard.
router.get('/', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userCountry = userDoc.exists ? userDoc.data().country : null;

    let query = db.collection('surveys')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .limit(50);

    const snap = await query.get();
    const surveys = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => {
        const countries = s.targetCriteria?.countries;
        if (!countries || countries.length === 0) return true;
        return countries.includes(userCountry);
      })
      .filter((s) => s.currentResponses < s.maxResponses);

    res.json({ surveys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des sondages' });
  }
});

// POST /api/surveys/:surveyId/complete
router.post('/:surveyId/complete', verifyToken, async (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.uid;

  try {
    const surveyRef = db.collection('surveys').doc(surveyId);
    const surveyDoc = await surveyRef.get();
    if (!surveyDoc.exists) return res.status(404).json({ error: 'Sondage introuvable' });

    const survey = surveyDoc.data();
    if (survey.status !== 'active') {
      return res.status(400).json({ error: 'Ce sondage n\'est plus disponible' });
    }
    if (survey.currentResponses >= survey.maxResponses) {
      return res.status(400).json({ error: 'Quota de réponses atteint' });
    }

    // Anti-fraude basique : empêcher une double réponse au même sondage
    const existingResponse = await db.collection('surveyResponses')
      .where('userId', '==', userId)
      .where('surveyId', '==', surveyId)
      .limit(1)
      .get();
    if (!existingResponse.empty) {
      return res.status(400).json({ error: 'Sondage déjà complété' });
    }

    // Hash de l'IP plutôt que stockage brut (anti-fraude sans exposer
    // de donnée personnelle identifiable en clair)
    const ipHash = crypto.createHash('sha256')
      .update(req.ip || 'unknown')
      .digest('hex');

    await db.collection('surveyResponses').add({
      userId,
      surveyId,
      pointsAwarded: survey.pointsReward,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      ipHash,
    });

    await surveyRef.update({
      currentResponses: admin.firestore.FieldValue.increment(1),
    });

    const newBalance = await applyPointsChange(
      userId,
      survey.pointsReward,
      'survey_reward',
      surveyId
    );

    // Si c'est le PREMIER sondage complété par cet utilisateur, on
    // débloque le bonus de parrainage en attente pour son parrain.
    const allResponses = await db.collection('surveyResponses')
      .where('userId', '==', userId)
      .get();

    if (allResponses.size === 1) {
      await confirmReferralBonus(userId);
    }

    res.json({ success: true, pointsAwarded: survey.pointsReward, newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la validation du sondage' });
  }
});

// Débloque le bonus du parrain une fois que le filleul a fait sa
// première action réelle sur l'app (évite les faux comptes).
async function confirmReferralBonus(referredId) {
  const referralSnap = await db.collection('referrals')
    .where('referredId', '==', referredId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (referralSnap.empty) return;

  const referralDoc = referralSnap.docs[0];
  const referral = referralDoc.data();

  await applyPointsChange(referral.referrerId, referral.bonusPoints, 'referral_bonus', referralDoc.id);

  await referralDoc.ref.update({
    status: 'confirmed',
    confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(referral.referrerId).update({
    referralCount: admin.firestore.FieldValue.increment(1),
    referralBonusEarned: admin.firestore.FieldValue.increment(referral.bonusPoints),
  });
}

module.exports = router;
