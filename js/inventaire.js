// ============================================================
// INVENTAIRE.JS — Logique de la page d'inventaire
// ============================================================
import {
  db, storage, collection, getDocs, addDoc, updateDoc, doc,
  ref, uploadBytes, getDownloadURL, query, orderBy,
  PERSONNES, CATEGORIES, LIGNES_CREDIT
} from "./firebase-config.js";
import { injecterSidebar } from "./sidebar.js";

injecterSidebar("inventaire");

let TOUS_COMPOSANTS = [];
let RESERVATIONS_ACTIVES = new Map(); // ids des composants et quantités empruntées actuellement

// ----------------------------------------------------------
// Remplissage des menus déroulants de filtres + formulaire
// ----------------------------------------------------------
function remplirSelect(select, valeurs, placeholderConserve = true) {
  const optionsActuelles = placeholderConserve ? [select.firstElementChild.outerHTML] : [];
  const options = valeurs.map(v => `<option value="${v}">${v}</option>`);
  select.innerHTML = optionsActuelles.concat(options).join("");
}

remplirSelect(document.getElementById("f-categorie"), CATEGORIES, false);
remplirSelect(document.getElementById("f-ligne-credit"), LIGNES_CREDIT, false);
remplirSelect(document.getElementById("filtre-categorie"), CATEGORIES);
remplirSelect(document.getElementById("filtre-ligne-credit"), LIGNES_CREDIT);

// ----------------------------------------------------------
// Chargement des données depuis Firestore
// ----------------------------------------------------------
async function chargerComposants() {
  const snap = await getDocs(collection(db, "composants"));
  TOUS_COMPOSANTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Localisations dynamiques (dépendent des données réelles saisies)
  const localisations = [...new Set(TOUS_COMPOSANTS.map(c => c.localisation).filter(Boolean))].sort();
  remplirSelect(document.getElementById("filtre-localisation"), localisations);
  remplirSelect(document.getElementById("f-localisation"), localisations, true);

  await chargerReservationsActives();
  appliquerFiltresEtAfficher();
}

async function chargerReservationsActives() {
  const snap = await getDocs(collection(db, "reservations"));
  const aujourdhui = new Date().toISOString().split("T")[0];
  const compte = new Map();
  snap.docs
    .map(d => d.data())
    .filter(r => r.dateDebut <= aujourdhui && (!r.dateFin || r.dateFin >= aujourdhui))
    .forEach(r => {
      const q = parseInt(r.quantite, 10) || 1;
      compte.set(r.composantId, (compte.get(r.composantId) || 0) + q);
    });
  RESERVATIONS_ACTIVES = compte;
}

// ----------------------------------------------------------
// Filtrage + regroupement + rendu du tableau
// ----------------------------------------------------------
function appliquerFiltresEtAfficher() {
  const recherche = document.getElementById("filtre-recherche").value.toLowerCase().trim();
  const categorie = document.getElementById("filtre-categorie").value;
  const localisation = document.getElementById("filtre-localisation").value;
  const ligneCredit = document.getElementById("filtre-ligne-credit").value;
  const disponibilite = document.getElementById("filtre-disponibilite").value;
  const groupement = document.getElementById("filtre-groupement").value;

  let resultats = TOUS_COMPOSANTS.filter(c => {
    if (categorie && c.categorie !== categorie) return false;
    if (localisation && c.localisation !== localisation) return false;
    if (ligneCredit && c.ligneCredit !== ligneCredit) return false;
    if (disponibilite === "dispo" && (RESERVATIONS_ACTIVES.get(c.id) || 0) >= (c.quantite || 0)) return false;
    if (disponibilite === "emprunte" && (RESERVATIONS_ACTIVES.get(c.id) || 0) === 0) return false;
    if (recherche) {
      const cible = `${c.reference} ${c.description} ${c.numeroSerie || ""}`.toLowerCase();
      if (!cible.includes(recherche)) return false;
    }
    return true;
  });

  document.getElementById("compteur-resultats").textContent =
    `${resultats.length} élément${resultats.length > 1 ? "s" : ""} affiché${resultats.length > 1 ? "s" : ""} sur ${TOUS_COMPOSANTS.length}`;

  const zone = document.getElementById("zone-tableau");

  if (resultats.length === 0) {
    zone.innerHTML = `
      <div class="tableau-conteneur">
        <div class="etat-vide">
          <div class="etat-vide__titre">Aucun résultat</div>
          <p>Ajuste les filtres ou ajoute un nouveau composant à l'inventaire.</p>
        </div>
      </div>`;
    return;
  }

  if (groupement) {
    const groupes = {};
    resultats.forEach(c => {
      const cle = c[groupement] || "Non renseigné";
      if (!groupes[cle]) groupes[cle] = [];
      groupes[cle].push(c);
    });
    zone.innerHTML = Object.keys(groupes).sort().map(cle => `
      <h2 style="font-size:14px;font-weight:700;color:var(--gris-700);margin:24px 0 10px;">
        ${cle} <span class="texte-discret">(${groupes[cle].length})</span>
      </h2>
      ${rendreTableau(groupes[cle])}
    `).join("");
  } else {
    zone.innerHTML = rendreTableau(resultats);
  }

  // Attache les clics de navigation après rendu
  zone.querySelectorAll("tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      window.location.href = `produit.html?id=${tr.dataset.id}`;
    });
  });
}

function rendreTableau(liste) {
  const lignes = liste.map(c => {
    const emprunte = (RESERVATIONS_ACTIVES.get(c.id) || 0) > 0;
    const quantiteEmpruntee = RESERVATIONS_ACTIVES.get(c.id) || 0;
    const quantiteRestante = Math.max(0, (c.quantite || 0) - quantiteEmpruntee);
    const photoCell = c.photoUrl
      ? `<img src="${c.photoUrl}" class="cell-photo-mini" alt="">`
      : `<div class="cell-photo-vide">—</div>`;
    return `
      <tr data-id="${c.id}">
        <td>${photoCell}</td>
        <td class="cell-ref">${escapeHtml(c.reference)}</td>
        <td>${escapeHtml(c.description)}</td>
        <td><span class="badge badge-categorie">${escapeHtml(c.categorie || "—")}</span></td>
        <td>${escapeHtml(c.localisation || "—")}</td>
        <td>${c.quantite <= 1 ? `<span class="qte-faible">${c.quantite}</span>` : c.quantite}</td>
        <td>${quantiteRestante <= 0 ? `<span class="qte-faible">${quantiteRestante}</span>` : quantiteRestante}</td>
        <td>${c.prix != null ? c.prix.toFixed(2) + " €" : "—"}</td>
        <td>${emprunte ? '<span class="badge badge-emprunte">Emprunté</span>' : '<span class="badge badge-dispo">Disponible</span>'}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="tableau-conteneur">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Référence</th>
            <th>Description</th>
            <th>Catégorie</th>
            <th>Localisation</th>
            <th>Qté</th>
            <th>Qté restante après emprunt</th>
            <th>Prix</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

[
  "filtre-recherche", "filtre-categorie", "filtre-localisation",
  "filtre-ligne-credit", "filtre-disponibilite", "filtre-groupement"
].forEach(id => {
  document.getElementById(id).addEventListener("input", appliquerFiltresEtAfficher);
  document.getElementById(id).addEventListener("change", appliquerFiltresEtAfficher);
});

// ----------------------------------------------------------
// Modale ajout / édition
// ----------------------------------------------------------
const modale = document.getElementById("modale-composant");

document.getElementById("btn-ajouter").addEventListener("click", () => {
  document.getElementById("modale-composant-titre").textContent = "Ajouter un composant / outil";
  document.getElementById("form-composant").reset();
  document.getElementById("f-id").value = "";
  modale.hidden = false;
});

document.querySelectorAll('[data-fermer-modale="modale-composant"]').forEach(btn => {
  btn.addEventListener("click", () => { modale.hidden = true; });
});

document.getElementById("btn-enregistrer-composant").addEventListener("click", async () => {
  const reference = document.getElementById("f-reference").value.trim();
  const description = document.getElementById("f-description").value.trim();
  const categorie = document.getElementById("f-categorie").value;
  const localisation = document.getElementById("f-localisation").value.trim();
  const quantite = parseInt(document.getElementById("f-quantite").value, 10);

  if (!reference || !description || !categorie || !localisation || isNaN(quantite)) {
    alert("Merci de remplir au minimum : référence, description, catégorie, localisation et quantité.");
    return;
  }

  const btn = document.getElementById("btn-enregistrer-composant");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    let photoUrl = null;
    const fichierPhoto = document.getElementById("f-photo").files[0];
    if (fichierPhoto) {
      const cheminStockage = `images/${Date.now()}_${fichierPhoto.name}`;
      const storageRef = ref(storage, cheminStockage);
      await uploadBytes(storageRef, fichierPhoto);
      photoUrl = await getDownloadURL(storageRef);
    }

    const donnees = {
      reference,
      description,
      categorie,
      localisation: document.getElementById("f-localisation").value.trim(),
      quantite,
      prix: parseFloat(document.getElementById("f-prix").value) || null,
      numeroSerie: document.getElementById("f-numero-serie").value.trim(),
      ligneCredit: document.getElementById("f-ligne-credit").value,
      url: document.getElementById("f-url").value.trim(),
      commentaire: document.getElementById("f-commentaire").value.trim()
    };
    if (photoUrl) donnees.photoUrl = photoUrl;

    const idExistant = document.getElementById("f-id").value;
    if (idExistant) {
      await updateDoc(doc(db, "composants", idExistant), donnees);
    } else {
      await addDoc(collection(db, "composants"), donnees);
    }

    modale.hidden = true;
    await chargerComposants();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l'enregistrement : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
  }
});

chargerComposants();
