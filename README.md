# Plateau

Préparer une publication une seule fois, choisir les comptes de chaque marque, ajuster la légende réseau par réseau et la programmer.

- **Instagram** publie tout seul à l'heure prévue, une fois le compte connecté.
- **TikTok, YouTube et LinkedIn** passent par la liste « À publier ». À l'heure prévue, une notification arrive sur l'iPhone avec la légende prête à copier et la vidéo prête à partager vers l'app.

L'app tourne sur Cloudflare (offre gratuite) et s'utilise sur Mac comme sur iPhone, où on l'ajoute à l'écran d'accueil.

---

## Mise en ligne (une seule fois)

Compte environ 30 minutes. Tout se fait dans le navigateur, sans ligne de commande.

### 1. Le code sur GitHub
Le code est dans le dépôt `zoezombie/reseauxmanager`. Rien à faire : c'est déjà en place.

### 2. Activer le stockage des médias (R2) dans Cloudflare
1. Connecte-toi sur [dash.cloudflare.com](https://dash.cloudflare.com).
2. Dans le menu, ouvre **Storage & databases → R2 → Overview** et termine l'activation de R2.
   Cloudflare peut demander d'ajouter un moyen de paiement. C'est une vérification : les 10 premiers Go par mois restent gratuits.

### 3. Mettre l'app en ligne
1. Toujours dans Cloudflare, ouvre **Workers & Pages → Create application**.
2. Choisis **Import a repository** et connecte ton compte GitHub si on te le demande.
3. Sélectionne le dépôt `reseauxmanager`.
4. Garde le nom proposé, `reseauxmanager`, et la commande de déploiement `npx wrangler deploy`. Clique **Save and Deploy**.
5. La base de données (`plateau-db`) existe déjà. L'espace de stockage des médias (`plateau-media`) est créé tout seul au premier déploiement.

À la fin, Cloudflare affiche l'adresse de l'app, du genre `https://reseauxmanager.<ton-sous-domaine>.workers.dev`. Garde-la.

Ensuite, chaque modification envoyée sur GitHub remet l'app en ligne automatiquement.

### 4. Choisir ton mot de passe
1. Dans le Worker `reseauxmanager` : **Settings → Variables and Secrets → Add**.
2. Type **Secret**, nom `APP_PASSWORD`, valeur : le mot de passe de ton choix. Enregistre.
3. Ouvre l'adresse de l'app et connecte-toi. Tu restes connectée un an sur chaque appareil.

**Sur l'iPhone :**
1. Ouvre l'adresse dans **Safari**.
2. Touche **Partager → Sur l'écran d'accueil**.
3. Ouvre Plateau depuis la nouvelle icône, puis va dans **Comptes → Activer les notifications**.

iOS n'autorise les notifications que depuis l'icône de l'écran d'accueil.

### 4 bis. Activer la double authentification (recommandé)
Dans Plateau, va dans **Comptes → Double authentification → Activer**.
1. Scanne le QR code avec l'appareil photo de ton iPhone : il propose de l'ajouter à l'app **Mots de passe**. Google Authenticator ou une autre app d'authentification marche aussi.
2. Entre le code à 6 chiffres affiché pour confirmer.

Ensuite, chaque nouvelle connexion demande le mot de passe **et** le code. Sur iPhone, l'app Mots de passe propose le code toute seule au moment de se connecter. Tes autres appareils sont déconnectés à l'activation : reconnecte-les une fois avec le mot de passe et un code.

**Téléphone perdu ?** Dans Cloudflare, ajoute le secret `DISABLE_2FA` avec la valeur `1` (**Settings → Variables and Secrets**). Plateau ne demande alors plus que le mot de passe. Dans **Comptes**, touche **Réinitialiser**, réactive la double authentification avec ton nouveau téléphone, puis supprime le secret `DISABLE_2FA`.

### 5. Brancher Instagram (publication automatique)
Depuis fin 2026, les nouvelles apps Meta passent par la **connexion unifiée** (*Unified login*). Une seule connexion suffit pour tous tes comptes Instagram, sans page Facebook, et l'accès n'expire pas. L'app reste en mode « Development » : elle ne sert que tes propres comptes. Les libellés de Meta peuvent varier un peu.

1. **Passe chaque compte Instagram en mode Créateur ou Entreprise** : dans Instagram, *Paramètres → Type de compte et outils*.
2. Sur [developers.facebook.com](https://developers.facebook.com), crée une app de type **Business** et ajoute le produit **Instagram**.
3. **Relie l'app à un portefeuille business** (*Paramètres de l'app → Général*). C'est obligatoire avec la connexion unifiée.
4. Ouvre **Instagram → API setup with Unified login → Create new configuration** :
   - Access token : **System-user access token**, expiration **Never** ;
   - Assets : **Instagram accounts** ;
   - Permissions : au minimum `instagram_basic` et `instagram_content_publish`, plus `business_management` s'il est proposé.
   Enregistre et note le **Configuration ID**.
5. Sur la même page, ajoute l'adresse de retour (*Redirect URL*). Plateau l'affiche dans **Comptes**, avec un bouton pour la copier : `https://reseauxmanager.<ton-sous-domaine>.workers.dev/auth/instagram/callback`. Si Meta les demande, ajoute aussi `…/auth/instagram/deauthorize` (retrait) et `…/auth/instagram/delete` (suppression des données).
6. Dans Cloudflare (**Settings → Variables and Secrets**), ajoute trois secrets :
   - `META_APP_ID` : l'App ID en haut du tableau de bord Meta ;
   - `META_APP_SECRET` : *Paramètres de l'app → Général → Clé secrète → Afficher* ;
   - `META_CONFIG_ID` : le Configuration ID.
7. Dans Plateau, **Comptes → Connecter mes comptes Instagram**. Dans la fenêtre de Meta, choisis ton portefeuille business et **coche tous tes comptes Instagram**. De retour dans Plateau, les comptes dont le nom correspond sont reliés automatiquement. Choisis les autres dans la liste à côté de chaque marque.

Pour ajouter un compte plus tard, refais l'étape 7 en le cochant en plus.

### 6. (Optionnel) « Adapter avec Claude »
Pour avoir le bouton qui réécrit la légende pour chaque réseau, ajoute le secret `ANTHROPIC_API_KEY` avec une clé créée sur [platform.claude.com](https://platform.claude.com). L'usage est facturé par Anthropic selon la consommation. Sans cette clé, le bouton n'apparaît pas.

---

## Utilisation au quotidien

- **Nouveau post** : ajoute la vidéo ou l'image, coche les comptes (une marque entière en un clic), écris la légende de base et les hashtags. Ajuste ensuite chaque réseau dans « Version par réseau », choisis la date et touche **Programmer**.
- **À publier** : ce qui est dû dans les 48 heures. Pour les comptes en rappel :
  1. **Copier la légende** ;
  2. **Préparer la vidéo** puis **Partager la vidéo** (sur iPhone, choisis TikTok ou YouTube dans le menu) ;
  3. publie dans l'app ;
  4. coche **Publié**.
- **Instagram** : la ligne indique « Publication automatique à … », puis « Publié automatiquement », avec un lien vers le post. En cas d'échec, une notification arrive et la ligne propose **Réessayer**.

Bon à savoir :
- Instagram n'accepte les images qu'entre 4:5 (portrait) et 1,91:1 (paysage). Pour un format 9:16, publie une vidéo : elle part en reel. Plateau convertit tout seul les images en JPEG.
- Instagram limite le nombre de publications automatiques par compte et par 24 heures (100 au moment de l'écriture).

## Coûts : rester dans la gratuité
Seul le stockage des médias (R2) peut être facturé, et l'app est réglée pour rester dans la partie gratuite.

- **Le serveur (Workers) et la base (D1) ne facturent jamais sur l'offre gratuite.** S'ils dépassent leurs quotas du jour, ils refusent les requêtes jusqu'à minuit UTC, sans rien prélever.
- **R2 offre chaque mois 10 Go de stockage, 1 million d'écritures et 10 millions de lectures.** Le téléchargement des fichiers est gratuit. L'app reste en dessous :
  - elle refuse les nouveaux envois au-delà de **9 Go** stockés ;
  - elle supprime toute seule chaque vidéo **30 jours après sa publication**, ou 60 jours après sa date prévue dans tous les cas. Le post reste dans l'historique.
  - L'espace utilisé est affiché dans **Comptes → Stockage des médias**.
- **Alerte de dépense** : dans Cloudflare, *Manage Account → Billing → Billable Usage → Create budget alert*, mets un seuil de **1 $**. Cloudflare t'écrira par courriel dès que la moindre dépense se profile. C'est une alerte, pas un blocage.
- **N'active jamais l'offre payante Workers (5 $ US/mois)** sauf si tu le décides. Rien ne s'active tout seul.

## Ajouter ou retirer un compte
Tout est dans `public/accounts.js`. Modifie la liste directement sur GitHub (icône crayon), puis enregistre. L'app se met à jour en une minute.

## Plus tard : YouTube et LinkedIn en automatique
- **YouTube** : les vidéos envoyées par une app non vérifiée restent privées. Il faut passer l'audit de l'API YouTube auprès de Google.
- **LinkedIn (pages d'entreprise)** : il faut l'accès « Community Management », qui demande une page vérifiée et une validation par LinkedIn.

Les deux demandes exigent de montrer l'app en fonctionnement. Quand tu seras prête à les faire, ces connexions s'ajouteront au même modèle qu'Instagram.

---

## Dépannage
- **Journal des erreurs** : dans Cloudflare, Worker `reseauxmanager` → **Observability** ou **Logs**.
- **« Worker exceeded CPU time limit »** dans le journal : l'offre gratuite donne 10 ms de calcul par requête. Si ce message revient souvent, signale-le avant de passer à l'offre payante : on peut souvent alléger le code.
- **Pas de notification sur iPhone** : vérifie que Plateau est ouvert depuis l'icône de l'écran d'accueil et que les notifications sont activées dans **Comptes**. Le bouton « Envoyer une notification test » sert à vérifier.

## Pour les développeurs
- Serveur : `src/` (Cloudflare Worker), base D1, stockage R2, tâche planifiée chaque minute (`src/tick.js`).
- Interface : `public/index.html` (application web installable, sans étape de compilation), `public/sw.js` pour les notifications.
- En local :
  1. `npm install` ;
  2. crée un fichier `.dev.vars` contenant `APP_PASSWORD=...` ;
  3. lance `npx wrangler dev --test-scheduled`. L'adresse `/__scheduled` déclenche la tâche planifiée.
- `IG_GRAPH_BASE` et `IG_DIALOG_BASE` permettent de pointer vers un faux serveur Meta pour les tests.
