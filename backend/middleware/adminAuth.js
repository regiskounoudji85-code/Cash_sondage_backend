// middleware/adminAuth.js
// À utiliser APRÈS verifyToken. Vérifie que l'utilisateur a le custom
// claim "admin: true" (à définir une fois via un script séparé, jamais
// depuis l'app elle-même).

const { auth } = require('../config/firebase');

async function requireAdmin(req, res, next) {
  try {
    const user = await auth.getUser(req.user.uid);
    if (!user.customClaims || user.customClaims.admin !== true) {
      return res.status(403).json({ error: 'Accès admin requis' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Erreur de vérification admin' });
  }
}

module.exports = { requireAdmin };
