// server.js — point d'entrée du backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Filet de sécurité : une erreur non prévue ne doit plus jamais arrêter
// tout le serveur. On la journalise et on continue à tourner.
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Erreur non gérée (le serveur continue de tourner) :', err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exception non interceptée (le serveur continue de tourner) :', err);
});

const { verifyToken } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/adminAuth');

const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const referralRoutes = require('./routes/referral');
const withdrawalRoutes = require('./routes/withdrawal');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1); // nécessaire derrière le proxy de Railway
app.use(helmet());
app.use(cors());
app.use(express.json());

// Limite générale anti-abus (ajuster selon le trafic réel)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(limiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/withdrawal', withdrawalRoutes);

// Toutes les routes admin exigent un token valide + le custom claim admin
app.use('/api/admin', verifyToken, requireAdmin, adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
});
                
