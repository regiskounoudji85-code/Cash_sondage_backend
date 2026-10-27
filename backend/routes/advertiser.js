// routes/advertiser.js
//
// Espace Annonceurs — accessible SANS compte utilisateur. Une
// entreprise, un chercheur ou un particulier remplit une demande, paie,
// et reçoit un code de suivi unique (pas de mot de passe à gérer) pour
// consulter l'avancement plus tard. L'admin valide le paiement et crée
// le sondage lié depuis le Dashboard Admin (routes/adminAdvertisers.js).

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

function generateTrackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 (ambiguïté)
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// GET /api/advertiser/pricing — tarifs ET numéros de réception,
// publics (affichés avant même que la personne ne commence à remplir
// le formulaire, et sur l'écran de paiement pour savoir où envoyer).
router.get('/pricing', async (req, res) => {
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

// POST /api/advertiser/requests — soumettre une nouvelle demande
router.post('/requests', async (req, res) => {
  try {
    const {
      contactName, companyName, requesterType,
      email, phone, topic, targetAudience,
      desiredResponses, questionsBrief,
    } = req.body;

    if (!contactName || !email || !phone || !topic) {
      return res.status(400).json({ error: "Nom, email, téléphone et sujet sont obligatoires." });
    }
    if (!['individual', 'company'].includes(requesterType)) {
      return res.status(400).json({ error: 'Merci de préciser si tu es un particulier ou une entreprise.' });
    }
    if (requesterType === 'company' && !companyName) {
      return res.status(400).json({ error: "Le nom de l'entreprise est obligatoire pour ce type de demande." });
    }
    const desiredResponsesNum = parseInt(desiredResponses, 10);
    if (!Number.isFinite(desiredResponsesNum) || desiredResponsesNum <= 0) {
      return res.status(400).json({ error: 'Le nombre de réponses souhaité doit être un nombre valide supérieur à 0.' });
    }

    // Tarif FIXE selon le profil du demandeur (pas calculé au nombre de
    // réponses) — configurable depuis le Dashboard Admin, avec un repli
    // raisonnable si jamais les tarifs n'ont pas encore été configurés.
    const pricingDoc = await db.collection('settings').doc('advertiserPricing').get();
    const pricing = pricingDoc.exists ? pricingDoc.data() : {};
    const priceFcfa = requesterType === 'company'
      ? (pricing.companyPriceFcfa ?? 5000)
      : (pricing.individualPriceFcfa ?? 2000);

    // Évite une (très improbable, mais possible) collision de code.
    let trackingCode = generateTrackingCode();
    let existing = await db.collection('advertiserRequests').where('trackingCode', '==', trackingCode).limit(1).get();
    while (!existing.empty) {
      trackingCode = generateTrackingCode();
      existing = await db.collection('advertiserRequests').where('trackingCode', '==', trackingCode).limit(1).get();
    }

    const ref = await db.collection('advertiserRequests').add({
      contactName,
      companyName: companyName || null,
      requesterType,
      email,
      phone,
      topic,
      targetAudience: targetAudience || null,
      desiredResponses: desiredResponsesNum,
      questionsBrief: questionsBrief || null,
      priceFcfa,
      status: 'pending_payment', // pending_payment → paid → published → completed
      paymentMethod: null,
      paymentReference: null,
      paymentClaimed: false, // true dès que l'annonceur déclare avoir payé, AVANT toute vérification admin
      paymentClaimedAt: null,
      linkedSurveyId: null,
      trackingCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: null,
    });

    res.json({ requestId: ref.id, trackingCode, priceFcfa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la demande' });
  }
});

// POST /api/advertiser/requests/:trackingCode/pay
// IMPORTANT : ceci enregistre uniquement ce que l'annonceur DÉCLARE avoir
// fait — ça ne vérifie jamais qu'un vrai transfert d'argent a eu lieu, et
// ne doit donc JAMAIS faire passer la demande à "paid" tout seul. Seul
// l'admin, en confirmant avoir réellement reçu l'argent (voir
// routes/adminAdvertisers.js → validate-payment), peut faire cette
// transition — exactement comme pour les retraits utilisateurs, mais
// dans l'autre sens (argent qui entre, pas qui sort).
router.post('/requests/:trackingCode/pay', async (req, res) => {
  try {
    const { paymentMethod, paymentReference } = req.body;
    if (!paymentMethod || !paymentReference) {
      return res.status(400).json({ error: 'Le mode de paiement et le numéro utilisé sont obligatoires.' });
    }

    const snap = await db.collection('advertiserRequests')
      .where('trackingCode', '==', req.params.trackingCode)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: 'Demande introuvable.' });

    const doc = snap.docs[0];
    if (doc.data().status !== 'pending_payment') {
      return res.status(400).json({ error: "Cette demande n'est plus en attente de paiement." });
    }

    await doc.ref.update({
      paymentMethod,
      paymentReference,
      paymentClaimed: true,
      paymentClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      // status reste "pending_payment" : seule la vérification manuelle
      // de l'admin le fait passer à "paid".
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du paiement" });
  }
});

// GET /api/advertiser/requests/:trackingCode — suivi public, par code
router.get('/requests/:trackingCode', async (req, res) => {
  try {
    const snap = await db.collection('advertiserRequests')
      .where('trackingCode', '==', req.params.trackingCode)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: 'Demande introuvable. Vérifie ton code de suivi.' });

    const data = snap.docs[0].data();
    let surveyProgress = null;
    if (data.linkedSurveyId) {
      const surveyDoc = await db.collection('surveys').doc(data.linkedSurveyId).get();
      if (surveyDoc.exists) {
        surveyProgress = {
          currentResponses: surveyDoc.data().currentResponses || 0,
          maxResponses: surveyDoc.data().maxResponses || data.desiredResponses,
        };
      }
    }

    res.json({
      status: data.status,
      paymentClaimed: !!data.paymentClaimed,
      topic: data.topic,
      desiredResponses: data.desiredResponses,
      priceFcfa: data.priceFcfa,
      createdAt: data.createdAt,
      surveyProgress,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la demande' });
  }
});

// GET /api/advertiser/requests/:trackingCode/results — résultats
// agrégés, uniquement une fois le sondage terminé (quota de réponses
// atteint — voir la logique ajoutée dans routes/surveys.js).
router.get('/requests/:trackingCode/results', async (req, res) => {
  try {
    const snap = await db.collection('advertiserRequests')
      .where('trackingCode', '==', req.params.trackingCode)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: 'Demande introuvable.' });
    const data = snap.docs[0].data();

    if (data.status !== 'completed' || !data.linkedSurveyId) {
      return res.status(400).json({ error: "Les résultats ne sont pas encore disponibles." });
    }

    const surveyDoc = await db.collection('surveys').doc(data.linkedSurveyId).get();
    if (!surveyDoc.exists) return res.status(404).json({ error: 'Sondage lié introuvable.' });
    const survey = surveyDoc.data();

    const responsesSnap = await db.collection('surveyResponses')
      .where('surveyId', '==', data.linkedSurveyId)
      .get();
    const responses = responsesSnap.docs.map((d) => d.data());

    const questions = survey.questions || [];
    const summary = questions.map((q) => {
      if (q.type === 'text') {
        const textAnswers = responses
          .map((r) => r.answers?.[q.id])
          .filter((a) => a && String(a).trim() !== '');
        return { questionId: q.id, text: q.text, type: 'text', textAnswers };
      }
      const counts = q.options.map(() => 0);
      responses.forEach((r) => {
        const idx = parseInt(r.answers?.[q.id], 10);
        if (!isNaN(idx) && counts[idx] !== undefined) counts[idx]++;
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
    res.status(500).json({ error: 'Erreur lors du chargement des résultats' });
  }
});

module.exports = router;
      
