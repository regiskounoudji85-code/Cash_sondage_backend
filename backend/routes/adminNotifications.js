// routes/adminNotifications.js
//
// Endpoint (monté sous /api/admin, protégé par verifyToken + requireAdmin
// au niveau de server.js) :
//   POST /api/admin/notifications/broadcast
//   body: { audience: 'all'|'active'|'suspended', type: 'info'|'warning', title, message }
//
// ⚠️ audience utilise 'suspended' (pas 'inactive') pour correspondre au
// vrai statut stocké sur les comptes utilisateurs (voir routes/admin.js,
// setUserStatus). Le libellé affiché côté interface ("Utilisateurs
// inactifs") peut rester tel quel, seule la valeur envoyée doit changer.
//
// Collection Firestore : "notifications"
// { audience, type, title, message, sentBy (uid admin), sentAt, recipientCount }

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

router.post('/notifications/broadcast', async (req, res) => {
  try {
    const { audience, type, title, message } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Titre et message sont obligatoires.' });
    if (!['all', 'active', 'suspended'].includes(audience)) {
      return res.status(400).json({ error: 'Audience invalide.' });
    }

    let recipientCount;
    if (audience === 'all') {
      const snap = await db.collection('users').count().get();
      recipientCount = snap.data().count;
    } else {
      const snap = await db.collection('users').where('status', '==', audience).count().get();
      recipientCount = snap.data().count;
    }

    const docRef = await db.collection('notifications').add({
      audience,
      type: type || 'info',
      title,
      message,
      sentBy: req.user.uid,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      recipientCount,
    });

    res.status(201).json({ id: docRef.id, recipientCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/notifications/history', async (req, res) => {
  try {
    const snap = await db.collection('notifications').orderBy('sentAt', 'desc').limit(30).get();
    const notifications = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
