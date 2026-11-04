// utils/fedapayConfig.js
// Variables d'environnement à définir sur Railway (JAMAIS dans le code) :
//   FEDAPAY_SECRET_KEY      clé secrète FedaPay (sandbox ou live)
//   FEDAPAY_ENV             "sandbox" (défaut) ou "live"
//   FEDAPAY_WEBHOOK_SECRET  secret du webhook (affiché à la création du webhook)
//   FEDAPAY_ALLOW_SANDBOX   "true" UNIQUEMENT pendant les tests (voir ci-dessous)

function getFedaPayEnv() {
  return process.env.FEDAPAY_ENV === 'live' ? 'live' : 'sandbox';
}

// Le paiement en ligne n'est proposé aux annonceurs que si :
//  - une clé secrète est configurée, ET
//  - on est en mode "live", OU le mode test a été explicitement autorisé.
// Garde-fou volontaire : en sandbox, un faux paiement de test marque la
// demande comme "payée". Sans cette condition, laisser des clés sandbox
// sur le site en production permettrait à n'importe qui d'obtenir un
// sondage sans payer un seul franc.
function isOnlinePaymentEnabled() {
  if (!process.env.FEDAPAY_SECRET_KEY) return false;
  if (getFedaPayEnv() === 'live') return true;
  return process.env.FEDAPAY_ALLOW_SANDBOX === 'true';
}

module.exports = { getFedaPayEnv, isOnlinePaymentEnabled };
