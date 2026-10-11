// routes/cpx.js
//
// Postback CPX Research — appelé par LEURS serveurs (pas par un utilisateur
// connecté) à chaque sondage complété ou annulé. Pas de verifyToken ici :
// la sécurité vient de la vérification du secure_hash, pas d'un token Firebase.
//
// URL à donner à CPX Research dans l'onglet "Postback Settings" de leur
// dashboard (en remplaçant par ton vrai domaine Railway) :
//
//   https://cashsondagebackend-production.up.railway.app/api/cpx/postback?
//     status={status}&trans_id={trans_id}&user_id={user_id}
//     &amount_local={amount_local}&secure_hash={secure_hash}
//
// "user_id" doit correspondre exactement à l'uid Firebase de l'utilisateur
// — c'est la valeur à passer comme ext_user_id quand tu intègres le widget
// CPX (iframe/offerwall) côté webapp, une fois cette étape terminée.
//
// Variable d'environnement à ajouter sur Railway :
//   CPX_SECURE_KEY = <le "App Secure Hash" trouvé dans l'onglet INFO
//                      de ton app, dans le dashboard CPX Research>

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { applyPointsChange } = require('../utils/points');

const CPX_SECURE_KEY = process.env.CPX_SECURE_KEY;
// Trouvé dans le dashboard CPX → Apps → ton app → onglet INFO.
// Variable d'environnement sur Railway ; 37063 vu dans ton test comme repli.
const CPX_APP_ID = process.env.CPX_APP_ID || '37063';

// Part du montant CPX reversée à l'utilisateur. "amount_local" représente
// déjà 100% de ce que CPX te paie pour ce sondage (voir leurs CGU : le
// montant crédité est calculé directement sur ce qui t'a été payé) — donc
// appliquer ce taux ici revient exactement à "si je gagne 1$, l'utilisateur
// reçoit 0.1$", quelle que soit la devise dans laquelle CPX exprime le
// montant. Modifiable via une variable d'environnement Railway
// (CPX_REVENUE_SHARE), sans toucher au code, si tu veux ajuster plus tard.
const CPX_REVENUE_SHARE = parseFloat(process.env.CPX_REVENUE_SHARE || '0.1');

// GET /api/cpx/iframe-url — utilisateur connecté uniquement.
// Calcule le secure_hash CÔTÉ SERVEUR (jamais côté navigateur, sinon
// n'importe qui pourrait lire ta clé secrète dans le code source de la
// page et forger des hash pour d'autres utilisateurs).
router.get('/iframe-url', verifyToken, async (req, res) => {
  if (!CPX_SECURE_KEY) {
    return res.status(500).json({ error: 'CPX_SECURE_KEY manquante côté serveur' });
  }
  const userId = req.user.uid;
  const secureHash = crypto.createHash('md5').update(`${userId}-${CPX_SECURE_KEY}`).digest('hex');
  const iframeUrl = `https://offers.cpx-research.com/index.php?app_id=${CPX_APP_ID}&ext_user_id=${encodeURIComponent(userId)}&secure_hash=${secureHash}&subid_1=&subid_2=`;
  res.json({ iframeUrl });
});

router.get('/postback', async (req, res) => {
  try {
    const { user_id, trans_id, amount_local, status, secure_hash } = req.query;

    if (!user_id || !trans_id || !secure_hash) {
      return res.status(400).send('missing_params');
    }
    if (!CPX_SECURE_KEY) {
      console.error('CPX_SECURE_KEY manquante dans les variables d\'environnement Railway');
      return res.status(500).send('server_misconfigured');
    }

    // Vérifie que l'appel vient bien de CPX (et pas de n'importe qui
    // essayant de créditer des points gratuitement).
    const expectedHash = crypto.createHash('md5').update(`${user_id}-${CPX_SECURE_KEY}`).digest('hex');
    if (expectedHash !== secure_hash) {
      return res.status(403).send('invalid_hash');
    }

    // Idempotence : CPX peut renvoyer le même postback plusieurs fois
    // (retente en cas de timeout) — on ne doit JAMAIS créditer deux fois
    // la même transaction.
    const txRef = db.collection('cpxTransactions').doc(trans_id);
    const txDoc = await txRef.get();

    if (status === '1') {
      // Sondage complété et validé par CPX
      if (txDoc.exists) {
        return res.send('1'); // déjà traité, on confirme simplement
      }
      const fullAmount = parseFloat(amount_local) || 0;
      const points = Math.round(fullAmount * CPX_REVENUE_SHARE);
      if (points <= 0) {
        return res.send('1');
      }
      await applyPointsChange(user_id, points, 'survey_reward', trans_id);
      await txRef.set({
        userId: user_id,
        fullAmount, // montant brut envoyé par CPX, gardé pour audit
        points, // montant réellement crédité après partage des revenus
        status: 'credited',
        createdAt: new Date(),
      });
      return res.send('1');
    }

    if (status === '2') {
      // Chargeback : CPX annule un sondage déjà payé (fraude détectée
      // après coup, réponses invalides, etc.) — on retire les points.
      if (!txDoc.exists || txDoc.data().status !== 'credited') {
        return res.send('1'); // rien à annuler ou déjà annulé
      }
      const points = txDoc.data().points;
      try {
        await applyPointsChange(user_id, -points, 'admin_adjustment_survey', trans_id);
      } catch (e) {
        // L'utilisateur a peut-être déjà retiré ces points : on ne peut
        // pas aller en négatif. On trace quand même pour suivi manuel
        // plutôt que de faire planter le postback.
        console.warn(`Chargeback CPX ${trans_id} : solde insuffisant pour retirer ${points} points à ${user_id}`);
      }
      await txRef.update({ status: 'reversed', reversedAt: new Date() });
      return res.send('1');
    }

    // Statut inconnu : on confirme quand même la réception pour éviter
    // que CPX ne re-tente indéfiniment, mais on ne touche à aucun point.
    return res.send('1');
  } catch (err) {
    console.error(err);
    return res.status(500).send('error');
  }
});

module.exports = router;
  
