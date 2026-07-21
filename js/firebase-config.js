// ============================================================
// CONFIGURATION FIREBASE
// ============================================================
// 1. Va sur https://console.firebase.google.com
// 2. Crée un projet (gratuit)
// 3. Dans "Paramètres du projet" > "Général" > section "Vos applications"
//    clique sur l'icône Web (</>) pour enregistrer une appli web
// 4. Copie l'objet de config qui t'est donné et remplace celui ci-dessous
// 5. Active Firestore : menu "Compilation" > "Firestore Database" > Créer une base
//    -> choisis "Mode test" pour démarrer (accès libre, à sécuriser plus tard)
// 6. Active Storage : menu "Compilation" > "Storage" > Commencer
//    -> choisis "Mode test" également
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDdxKFuptD1w8jW1rDpMjsU9T8tV4mu5Po",
  authDomain: "outil-de-gestion-d-inventaire.firebaseapp.com",
  projectId: "outil-de-gestion-d-inventaire",
  storageBucket: "outil-de-gestion-d-inventaire.firebasestorage.app",
  messagingSenderId: "564488243881",
  appId: "1:564488243881:web:9edb5055ab91d01499b7b8"
};

// Initialisation (SDK chargé en CDN dans les fichiers HTML via <script type="module">)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const STORAGE_BUCKETS_CANDIDATS = [
  firebaseConfig.storageBucket,
  `${firebaseConfig.projectId}.appspot.com`
].filter(Boolean);

function nomFichierSecurise(nom) {
  return String(nom || "image")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
}

function lireFichierEnDataUrl(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(lecteur.result);
    lecteur.onerror = () => reject(new Error("Impossible de lire le fichier image."));
    lecteur.readAsDataURL(fichier);
  });
}

async function compresserImageEnDataUrl(fichier, maxLargeur = 1280, qualite = 0.82) {
  const sourceDataUrl = await lireFichierEnDataUrl(fichier);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l'image sélectionnée."));
    img.src = sourceDataUrl;
  });

  const ratio = image.width > maxLargeur ? maxLargeur / image.width : 1;
  const largeur = Math.max(1, Math.round(image.width * ratio));
  const hauteur = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext("2d");
  if (!ctx) return sourceDataUrl;

  ctx.drawImage(image, 0, 0, largeur, hauteur);
  return canvas.toDataURL("image/jpeg", qualite);
}

async function compresserImagePourFirestore(fichier, tailleMax = 850000) {
  const largeurs = [1280, 1024, 900, 768, 640, 560, 480];
  const qualites = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];

  for (const largeur of largeurs) {
    for (const qualite of qualites) {
      const dataUrl = await compresserImageEnDataUrl(fichier, largeur, qualite);
      if (typeof dataUrl === "string" && dataUrl.length <= tailleMax) {
        return dataUrl;
      }
    }
  }

  return null;
}

export async function televerserImage(fichier, dossier = "images") {
  if (!fichier) return null;

  const nom = `${Date.now()}_${nomFichierSecurise(fichier.name)}`;
  let derniereErreur = null;

  for (const bucket of STORAGE_BUCKETS_CANDIDATS) {
    try {
      const storageCible = getStorage(app, `gs://${bucket}`);
      const cheminStockage = `${dossier}/${nom}`;
      const storageRef = ref(storageCible, cheminStockage);
      await uploadBytes(storageRef, fichier, { contentType: fichier.type || "application/octet-stream" });
      return await getDownloadURL(storageRef);
    } catch (err) {
      derniereErreur = err;
    }
  }

  // Plan B: stocke l'image compressée directement dans Firestore (champ photoUrl)
  // quand Storage n'est pas disponible (règles expirées, bucket mal configuré, etc.).
  if ((fichier.type || "").startsWith("image/")) {
    const dataUrl = await compresserImagePourFirestore(fichier, 850000);
    if (typeof dataUrl === "string") return dataUrl;
  }

  throw (
    derniereErreur ||
    new Error("Échec de l'upload de l'image vers Firebase Storage et impossible de compresser l'image pour Firestore.")
  );
}

// Listes de référence partagées dans toute l'application
// Modifie ces tableaux selon ton équipe / tes catégories réelles
export const PERSONNES = [
  "Alexandre Dupont",
  "Marie Lefebvre",
  "Thomas Bernard",
  "Camille Petit",
  "Lucas Moreau"
];

export const CATEGORIES = [
  "Composants électroniques",
  "Outils à main",
  "Protection / Sécurité",
  "Nettoyage / Entretien",
  "Câblage",
  "Fixation",
  "Consommables",
  "Autre",
  "Manuels / Documentation",
  "Lentille / Optique"
];


export const LIGNES_CREDIT = [
  "Atelier général",
  "Projet R&D",
  "Maintenance",
  "Personnel"
];

export function normaliserCategorie(categorie) {
  if (categorie === "Lentille / Optiques") return "Lentille / Optique";
  return categorie;
}

export const COLLECTIONS_REFERENTIELS = {
  membres: "membres",
  categories: "categories",
  localisations: "localisations",
  lignesCredit: "lignes_credit"
};

export async function chargerLibellesCollection(collectionNom, valeurParDefaut = []) {
  const snap = await getDocs(collection(db, collectionNom));
  const valeurs = snap.docs
    .map(d => d.data().libelle || d.data().nom || d.data().label || d.id)
    .filter(Boolean);
  const uniques = [...new Set(valeurs)];
  return uniques.length > 0 ? uniques.sort((a, b) => a.localeCompare(b)) : valeurParDefaut;
}

export async function chargerDocumentsCollection(collectionNom) {
  const snap = await getDocs(collection(db, collectionNom));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export {
  db,
  storage,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  deleteField,
  ref,
  uploadBytes,
  getDownloadURL
};
