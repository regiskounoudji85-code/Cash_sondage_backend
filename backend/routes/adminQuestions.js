// routes/adminQuestions.js
//
// Endpoints (montés sous /api/admin, déjà protégés par verifyToken +
// requireAdmin au niveau de server.js) :
//   GET    /api/admin/questions
//   POST   /api/admin/questions
//   PATCH  /api/admin/questions/:id
//   DELETE /api/admin/questions/:id
//
// Collection Firestore : "questions"
// { text, categoryId, type: 'single'|'multiple'|'scale'|'boolean'|'text',
//   usedInSurveyIds: string[], createdAt }
//
// ⚠️ IMPORTANT : ceci crée une vraie banque de questions côté admin, mais
// le webapp utilisateur (ce qu'affiche le sondage quand on clique dessus)
// n'a actuellement AUCUNE interface pour afficher/répondre à ces questions
// une par une — le sondage actuel se limite à un titre + une description.
// Tant que cette interface n'est pas construite côté webapp, ce module
// restera un outil de gestion admin sans effet visible pour l'utilisateur.
// À prévoir comme prochaine étape si tu veux de vrais sondages "maison"
// (par opposition aux sondages externes via CPX Research).

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

router.get('/questions', async (req, res) => {
  try {
    const snap = await db.collection('questions').orderBy('createdAt', 'desc').get();
    const questions = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        usedInCount: Array.isArray(data.usedInSurveyIds) ? data.usedInSurveyIds.length : 0,
      };
    });
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/questions', async (req, res) => {
  try {
    const { text, categoryId, type } = req.body;
    if (!text || !type) return res.status(400).json({ error: 'Texte et type sont obligatoires.' });

    const docRef = await db.collection('questions').add({
      text,
      categoryId: categoryId || null,
      type,
      usedInSurveyIds: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/questions/:id', async (req, res) => {
  try {
    const { text, categoryId, type } = req.body;
    const updates = {};
    if (text !== undefined) updates.text = text;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (type !== undefined) updates.type = type;

    await db.collection('questions').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    await db.collection('questions').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
