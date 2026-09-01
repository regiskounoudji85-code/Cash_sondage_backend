// routes/adminCategories.js
//
// Endpoints (montés sous /api/admin, déjà protégés par verifyToken +
// requireAdmin au niveau de server.js) :
//   GET    /api/admin/categories
//   POST   /api/admin/categories
//   PATCH  /api/admin/categories/:id
//   DELETE /api/admin/categories/:id
//
// Collection Firestore : "categories"
// { name: string, description: string, status: 'active'|'inactive', createdAt }
//
// ⚠️ Le compteur surveyCount restera à 0 pour l'instant : la collection
// "surveys" n'a pas encore de champ "categoryId" — il faudra l'ajouter au
// formulaire "Nouveau sondage" (et à la route POST /admin/surveys
// existante dans routes/admin.js) pour que ce compteur devienne utile.

const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');

router.get('/categories', async (req, res) => {
  try {
    const snap = await db.collection('categories').orderBy('createdAt', 'desc').get();

    const categories = await Promise.all(snap.docs.map(async (doc) => {
      const surveysSnap = await db.collection('surveys').where('categoryId', '==', doc.id).get();
      return { id: doc.id, ...doc.data(), surveyCount: surveysSnap.size };
    }));

    res.json({ categories });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Le nom est obligatoire.' });

    const docRef = await db.collection('categories').add({
      name,
      description: description || '',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    await db.collection('categories').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await db.collection('categories').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
