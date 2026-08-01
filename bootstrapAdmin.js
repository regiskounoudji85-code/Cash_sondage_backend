// routes/bootstrapAdmin.js
// ⚠️ ROUTE TEMPORAIRE — à supprimer (ce fichier + la ligne dans server.js)
// une fois que tu as confirmé que ton compte a bien les droits admin.
// Protégée par un secret défini dans les variables d'environnement Render
// (BOOTSTRAP_SECRET) — sans lui, personne ne peut l'utiliser.

const express = require('express');
const router = express.Router();
const { auth } = require('../config/firebase');

router.get('/', async (req, res) => {
  const { uid, secret } = req.query;

  if (!process.env.BOOTSTRAP_SECRET) {
    return res.status(500).json({ error: "BOOTSTRAP_SECRET n'est pas configuré sur le serveur." });
  }
  if (!secret || secret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: 'Secret invalide.' });
  }
  if (!uid) {
    return res.status(400).json({ error: "Paramètre 'uid' manquant. Exemple : ?uid=XXXX&secret=YYYY" });
  }

  try {
    await auth.setCustomUserClaims(uid, { admin: true });
    return res.json({ success: true, message: `L'utilisateur ${uid} est maintenant admin. Reconnecte-toi sur le Dashboard Admin.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
