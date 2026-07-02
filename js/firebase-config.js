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
  serverTimestamp
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
  "Lentille"
];


export const LIGNES_CREDIT = [
  "Atelier général",
  "Projet R&D",
  "Maintenance",
  "Personnel"
];

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
  ref,
  uploadBytes,
  getDownloadURL
};
