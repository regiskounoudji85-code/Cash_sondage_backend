// routes/fedapay.js
//
// Paiement en ligne des annonceurs via FedaPay (Mobile Money).
//
// IMPORTANT — à monter dans server.js APRÈS cors() mais AVANT
// express.json() : le webhook a besoin du corps BRUT de la requête pour
// vérifier la signature, et express.json() le détruirait en le parsant.
//
//   app.use(cors());
//   app.use('/api/fedapay', fedapayRoutes);   // <-- ici
//   app.use(express.json());
//
// Principe de sécurité : on ne fait JAMAIS confiance à ce que dit le
// navigateur ou même le contenu d'un webhook pour décider qu'une demande
// est payée. On redemande toujours le statut réel de la transaction à
// FedaPay, et on vérifie que le montant correspond à ce qu'on attendait.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { FedaPay, Transaction, Webhook } = require('fedapay');
const { db, admin } = require('../config/firebase');
const { getFedaPayEnv, isOnlinePaymentEnabled } = require('../utils/fedapayConfig');

const router = express.Router();

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://lovely-malasada-29c8fa.netlify.app';
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || 'https://cashsondagebackend-production.up.railway.app';

function configureFedaPay() {
  FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
  FedaPay.setEnvironment(getFedaPayEnv());
}

async function findRequestByTrackingCode(code) {
  const snap = await db.collection('advertiserRequests')
    .where('trackingCode', '==', code)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// Marque la demande comme payée SI ET SEULEMENT SI FedaPay confirme
// la transaction approuvée, avec le bon montant, et que c'est bien
// celle qu'on avait créée pour cette demande. Idempotent : peut être
// appelée plusieurs fois (callback + webhook) sans effet double.
async function settleTransaction(requestDoc, transactionId) {
  const request = requestDoc.data();

  if (request.fedapayTransactionId !== String(transactionId)) {
    return { settled: false, reason: 'transaction_mismatch' };
  }
  if (request.status !== 'pending_payment') {
    return { settled: false, reason: 'already_processed' };
  }

  configureFedaPay();
  const tx = await Transaction.retrieve(transactionId);

  if (tx.status !== 'approved') {
    return { settled: false, reason: 'not_approved' };
  }
  if (Number(tx.amount) !== Number(request.priceFcfa)) {
    console.error(`FedaPay: montant inattendu pour la demande ${requestDoc.id} (reçu ${tx.amount}, attendu ${request.priceFcfa})`);
    return { settled: false, reason: 'amount_mismatch' };
  }

  await db.runTransaction(async (t) => {
    const fresh = await t.get(requestDoc.ref);
    if (fresh.data().status !== 'pending_payment') return; // déjà traitée entre-temps
    t.update(requestDoc.ref, {
      status: 'paid',
      paymentClaimed: true,
      paymentMethod: 'fedapay',
      paymentReference: String(transactionId),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      // Un paiement fait avec des clés de TEST n'est pas de l'argent
      // réel : on le marque pour que l'admin ne s'y trompe jamais.
      paidInSandbox: request.fedapayEnv === 'sandbox',
    });
  });

  return { settled: true };
}

// Limite le nombre de créations de transactions FedaPay par IP.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/fedapay/requests/:trackingCode/checkout
// Crée la transaction FedaPay pour cette demande et renvoie l'URL de la
// page de paiement sécurisée FedaPay. Le MONTANT vient toujours de notre
// base de données, jamais du navigateur.
router.post('/requests/:trackingCode/checkout', checkoutLimiter, async (req, res) => {
  try {
    if (!isOnlinePaymentEnabled()) {
      return res.status(503).json({ error: "Le paiement en ligne n'est pas disponible pour le moment." });
    }

    const requestDoc = await findRequestByTrackingCode(req.params.trackingCode);
    if (!requestDoc) return res.status(404).json({ error: 'Demande introuvable.' });

    const request = requestDoc.data();
    if (request.status !== 'pending_payment') {
      return res.status(400).json({ error: "Cette demande n'est plus en attente de paiement." });
    }

    configureFedaPay();

    const nameParts = String(request.contactName).trim().split(/\s+/);
    const firstname = nameParts[0];
    const lastname = nameParts.slice(1).join(' ') || firstname;

    const baseTransaction = {
      description: `Sondage Cash Sondage : ${request.topic}`.slice(0, 180),
      amount: request.priceFcfa,
      currency: { iso: 'XOF' },
      callback_url: `${BACKEND_PUBLIC_URL}/api/fedapay/callback/${request.trackingCode}`,
      merchant_reference: requestDoc.id,
    };

    let transaction;
    try {
      transaction = await Transaction.create({
        ...baseTransaction,
        customer: { firstname, lastname, email: request.email },
      });
    } catch (e) {
      // FedaPay exige un email unique par client : si cette adresse a déjà
      // servi pour une autre demande, on réessaie sans fiche client plutôt
      // que de bloquer l'annonceur.
      transaction = await Transaction.create(baseTransaction);
    }

    const token = await transaction.generateToken();

    await requestDoc.ref.update({
      fedapayTransactionId: String(transaction.id),
      fedapayEnv: getFedaPayEnv(),
    });

    res.json({ paymentUrl: token.url });
  } catch (err) {
    console.error('FedaPay checkout error:', err);
    res.status(500).json({ error: "Impossible de lancer le paiement en ligne pour le moment." });
  }
});

// GET /api/fedapay/callback/:trackingCode
// FedaPay y renvoie le navigateur de l'annonceur après le paiement (avec
// ?id=...&status=... ajoutés). On revérifie auprès de FedaPay plutôt que
// de croire le paramètre "status" de l'URL, puis on renvoie la personne
// sur le site, sur son écran de suivi.
router.get('/callback/:trackingCode', async (req, res) => {
  const code = req.params.trackingCode;
  try {
    const requestDoc = await findRequestByTrackingCode(code);
    if (requestDoc && req.query.id) {
      await settleTransaction(requestDoc, req.query.id);
    }
  } catch (err) {
    // Le webhook prendra le relais : on ne bloque pas le retour sur le site.
    console.error('FedaPay callback error:', err);
  }
  res.redirect(`${WEBAPP_URL}/?adv_return=${encodeURIComponent(code)}`);
});

// POST /api/fedapay/webhook
// Appelé par les serveurs de FedaPay à chaque changement de statut.
// Corps BRUT requis pour vérifier la signature (voir en-tête du fichier).
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const endpointSecret = process.env.FEDAPAY_WEBHOOK_SECRET;
  if (!endpointSecret) {
    console.error('FEDAPAY_WEBHOOK_SECRET manquante : webhook ignoré.');
    return res.status(500).send('webhook_not_configured');
  }

  let event;
  try {
    event = Webhook.constructEvent(req.body, req.headers['x-fedapay-signature'], endpointSecret);
  } catch (err) {
    return res.status(400).send('invalid_signature');
  }

  try {
    const eventName = event.name || event.type;
    if (eventName === 'transaction.approved') {
      const tx = (event.data && event.data.object) || event.entity || event.object_data;
      const transactionId = tx && tx.id;
      if (transactionId) {
        const snap = await db.collection('advertiserRequests')
          .where('fedapayTransactionId', '==', String(transactionId))
          .limit(1)
          .get();
        if (!snap.empty) {
          await settleTransaction(snap.docs[0], transactionId);
        }
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('FedaPay webhook error:', err);
    res.status(500).send('error'); // FedaPay réessaiera
  }
});

module.exports = router;
