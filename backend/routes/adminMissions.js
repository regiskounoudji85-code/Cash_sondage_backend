// routes/adminMissions.js
//
// Endpoints (montés sous /api/admin, déjà protégés par verifyToken +
// requireAdmin au niveau de server.js — comme le reste des routes admin) :
//   GET    /api/admin/missions
//   POST   /api/admin/missions
//   PATCH  /api/admin/missions/:id
//   DELETE /api/admin/missions/:id
//
// Collection Firestore : "missions" — MÊME schéma que celui utilisé par
// routes/missions.js (côté utilisateur), à ne jamais faire diverger :
//   { tier: number, type: 'survey_count'|'referral'|'login_streak',
//     target: number, rewardPoints: number, title: string,
//     active: boolean, createdAt }
//
// ⚠️ CALIBRAGE À RESPECTER : le système est pensé pour qu'il soit
// impossible d'atteindre le seuil de retrait bonus (15 000 FCFA) via les
// seules missions avant 4 semaines. Ça tient au fait que le palier 4
// exige un streak de connexion de 28 jours réels, et que la somme totale
// des rewardPoints de toutes les missions actives reste sous 15 000.
// Si tu ajoutes/modifies des missions ici, garde un œil sur ces deux
// points pour ne pas casser cet équilibre.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

const VALID_TYPES = ['survey_count', 'referral', 'login_streak'];

router.get('/missions', async (req, res) => {
  try {
    const snap = await db.collection('missions')
      .orderBy('tier', 'asc')
      .get();
    const missions = snap.docs
      .filter((doc) => doc.id !== '_config') // document technique de versionning du seed, pas une vraie mission
      .map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ missions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/missions', async (req, res) => {
  try {
    const { title, type, tier, target, rewardPoints } = req.body;
    if (!title || !type || !tier || !target || !rewardPoints) {
      return res.status(400).json({ error: 'title, type, tier, target et rewardPoints sont obligatoires.' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type doit être l'un de : ${VALID_TYPES.join(', ')}` });
    }

    const docRef = await db.collection('missions').add({
      title,
      type,
      tier: Number(tier),
      target: Number(target),
      rewardPoints: Number(rewardPoints),
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/missions/:id', async (req, res) => {
  try {
    if (req.params.id === '_config') {
      return res.status(400).json({ error: "Ce document est réservé au système, il n'est pas modifiable ici." });
    }
    const { title, type, tier, target, rewardPoints, active } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type doit être l'un de : ${VALID_TYPES.join(', ')}` });
      updates.type = type;
    }
    if (tier !== undefined) updates.tier = Number(tier);
    if (target !== undefined) updates.target = Number(target);
    if (rewardPoints !== undefined) updates.rewardPoints = Number(rewardPoints);
    if (active !== undefined) updates.active = !!active;

    await db.collection('missions').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/missions/:id', async (req, res) => {
  try {
    if (req.params.id === '_config') {
      return res.status(400).json({ error: "Ce document est réservé au système, il n'est pas supprimable." });
    }
    // Note : supprimer une mission ne supprime pas les réclamations déjà
    // faites par les utilisateurs (userMissions) — c'est voulu, pour
    // garder l'historique des points déjà distribués intact.
    await db.collection('missions').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
    
