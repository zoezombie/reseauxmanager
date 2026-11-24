# Plateau

Préparer une publication une seule fois, choisir les comptes de chaque marque, ajuster la légende réseau par réseau et la programmer.

- **Instagram** publie tout seul à l'heure prévue, une fois le compte connecté.
- **TikTok, YouTube et LinkedIn** passent par la liste « À publier ». À l'heure prévue, une notification arrive sur l'iPhone avec la légende prête à copier et la vidéo prête à partager vers l'app.

L'app tourne sur Cloudflare (offre gratuite) et s'utilise sur Mac comme sur iPhone, où on l'ajoute à l'écran d'accueil.

---

## Mise en ligne (une seule fois)

Compte environ 30 minutes. Tout se fait dans le navigateur, sans ligne de commande.

### 1. Le code sur GitHub
Le code doit être dans un dépôt **privé** de ton compte GitHub, nommé `plateau`.

### 2. Activer le stockage des médias (R2) dans Cloudflare
1. Connecte-toi sur [dash.cloudflare.com](https://dash.cloudflare.com).
2. Dans le menu, ouvre **Storage & databases → R2 → Overview** et termine l'activation de R2.
   Cloudflare peut demander d'ajouter un moyen de paiement. C'est une vérification : les 10 premiers Go par mois restent gratuits.

### 3. Mettre l'app en ligne
1. Toujours dans Cloudflare, ouvre **Workers & Pages → Create application**.
2. Choisis **Import a repository** et connecte ton compte GitHub si on te le demande.
3. Sélectionne le dépôt `plateau`.
4. Laisse les réglages proposés, avec la commande de déploiement `npx wrangler deploy`. Clique **Save and Deploy**.
5. Au premier déploiement, Cloudflare crée tout seul la base de données (`plateau-db`) et l'espace de stockage (`plateau-media`).

À la fin, Cloudflare affiche l'adresse de l'app, du genre `https://plateau.<ton-sous-domaine>.workers.dev`. Garde-la.

Ensuite, chaque modification envoyée sur GitHub remet l'app en ligne automatiquement.

### 4. Choisir ton mot de passe
1. Dans le Worker `plateau` : **Settings → Variables and Secrets → Add**.
2. Type **Secret**, nom `APP_PASSWORD`, valeur : le mot de passe de ton choix. Enregistre.
3. Ouvre l'adresse de l'app et connecte-toi. Tu restes connectée un an sur chaque appareil.

**Sur l'iPhone :**
1. Ouvre l'adresse dans **Safari**.
2. Touche **Partager → Sur l'écran d'accueil**.
3. Ouvre Plateau depuis la nouvelle icône, puis va dans **Comptes → Activer les notifications**.

iOS n'autorise les notifications que depuis l'icône de l'écran d'accueil.

### 5. Brancher Instagram (publication automatique)
Instagram exige une petite « app » côté Meta. Elle ne sert que tes comptes, donc aucune validation de Meta n'est nécessaire (accès « Standard »). Les libellés exacts de Meta peuvent varier un peu.

1. **Passe chaque compte Instagram en mode Créateur ou Entreprise** : dans Instagram, *Paramètres → Type de compte et outils*.
2. Va sur [developers.facebook.com](https://developers.facebook.com) et crée un compte développeur si besoin.
3. **Create App**. Choisis le cas d'usage qui gère le contenu Instagram, puis le produit **Instagram → API setup with Instagram login**.
4. Dans cette page de configuration :
   - Copie l'**Instagram app ID** et l'**Instagram app secret**.
   - Dans la partie **Business login settings**, ajoute l'adresse de retour (*OAuth redirect URI*). Plateau te l'affiche dans **Comptes**, avec un bouton pour la copier. Elle ressemble à `https://plateau.<ton-sous-domaine>.workers.dev/auth/instagram/callback`.
   - Ajoute chacun de tes comptes Instagram à l'app, avec le rôle *Instagram Tester* ou le bouton *Add account* selon l'écran. Accepte l'invitation depuis chaque compte si Instagram en envoie une.
5. Dans Cloudflare (**Settings → Variables and Secrets**), ajoute deux secrets :
   - `IG_APP_ID` : l'Instagram app ID
   - `IG_APP_SECRET` : l'Instagram app secret
6. **Depuis ton Mac**, dans Plateau, onglet **Comptes**, touche **Connecter** à côté de chaque compte Instagram. Sur la page Instagram qui s'ouvre, connecte-toi avec **ce compte-là**. Plateau affiche ensuite le @ du compte relié, pour vérifier.

La connexion dure 60 jours. Plateau la renouvelle tout seul tant que l'app tourne.

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
- Instagram limite chaque compte à 100 publications automatiques par 24 heures.

## Ajouter ou retirer un compte
Tout est dans `public/accounts.js`. Modifie la liste directement sur GitHub (icône crayon), puis enregistre. L'app se met à jour en une minute.

## Plus tard : YouTube et LinkedIn en automatique
- **YouTube** : les vidéos envoyées par une app non vérifiée restent privées. Il faut passer l'audit de l'API YouTube auprès de Google.
- **LinkedIn (pages d'entreprise)** : il faut l'accès « Community Management », qui demande une page vérifiée et une validation par LinkedIn.

Les deux demandes exigent de montrer l'app en fonctionnement. Quand tu seras prête à les faire, ces connexions s'ajouteront au même modèle qu'Instagram.

---

## Dépannage
- **Journal des erreurs** : dans Cloudflare, Worker `plateau` → **Observability** ou **Logs**.
- **« Worker exceeded CPU time limit »** dans le journal : l'offre gratuite donne 10 ms de calcul par requête. Si ce message revient souvent, passe à l'offre payante Workers.
- **Pas de notification sur iPhone** : vérifie que Plateau est ouvert depuis l'icône de l'écran d'accueil et que les notifications sont activées dans **Comptes**. Le bouton « Envoyer une notification test » sert à vérifier.

## Pour les développeurs
- Serveur : `src/` (Cloudflare Worker), base D1, stockage R2, tâche planifiée chaque minute (`src/tick.js`).
- Interface : `public/index.html` (application web installable, sans étape de compilation), `public/sw.js` pour les notifications.
- En local :
  1. `npm install` ;
  2. crée un fichier `.dev.vars` contenant `APP_PASSWORD=...` ;
  3. lance `npx wrangler dev --test-scheduled`. L'adresse `/__scheduled` déclenche la tâche planifiée.
- `IG_GRAPH_BASE` et `IG_OAUTH_BASE` permettent de pointer vers un faux serveur Instagram pour les tests.
