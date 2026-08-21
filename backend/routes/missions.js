// routes/missions.js
// Système de missions à paliers progressifs, inspiré de King Opinion mais
// avec une différence essentielle et non-négociable : chaque récompense
// affichée comme "créditée" est RÉELLEMENT ajoutée au solde bonus
// retirable de l'utilisateur (via applyPointsChange). Aucune mission
// n'affiche un gain qui n'existe pas vraiment.
//
// PALIERS : les missions sont regroupées en "tiers". Un palier ne
// devient visible/jouable qu'une fois TOUTES les missions du palier
// précédent réclamées — avant ça, elles s'affichent verrouillées
// ("???"), comme sur King Opinion, mais elles se débloquent pour de
// vrai (pas un simple effet visuel sans fin).
//
// CALIBRAGE DU RYTHME (4 semaines minimum) : le palier 4 exige un
// streak de connexion de 28 jours réels pour être complété — aucune
// optimisation ne permet de l'accélérer. Comme ce palier doit être
// atteint avant le palier 5, et que la somme de TOUS les paliers
// (11 750 pts) reste sous le seuil de retrait bonus (15 000 FCFA),
// personne ne peut atteindre ce seuil uniquement via les missions
// avant 4 semaines — il faut aussi du parrainage ou plus de temps.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

const SEED_VERSION = 2; // incrémenter si DEFAULT_MISSIONS change encore

const DEFAULT_MISSIONS = [
  // ---- Palier 1 : Démarrage (débloqué dès l'inscription) ----
  { id: 'survey_1', tier: 1, type: 'survey_count', target: 1, rewardPoints: 50,
    title: 'Complète ton premier sondage' },
  { id: 'streak_3', tier: 1, type: 'login_streak', target: 3, rewardPoints: 50,
    title: "Connecte-toi 3 jours d'affilée" },

  // ---- Palier 2 (débloqué après le palier 1) ----
  { id: 'survey_3', tier: 2, type: 'survey_count', target: 3, rewardPoints: 150,
    title: 'Complète trois sondages' },
  { id: 'streak_7', tier: 2, type: 'login_streak', target: 7, rewardPoints: 200,
    title: "Connecte-toi 7 jours d'affilée" },
  { id: 'referral_1', tier: 2, type: 'referral', target: 1, rewardPoints: 300,
    title: 'Parraine un ami actif' },

  // ---- Palier 3 (débloqué après le palier 2) ----
  { id: 'survey_7', tier: 3, type: 'survey_count', target: 7, rewardPoints: 400,
    title: 'Complète sept sondages' },
  { id: 'streak_14', tier: 3, type: 'login_streak', target: 14, rewardPoints: 600,
    title: "Connecte-toi 14 jours d'affilée" },

  // ---- Palier 4 (débloqué après le palier 3) — verrou des 4 semaines ----
  { id: 'survey_15', tier: 4, type: 'survey_count', target: 15, rewardPoints: 1500,
    title: 'Complète quinze sondages' },
  { id: 'streak_28', tier: 4, type: 'login_streak', target: 28, rewardPoints: 3000,
    title: "Connecte-toi 28 jours d'affilée" },

  // ---- Palier 5 (débloqué après le palier 4 — donc jamais avant 4 semaines) ----
  { id: 'survey_30', tier: 5, type: 'survey_count', target: 30, rewardPoints: 3000,
    title: 'Complète trente sondages' },
  { id: 'referral_3', tier: 5, type: 'referral', target: 3, rewardPoints: 2500,
    title: 'Parraine trois amis actifs' },
];

// Insère/actualise les missions par défaut si la version a changé.
// Ne touche jamais aux réclamations déjà faites (userMissions).
async function ensureSeeded() {
  const configRef = db.collection('missions').doc('_config');
  const configDoc = await configRef.get();
  if (configDoc.exists && configDoc.data().seedVersion >= SEED_VERSION) return;

  const batch = db.batch();
  for (const m of DEFAULT_MISSIONS) {
    const ref = db.collection('missions').doc(m.id);
    batch.set(ref, { ...m, active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  batch.set(configRef, { seedVersion: SEED_VERSION, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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

// GET /api/missions — liste des missions groupées par palier, avec statut réel
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

    // On exclut le document technique "_config" (ce n'est pas une mission)
    const raw = missionsSnap.docs.filter((d) => d.id !== '_config').map((d) => ({ id: d.id, ...d.data() }));

    // Un palier est débloqué si tous ses numéros de palier précédents
    // ont chacun 100% de leurs missions réclamées.
    const tiers = [...new Set(raw.map((m) => m.tier))].sort((a, b) => a - b);
    const tierUnlocked = {};
    let previousTiersComplete = true;
    for (const tier of tiers) {
      tierUnlocked[tier] = previousTiersComplete;
      const missionsInTier = raw.filter((m) => m.tier === tier);
      const allClaimedInTier = missionsInTier.every((m) => claimedIds.has(m.id));
      previousTiersComplete = previousTiersComplete && allClaimedInTier;
    }

    const missions = await Promise.all(raw.map(async (m) => {
      const claimed = claimedIds.has(m.id);
      const unlocked = tierUnlocked[m.tier];
      let progress = 0;
      let status;
      if (claimed) {
        status = 'claimed';
      } else if (!unlocked) {
        status = 'tier_locked'; // palier pas encore débloqué : affiché "???"
      } else {
        progress = await getProgress(userId, userData, m.type);
        status = progress >= m.target ? 'ready' : 'locked';
      }
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

    // Revérifie côté serveur que le palier est bien débloqué (toutes les
    // missions des paliers précédents réclamées), jamais confiance au
    // client sur ce point.
    const [allMissionsSnap, userDoc, claimedSnap] = await Promise.all([
      db.collection('missions').where('active', '==', true).get(),
      db.collection('users').doc(userId).get(),
      db.collection('userMissions').where('userId', '==', userId).get(),
    ]);
    const raw = allMissionsSnap.docs.filter((d) => d.id !== '_config').map((d) => ({ id: d.id, ...d.data() }));
    const claimedIds = new Set(claimedSnap.docs.map((d) => d.data().missionId));
    const earlierTierMissions = raw.filter((m) => m.tier < mission.tier);
    const earlierTiersComplete = earlierTierMissions.every((m) => claimedIds.has(m.id));
    if (!earlierTiersComplete) {
      return res.status(400).json({ error: 'Palier pas encore débloqué' });
    }

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
