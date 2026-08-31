// routes/adminSettings.js
//
// Endpoints (montés sous /api/admin, déjà protégés par verifyToken +
// requireAdmin au niveau de server.js) :
//   GET   /api/admin/settings
//   PATCH /api/admin/settings
//
// Document Firestore unique : "settings/general"
// { platformName, contactEmail, currency, timezone }
//
// Ne remplace PAS la config économique existante (config/app, qui gère
// les seuils de retrait et le taux points→FCFA) — c'est un document à
// part, pour les infos générales de la plateforme.

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

router.get('/settings', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('general').get();
    res.json(doc.exists ? doc.data() : {
      platformName: 'Cash Sondage',
      contactEmail: '',
      currency: 'FCFA',
      timezone: 'GMT+00:00',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/settings', async (req, res) => {
  try {
    const { platformName, contactEmail, currency, timezone } = req.body;
    await db.collection('settings').doc('general').set(
      { platformName, contactEmail, currency, timezone },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
