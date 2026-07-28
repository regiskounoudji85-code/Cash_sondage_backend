// utils/points.js
// Toute modification de points passe par ici, JAMAIS directement
// depuis une route. Ça garantit un ledger cohérent (collection
// "transactions") et un seul endroit à auditer en cas de litige.

const { db, admin } = require('../config/firebase');

/**
 * Crédite ou débite des points à un utilisateur et enregistre la
 * transaction correspondante. Utilise une transaction Firestore pour
 * éviter les conditions de course (deux requêtes simultanées).
 */
async function applyPointsChange(userId, delta, type, refId = null) {
  const userRef = db.collection('users').doc(userId);

  const newBalance = await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    if (!userDoc.exists) throw new Error('Utilisateur introuvable');

    const currentPoints = userDoc.data().points || 0;
    const updatedPoints = currentPoints + delta;

    if (updatedPoints < 0) {
      throw new Error('Solde insuffisant');
    }

    t.update(userRef, {
      points: updatedPoints,
      ...(delta > 0 ? { totalEarned: admin.firestore.FieldValue.increment(delta) } : {}),
    });

    const txRef = db.collection('transactions').doc();
    t.set(txRef, {
      userId,
      type,
      points: delta,
      balanceAfter: updatedPoints,
      refId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return updatedPoints;
  });

  await updateVipLevel(userId, newBalance);
  return newBalance;
}

/**
 * Recalcule le niveau VIP en fonction des gains totaux (pas du solde
 * actuel, pour ne pas rétrograder quelqu'un qui vient de retirer).
 */
async function updateVipLevel(userId) {
  const configDoc = await db.collection('config').doc('app').get();
  const thresholds = configDoc.data().vipThresholds;

  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  const totalEarned = userDoc.data().totalEarned || 0;

  let vipLevel = 'bronze';
  if (totalEarned >= thresholds.platine) vipLevel = 'platine';
  else if (totalEarned >= thresholds.or) vipLevel = 'or';
  else if (totalEarned >= thresholds.argent) vipLevel = 'argent';

  if (userDoc.data().vipLevel !== vipLevel) {
    await userRef.update({ vipLevel });
  }
}

module.exports = { applyPointsChange, updateVipLevel };
