// routes/adminTransactions.js
//
// Endpoint :
//   GET /api/admin/transactions?limit=50&userId=xxx
//
// Collection Firestore : "transactions"
// { userId, type: 'credit'|'debit', description, amount, balanceBefore,
//   balanceAfter, createdAt }
//
// ⚠️ Cette route ne fait que LIRE. Il faut que le reste de ton backend
// écrive déjà un document dans "transactions" à chaque mouvement de points :
//   - récompense de sondage complété
//   - bonus de parrainage
//   - code promo utilisé
//   - retrait approuvé (montant négatif)
//   - correction manuelle d'un admin
// Si ce n'est pas encore fait, ajoute un helper `logTransaction(...)` appelé
// à chacun de ces endroits dans ton code existant.

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const verifyAdminAuth = require('../middleware/verifyAdminAuth');

const db = admin.firestore();

router.get('/transactions', verifyAdminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    let query = db.collection('transactions').orderBy('createdAt', 'desc').limit(limit);
    if (req.query.userId) {
      query = db.collection('transactions').where('userId', '==', req.query.userId).orderBy('createdAt', 'desc').limit(limit);
    }
    const snap = await query.get();
    const transactions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

// ---------- Helper à réutiliser depuis tes routes existantes ----------
// Exemple d'usage dans ta route d'approbation de retrait :
//
//   const { logTransaction } = require('./routes/adminTransactions');
//   await logTransaction({ userId, type: 'debit', description: 'Retrait Mobile Money', amount: -amountFcfa });
//
module.exports.logTransaction = async function logTransaction({ userId, type, description, amount }) {
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const balanceBefore = (userDoc.data() && userDoc.data().points) || 0;
    const balanceAfter = balanceBefore + amount;
    tx.set(db.collection('transactions').doc(), {
      userId,
      type,
      description,
      amount,
      balanceBefore,
      balanceAfter,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
};
