// routes/missions.js
// Système de missions inspiré de King Opinion, MAIS avec une différence
// essentielle et non-négociable : chaque récompense affichée comme
// "créditée" est RÉELLEMENT ajoutée au solde retirable de l'utilisateur
// via applyPointsChange (le même ledger que pour les sondages). Aucune
// mission n'affiche un gain qui n'existe pas vraiment.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

// Missions par défaut, insérées une seule fois si la collection est vide.
// Valeurs volontairement modestes : ces points tombent dans le solde
// "bonus" séparé (missions + parrainage), avec son propre seuil de
// retrait — on évite qu'il soit atteint trop vite uniquement via les
// missions. À ajuster dans Firestore selon ton pointToFcfaRate réel.
const DEFAULT_MISSIONS = [
  { id: 'survey_2', type: 'survey_count', target: 2, rewardPoints: 30,
    title: 'Complète deux sondages', icon: '📋' },
  { id: 'survey_5', type: 'survey_count', target: 5, rewardPoints: 60,
    title: 'Complète cinq sondages', icon: '📋' },
  { id: 'survey_10', type: 'survey_count', target: 10, rewardPoints: 120,
    title: 'Complète dix sondages', icon: '📋' },
  { id: 'referral_1', type: 'referral', target: 1, rewardPoints: 50,
    title: 'Parraine un ami actif', icon: '🤝' },
  { id: 'streak_7', type: 'login_streak', target: 7, rewardPoints: 70,
    title: "Connecte-toi 7 jours d'affilée", icon: '🔥' },
];

async function ensureSeeded() {
  const snap = await db.collection('missions').limit(1).get();
  if (!snap.empty) return;
  const batch = db.batch();
  for (const m of DEFAULT_MISSIONS) {
    const ref = db.collection('missions').doc(m.id);
    batch.set(ref, { ...m, active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  await batch.commit();
}

// Calcule la progression réelle d'un utilisateur pour un type de mission
// donné — jamais fait confiance à une valeur envoyée par le client.
async function getProgress(userId, userData, type) {
  if (type === 'survey_count') {
    const snap = await db.collection('surveyResponses').where('userId', '==', userId).get();
    return snap.size;
  }
  if (type === 'referral') {
    return userData.referralCount || 0;
  }
  if (type === 'login_streak') {
    return userData.loginStreak || 0;
  }
  return 0;
}

// GET /api/missions — liste des missions avec statut réel pour l'utilisateur
router.get('/', verifyToken, async (req, res) => {
  try {
    await ensureSeeded();
    const userId = req.user.uid;

    const [missionsSnap, userDoc, claimedSnap] = await Promise.all([
      db.collection('missions').where('active', '==', true).get(),
      db.collection('users').doc(userId).get(),
      db.collection('userMissions').where('userId', '==', userId).get(),
    ]);

    const userData = userDoc.exists ? userDoc.data() : {};
    const claimedIds = new Set(claimedSnap.docs.map((d) => d.data().missionId));

    const missions = await Promise.all(missionsSnap.docs.map(async (d) => {
      const m = { id: d.id, ...d.data() };
      const progress = await getProgress(userId, userData, m.type);
      const claimed = claimedIds.has(m.id);
      const status = claimed ? 'claimed' : (progress >= m.target ? 'ready' : 'locked');
      return { ...m, progress, status };
    }));

    res.json({ missions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des missions' });
  }
});

// POST /api/missions/:missionId/claim — récupère réellement la récompense
router.post('/:missionId/claim', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { missionId } = req.params;

  try {
    const missionDoc = await db.collection('missions').doc(missionId).get();
    if (!missionDoc.exists || !missionDoc.data().active) {
      return res.status(404).json({ error: 'Mission introuvable' });
    }
    const mission = missionDoc.data();

    const claimRef = db.collection('userMissions').doc(`${userId}_${missionId}`);
    const alreadyClaimed = await claimRef.get();
    if (alreadyClaimed.exists) {
      return res.status(400).json({ error: 'Récompense déjà réclamée' });
    }

    // On revérifie la progression côté serveur avant de créditer quoi
    // que ce soit — jamais confiance au fait que le bouton était affiché.
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const progress = await getProgress(userId, userData, mission.type);
    if (progress < mission.target) {
      return res.status(400).json({ error: 'Mission pas encore complétée' });
    }

    const newBalance = await applyPointsChange(userId, mission.rewardPoints, 'mission_reward', missionId);
    await claimRef.set({
      userId, missionId,
      pointsAwarded: mission.rewardPoints,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, pointsAwarded: mission.rewardPoints, newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la réclamation de la récompense' });
  }
});

module.exports = router;
