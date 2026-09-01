// routes/notifications.js
// Route PUBLIQUE (utilisateur normal) — montée sur /api (voir server.js).
//
//   GET /api/notifications
//
// Retourne les notifications envoyées par l'admin qui concernent
// l'utilisateur connecté : celles adressées à "all", plus celles
// adressées à son statut actuel ('active' ou 'suspended').

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const status = userDoc.exists ? (userDoc.data().status || 'active') : 'active';

    const [allSnap, statusSnap] = await Promise.all([
      db.collection('notifications').where('audience', '==', 'all').orderBy('sentAt', 'desc').limit(20).get(),
      db.collection('notifications').where('audience', '==', status).orderBy('sentAt', 'desc').limit(20).get(),
    ]);

    const notifications = [...allSnap.docs, ...statusSnap.docs]
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.sentAt?.toMillis?.() || 0) - (a.sentAt?.toMillis?.() || 0))
      .slice(0, 20);

    res.json({ notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
