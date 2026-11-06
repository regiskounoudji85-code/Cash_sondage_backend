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
const missionRoutes = require('./routes/missions');
const adminRoutes = require('./routes/admin');
const adminMissionsRoutes = require('./routes/adminMissions');
const adminTransactionsRoutes = require('./routes/adminTransactions');
const adminSettingsRoutes = require('./routes/adminSettings');
const adminReferralsRoutes = require('./routes/adminReferrals');
const adminCategoriesRoutes = require('./routes/adminCategories');
const adminQuestionsRoutes = require('./routes/adminQuestions');
const { adminRouter: adminPromoCodesRoutes, publicRouter: promoCodesPublicRoutes } = require('./routes/adminPromoCodes');
const adminNotificationsRoutes = require('./routes/adminNotifications');
const notificationsRoutes = require('./routes/notifications');
const cpxRoutes = require('./routes/cpx');
const advertiserRoutes = require('./routes/advertiser');
const adminAdvertisersRoutes = require('./routes/adminAdvertisers');
const fedapayRoutes = require('./routes/fedapay');

const app = express();
app.set('trust proxy', 1); // nécessaire derrière le proxy de Railway
app.use(helmet());
app.use(cors());

// FedaPay AVANT express.json() (le webhook peut avoir besoin du corps brut)
app.use('/api/fedapay', fedapayRoutes);

app.use(express.json());
app.use('/api/cpx', cpxRoutes);

// Limite générale anti-abus (ajuster selon le trafic réel)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(limiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/withdrawal', withdrawalRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/advertiser', advertiserRoutes);

// Toutes les routes admin exigent un token valide + le custom claim admin
// (vérifié une seule fois, puis on passe dans chaque routeur)
app.use(
  '/api/admin',
  verifyToken,
  requireAdmin,
  adminRoutes,
  adminMissionsRoutes,
  adminTransactionsRoutes,
  adminSettingsRoutes,
  adminReferralsRoutes,
  adminCategoriesRoutes,
  adminQuestionsRoutes,
  adminPromoCodesRoutes,
  adminNotificationsRoutes,
  adminAdvertisersRoutes
);

// Routes publiques utilisateur (authentification normale, pas admin)
app.use('/api', promoCodesPublicRoutes);
app.use('/api', notificationsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
});
