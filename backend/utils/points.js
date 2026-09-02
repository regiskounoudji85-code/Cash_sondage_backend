  // utils/points.js
// Toute modification de points passe par ici, JAMAIS directement
// depuis une route. Ça garantit un ledger cohérent (collection
// "transactions") et un seul endroit à auditer en cas de litige.

const { db, admin } = require('../config/firebase');

// routes/mission_bucket_map — quel "compartiment" de points chaque type
// de transaction alimente. Le solde des SONDAGES reste strictement
// réservé aux sondages ; missions et parrainage vivent dans un solde
// bonus séparé, avec son propre seuil de retrait.
const SURVEY_TYPES = new Set(['survey_reward', 'admin_adjustment_survey', 'withdrawal_survey']);

function bucketFor(type) {
  return SURVEY_TYPES.has(type) ? 'surveyPoints' : 'bonusPoints';
}

/**
 * Crédite ou débite des points à un utilisateur, dans le bon
 * compartiment (surveyPoints ou bonusPoints selon le type), et
 * enregistre la transaction correspondante. Utilise une transaction
 * Firestore pour éviter les conditions de course.
 */
async function applyPointsChange(userId, delta, type, refId = null) {
  const userRef = db.collection('users').doc(userId);
  const field = bucketFor(type);

  const newBalance = await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    if (!userDoc.exists) throw new Error('Utilisateur introuvable');

    const currentPoints = userDoc.data()[field] || 0;
    const updatedPoints = currentPoints + delta;

    if (updatedPoints < 0) {
      throw new Error('Solde insuffisant');
    }

    t.update(userRef, {
      [field]: updatedPoints,
      ...(field === 'surveyPoints' && delta > 0 ? { totalEarned: admin.firestore.FieldValue.increment(delta) } : {}),
    });

    const txRef = db.collection('transactions').doc();
    t.set(txRef, {
      userId,
      type,
      bucket: field,
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
  // Sans ce filet, un document config/app absent ou incomplet faisait
  // planter CETTE fonction — donc silencieusement TOUT appel à
  // applyPointsChange (sondage complété, mission réclamée, bonus de
  // parrainage...), même si les points eux-mêmes étaient bien crédités.
  const cfg = configDoc.exists ? configDoc.data() : {};
  const thresholds = cfg.vipThresholds || { argent: 5000, or: 20000, platine: 50000 };

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
    
