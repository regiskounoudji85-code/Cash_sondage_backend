// routes/adminAdvertisers.js
// Toutes ces routes exigent verifyToken + requireAdmin (voir server.js)

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

// GET /api/admin/advertiser-requests
router.get('/advertiser-requests', async (req, res) => {
  try {
    const snap = await db.collection('advertiserRequests').orderBy('createdAt', 'desc').limit(100).get();
    res.json({ requests: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des demandes' });
  }
});

// POST /api/admin/advertiser-requests/:id/validate-payment
// SEUL chemin qui fasse passer une demande à "paid" — l'admin confirme
// avoir RÉELLEMENT reçu l'argent sur son propre numéro, après l'avoir
// vérifié lui-même (relevé MoMo, SMS de confirmation...). Même logique
// que pour les retraits utilisateurs, dans l'autre sens.
router.post('/advertiser-requests/:id/validate-payment', async (req, res) => {
  try {
    const ref = db.collection('advertiserRequests').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Demande introuvable.' });
    await ref.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la validation du paiement' });
  }
});

// PATCH /api/admin/advertiser-requests/:id — mise à jour générique
// (utilisée pour lier un sondage créé : linkedSurveyId + status).
router.patch('/advertiser-requests/:id', async (req, res) => {
  try {
    await db.collection('advertiserRequests').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la demande' });
  }
});

// GET /api/admin/settings/advertiser-pricing
router.get('/settings/advertiser-pricing', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('advertiserPricing').get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      individualPriceFcfa: data.individualPriceFcfa ?? 2000,
      companyPriceFcfa: data.companyPriceFcfa ?? 5000,
      paymentNumbers: data.paymentNumbers || {},
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des tarifs' });
  }
});

// PATCH /api/admin/settings/advertiser-pricing
router.patch('/settings/advertiser-pricing', async (req, res) => {
  try {
    const { individualPriceFcfa, companyPriceFcfa, paymentNumbers } = req.body;
    if (!Number.isFinite(individualPriceFcfa) || individualPriceFcfa <= 0) {
      return res.status(400).json({ error: 'Le tarif particulier doit être un nombre valide supérieur à 0.' });
    }
    if (!Number.isFinite(companyPriceFcfa) || companyPriceFcfa <= 0) {
      return res.status(400).json({ error: 'Le tarif entreprise doit être un nombre valide supérieur à 0.' });
    }
    await db.collection('settings').doc('advertiserPricing').set(
      {
        individualPriceFcfa,
        companyPriceFcfa,
        paymentNumbers: paymentNumbers || {},
      },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement des tarifs" });
  }
});

module.exports = router;
  
