// server.js — point d'entrée du backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { verifyToken } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/adminAuth');

const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const referralRoutes = require('./routes/referral');
const withdrawalRoutes = require('./routes/withdrawal');
const adminRoutes = require('./routes/admin');

const app = express();
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
