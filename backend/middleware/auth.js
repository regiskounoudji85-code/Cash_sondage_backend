// middleware/auth.js
// Vérifie le token Firebase envoyé par l'app Flutter dans le header
// "Authorization: Bearer <idToken>". Ajoute req.user si valide.

const { auth } = require('../config/firebase');

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { verifyToken };
