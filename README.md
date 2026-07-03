# Inventaire Atelier — Gestion de composants et outils

Application web de gestion d'inventaire avec réservation et historique des emprunts.
Stack : HTML / CSS / JavaScript natif + Firebase (Firestore + Storage).

## Structure du projet

```
inventaire-app/
├── index.html              Page Inventaire (liste + filtres)
├── produit.html             Fiche détaillée d'un composant
├── calendrier.html          Calendrier mensuel des réservations
├── historique.html          Liste complète des réservations
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js   Configuration + listes (personnes, catégories…)
│   ├── sidebar.js            Menu de navigation commun
│   ├── inventaire.js
│   ├── produit.js
│   ├── calendrier.js
│   └── historique.js
└── images/                   (dossier local, optionnel — les photos passent
                                en réalité par Firebase Storage)
```

## Étape 1 — Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) et crée un projet (gratuit).
2. Dans **Paramètres du projet** (icône engrenage) > **Général**, descends jusqu'à
   "Vos applications" et clique sur l'icône Web `</>`. Donne un nom à l'app
   (pas besoin de cocher Hosting pour l'instant).
3. Firebase t'affiche un objet `firebaseConfig`. Copie-le.
4. Ouvre `js/firebase-config.js` dans VS Code et remplace les valeurs
   `VOTRE_API_KEY`, `VOTRE_PROJET`, etc. par les tiennes.

## Étape 2 — Activer Firestore (la base de données)

1. Dans le menu de gauche de la console Firebase : **Compilation** > **Firestore Database**.
2. Clique sur **Créer une base de données**.
3. Choisis **Mode test** pour démarrer (accès libre en lecture/écriture pendant 30 jours —
   largement suffisant pour développer ; on durcira les règles plus tard, voir section Sécurité).
4. Choisis une région proche de toi (ex: `eur3 (europe-west)`).

Les collections `composants` et `reservations` seront créées automatiquement
dès le premier ajout depuis l'application — tu n'as rien à créer manuellement.

## Étape 3 — Activer Firebase Storage (les photos)

1. Menu **Compilation** > **Storage** > **Commencer**.
2. Choisis **Mode test** également.
3. Même région que Firestore de préférence.

## Étape 4 — Lancer le site en local

Les modules JavaScript (`type="module"`) ne fonctionnent pas en ouvrant
directement le fichier HTML (`file://`) — il faut un petit serveur local.
Deux options simples avec VS Code :

**Option A — Extension Live Server**
Installe l'extension "Live Server" dans VS Code, puis clic droit sur
`index.html` > "Open with Live Server".

**Option B — Serveur Python intégré**
Dans le terminal, depuis le dossier du projet :
```bash
python3 -m http.server 8000
```
Puis ouvre `http://localhost:8000` dans ton navigateur.

## Étape 5 — Personnaliser les listes de référence

Dans `js/firebase-config.js`, modifie les tableaux suivants selon ton équipe :

```js
export const PERSONNES = ["Alexandre Dupont", "Marie Lefebvre", ...];
export const CATEGORIES = ["Composants électroniques", "Outils à main", ...];
export const LIGNES_CREDIT = ["Atelier général", "Projet R&D", ...];
```

Ces listes alimentent tous les menus déroulants du site (filtres, formulaire
d'ajout, formulaire de réservation).

## Étape 6 — Déployer sur GitHub

1. Crée un dépôt sur GitHub, pousse le contenu du dossier `inventaire-app/`.
2. Pour un hébergement gratuit immédiat : **Settings** > **Pages** > Source =
   branche `main`, dossier `/ (root)`. Le site sera accessible à une URL du type
   `https://tonpseudo.github.io/nom-du-depot/`.

⚠️ Important : ton fichier `firebase-config.js` contient ta config Firebase
(API key, etc.). Ce n'est pas un secret critique pour un projet Firebase
public en mode test (la clé identifie le projet, elle ne donne pas un accès
admin), mais ce sera essentiel de mettre en place les règles de sécurité
ci-dessous avant de partager le lien largement.

## Sécurité — à faire avant un usage réel en équipe

Le "Mode test" choisi plus haut **expire au bout de 30 jours** et surtout
laisse n'importe qui avec le lien lire/écrire toute la base. Pour la suite :

1. **Authentification** : active Firebase Authentication (email/mot de passe)
   et restreins l'accès aux comptes de ton équipe. Je peux te fournir le code
   de connexion quand tu seras prêt — il s'intègre sans tout refaire.
2. **Règles Firestore** : dans Firestore > Règles, remplace le mode test par
   des règles qui exigent `request.auth != null` pour lire/écrire.
3. **Règles Storage** : même principe pour les photos.

## Notes sur les choix techniques

- **Pas de framework (React/Vue)** : volontaire, pour rester simple à
  comprendre et modifier directement dans VS Code, fichier par fichier.
- **Synchronisation temps réel** : actuellement les pages se rechargent via
  `getDocs()` à chaque ouverture/action. Si tu veux que les changements d'un
  collègue apparaissent en direct sans recharger la page, on peut remplacer
  ces appels par `onSnapshot()` (déjà importé dans `firebase-config.js`,
  prêt à l'emploi).
- **Photos** : uploadées directement vers Firebase Storage depuis le
  formulaire, l'URL générée est stockée dans la fiche Firestore du composant.

## Option — Stocker les photos sur GitHub

Le projet supporte maintenant un upload photo vers un dépôt GitHub (dossier dédié),
utilisé en priorité si la configuration est renseignée.

1. Ouvre `js/firebase-config.js`.
2. Renseigne l'objet `GITHUB_MEDIA_CONFIG` :
   - `owner` : ton utilisateur ou organisation GitHub
   - `repo` : nom du dépôt cible
   - `branch` : branche cible (ex: `main`)
   - `folder` : dossier de stockage (ex: `media/composants`)
   - `token` : Personal Access Token GitHub avec droit `contents:write`
3. Le token est sensible: évite d'exposer ce fichier publiquement tel quel.

Quand `GITHUB_MEDIA_CONFIG` est complet, les photos des composants sont écrites
dans ce dépôt GitHub, puis l'URL est enregistrée dans Firestore.
