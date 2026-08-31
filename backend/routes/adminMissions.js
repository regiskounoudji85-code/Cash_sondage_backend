// routes/adminMissions.js
//
// Endpoints :
//   GET    /api/admin/missions
//   POST   /api/admin/missions
//   PATCH  /api/admin/missions/:id      (ex: { status: 'inactive' })
//   DELETE /api/admin/missions/:id
//
// Collection Firestore : "missions"
// { name, type: 'recurring'|'weekly'|'monthly'|'once', rewardPoints,
//   conditions: string, status: 'active'|'inactive', participantCount, createdAt }

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const verifyAdminAuth = require('../middleware/verifyAdminAuth');

const db = admin.firestore();

router.get('/missions', verifyAdminAuth, async (req, res) => {
  try {
    const snap = await db.collection('missions').orderBy('createdAt', 'desc').get();
    const missions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ missions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/missions', verifyAdminAuth, async (req, res) => {
  try {
    const { name, type, rewardPoints, conditions } = req.body;
    if (!name || !rewardPoints) return res.status(400).json({ error: 'Nom et récompense sont obligatoires.' });

    const docRef = await db.collection('missions').add({
      name,
      type: type || 'once',
      rewardPoints,
      conditions: conditions || '',
      status: 'active',
      participantCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/missions/:id', verifyAdminAuth, async (req, res) => {
  try {
    const { name, rewardPoints, conditions, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (rewardPoints !== undefined) updates.rewardPoints = rewardPoints;
    if (conditions !== undefined) updates.conditions = conditions;
    if (status !== undefined) updates.status = status;

    await db.collection('missions').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/missions/:id', verifyAdminAuth, async (req, res) => {
  try {
    await db.collection('missions').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
