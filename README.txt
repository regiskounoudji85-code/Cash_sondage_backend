CASH SONDAGE — WEB APP (là où les gens se connectent et répondent aux sondages)
=================================================================================

CONTENU
-------
index.html → toute la web app (connexion, mur de sondages, parrainage, retrait).

⚠️ AVANT DE DÉPLOYER : ouvre index.html avec une appli d'édition de texte
(ex: Acode, Quoda) et remplis ces deux blocs tout en haut, dans la balise <script> :

    const FIREBASE_CONFIG = {
      apiKey: "",          <-- à remplir
      authDomain: "",      <-- à remplir, ex: ton-projet.firebaseapp.com
      projectId: "",       <-- à remplir
    };
    const API_BASE_URL = ""; <-- à remplir une fois le backend déployé sur Render

Où trouver tes clés Firebase (tu as déjà créé le projet) :
Console Firebase → ⚙️ Paramètres du projet → tout en bas "Vos applications"
→ si aucune app web n'existe encore, clique sur l'icône </> pour en créer une
→ Firebase affiche apiKey / authDomain / projectId à copier ici.

N'oublie pas d'activer aussi (sinon la connexion échouera) :
Console Firebase → Authentication → Sign-in method → active "Email/Mot de passe" et "Google".

DÉPLOIEMENT SUR NETLIFY (3 ÉTAPES, DEPUIS TON TÉLÉPHONE)
----------------------------------------------------------
1. Dézippe ce fichier .zip. Modifie index.html comme indiqué ci-dessus
   AVANT de l'uploader.

2. Va sur app.netlify.com/drop dans Chrome. Tape sur la zone en pointillés,
   choisis le fichier "index.html" modifié.

3. Un lien apparaît (ex: https://cash-sondage.netlify.app).
   Tape sur "Claim this site" pour le garder de façon permanente.
