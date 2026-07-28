CASH SONDAGE — BACKEND (Node.js / Express / Firebase)
========================================================

CONTENU
-------
server.js              → point d'entrée
config/firebase.js     → connexion à Firebase (Admin SDK)
middleware/             → vérification des tokens utilisateurs et admin
routes/                 → auth, sondages, parrainage, retrait, admin
utils/                   → gestion des points, script pour créer un admin
package.json            → dépendances
.env.example            → modèle du fichier de configuration (à remplir)

⚠️ AVANT DE DÉPLOYER : remplis le fichier .env.example avec tes vraies
valeurs, puis renomme-le en ".env".

    PORT=3000
    FIREBASE_PROJECT_ID=                <-- à remplir
    FIREBASE_CLIENT_EMAIL=              <-- à remplir
    FIREBASE_PRIVATE_KEY=""             <-- à remplir

Où trouver ces 3 valeurs Firebase :
Console Firebase → ⚙️ Paramètres du projet → onglet "Comptes de service"
→ bouton "Générer une nouvelle clé privée" → un fichier .json se télécharge.
Ouvre ce .json (avec une appli d'édition de texte) :
- "project_id"    → FIREBASE_PROJECT_ID
- "client_email"  → FIREBASE_CLIENT_EMAIL
- "private_key"   → FIREBASE_PRIVATE_KEY (garde les guillemets et les \n)

DÉPLOIEMENT SUR RENDER (3 ÉTAPES, DEPUIS TON TÉLÉPHONE)
----------------------------------------------------------
Render a besoin que le code soit sur GitHub (contrairement à Netlify Drop,
pas d'upload direct de fichiers). Donc avant les 3 étapes Render, mets ce
dossier "backend" sur un repo GitHub (voir méthode déjà vue ensemble pour
l'app mobile : créer un repo, uploader les fichiers dézippés, valider).

1. Va sur render.com, connecte-toi avec ton compte GitHub.
   Tape "New +" → "Web Service" → sélectionne ton repo backend.

2. Configure :
   - Build Command : npm install
   - Start Command : npm start
   Puis dans l'onglet "Environment", ajoute les 4 variables du .env
   (PORT, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).

3. Tape "Create Web Service". Après quelques minutes, Render affiche
   ton URL en haut (ex: https://cash-sondage-backend.onrender.com).
   C'est cette URL que tu dois coller dans "API_BASE_URL" du site web
   et du dashboard admin.

À NOTER : sur le plan gratuit de Render, le service s'endort après 15 min
d'inactivité et met 30 à 60 secondes à se "réveiller" au premier appel —
normal, pas un bug.

APRÈS LE DÉPLOIEMENT
---------------------
Donne les droits admin à ton propre compte pour accéder au dashboard :
1. Récupère ton UID Firebase (Console Firebase → Authentication → la liste
   des utilisateurs → colonne "UID" à côté de ton email).
2. Comme tu n'as pas de terminal local, ce script (setAdmin.js) doit être
   exécuté depuis un environnement avec Node.js — par exemple un GitHub
   Codespace ouvert sur ce repo (déjà vu ensemble pour l'app mobile) :
      node utils/setAdmin.js TON_UID_ICI
