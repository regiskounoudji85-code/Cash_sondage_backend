// routes/adminTransactions.js
//
// Endpoint (monté sous /api/admin, protégé par verifyToken + requireAdmin
// au niveau de server.js) :
//   GET /api/admin/transactions?limit=50&userId=xxx
//
// Collection Firestore : "transactions" — déjà alimentée automatiquement
// par utils/points.js à CHAQUE mouvement de points (sondage complété,
// mission réclamée, bonus de parrainage, retrait demandé, remboursement
// admin suite à un retrait rejeté). Il n'y a donc RIEN à ajouter ailleurs
// dans le code : cette route se contente de LIRE ce registre existant.
//
// Champs réels du document : { userId, type, bucket, points, balanceAfter,
// refId, createdAt }. "bucket" vaut 'surveyPoints' ou 'bonusPoints' selon
// le compartiment concerné. "type" est la clé technique (ex:
// 'survey_reward', 'mission_reward', 'referral_bonus', 'withdrawal_survey',
// 'withdrawal_bonus', 'admin_adjustment_survey', 'admin_adjustment_bonus').

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// Traduit la clé technique en libellé lisible pour l'affichage admin.
const TYPE_LABELS = {
  survey_reward: 'Récompense de sondage',
  mission_reward: 'Récompense de mission',
  referral_bonus: 'Bonus de parrainage',
  withdrawal_survey: 'Retrait (solde sondages)',
  withdrawal_bonus: 'Retrait (solde bonus)',
  admin_adjustment_survey: 'Remboursement admin (sondages)',
  admin_adjustment_bonus: 'Remboursement admin (bonus)',
};

router.get('/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    let query = db.collection('transactions').orderBy('createdAt', 'desc').limit(limit);
    if (req.query.userId) {
      query = db.collection('transactions')
        .where('userId', '==', req.query.userId)
        .orderBy('createdAt', 'desc')
        .limit(limit);
    }
    const snap = await query.get();
    const transactions = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        description: TYPE_LABELS[data.type] || data.type,
      };
    });
    res.json({ transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
  
