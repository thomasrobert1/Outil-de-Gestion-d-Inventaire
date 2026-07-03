// ============================================================
// INVENTAIRE.JS — Logique de la page d'inventaire
// ============================================================
import {
  db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  CATEGORIES, LIGNES_CREDIT,
  COLLECTIONS_REFERENTIELS,
  chargerLibellesCollection
} from "./firebase-config.js";
import { injecterSidebar } from "./sidebar.js";

injecterSidebar("inventaire");

let TOUS_COMPOSANTS = [];
let RESERVATIONS_ACTIVES = new Map(); // ids des composants et quantités empruntées actuellement
let RESULTATS_AFFICHES = [];
const VALEUR_GESTION_LOCALISATIONS = "__gestion_localisations__";

// ----------------------------------------------------------
// Remplissage des menus déroulants de filtres + formulaire
// ----------------------------------------------------------
function remplirSelect(select, valeurs, placeholderConserve = true) {
  const optionsActuelles = placeholderConserve && select.firstElementChild ? [select.firstElementChild.outerHTML] : [];
  const options = valeurs.map(v => `<option value="${v}">${v}</option>`);
  select.innerHTML = optionsActuelles.concat(options).join("");
}

async function chargerReferentielsMenus(fallbackLocalisations = []) {
  const [categories, lignesCredit, localisations] = await Promise.all([
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.categories, CATEGORIES),
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.lignesCredit, LIGNES_CREDIT),
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.localisations, fallbackLocalisations)
  ]);

  remplirSelect(document.getElementById("f-categorie"), categories, false);
  remplirSelect(document.getElementById("f-ligne-credit"), lignesCredit, false);
  remplirSelect(document.getElementById("filtre-categorie"), categories);
  remplirSelect(document.getElementById("filtre-ligne-credit"), lignesCredit);
  remplirSelect(document.getElementById("filtre-localisation"), localisations);
  remplirSelect(document.getElementById("f-localisation"), localisations, true);
}

// ----------------------------------------------------------
// Chargement des données depuis Firestore
// ----------------------------------------------------------
async function chargerComposants() {
  const snap = await getDocs(collection(db, "composants"));
  TOUS_COMPOSANTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Les menus déroulants sont pilotés par l'onglet Gestion (avec fallback sur l'existant).
  const fallbackLocalisations = [...new Set(TOUS_COMPOSANTS.map(c => c.localisation).filter(Boolean))].sort();
  await chargerReferentielsMenus(fallbackLocalisations);

  const selectFormLocalisation = document.getElementById("f-localisation");
  if (selectFormLocalisation && !selectFormLocalisation.querySelector(`option[value="${VALEUR_GESTION_LOCALISATIONS}"]`)) {
    selectFormLocalisation.insertAdjacentHTML(
      "beforeend",
      `<option value="${VALEUR_GESTION_LOCALISATIONS}">Gérer les localisations…</option>`
    );
  }

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
      const cible = `${c.reference || ""} ${c.description || ""} ${c.numeroSerie || ""}`.toLowerCase();
      if (!cible.includes(recherche)) return false;
    }
    return true;
  });

  RESULTATS_AFFICHES = resultats;

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
        ${escapeHtml(cle)} <span class="texte-discret">(${groupes[cle].length})</span>
      </h2>
      ${rendreTableau(groupes[cle])}
    `).join("");
  } else {
    zone.innerHTML = rendreTableau(resultats);
  }

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
      ? `<img src="${escapeAttr(c.photoUrl)}" class="cell-photo-mini" alt="">`
      : `<div class="cell-photo-vide">—</div>`;

    return `
      <tr data-id="${escapeAttr(c.id)}">
        <td>${photoCell}</td>
        <td class="cell-ref">${escapeHtml(c.reference || "")}</td>
        <td>${escapeHtml(c.description || "")}</td>
        <td><span class="badge badge-categorie">${escapeHtml(c.categorie || "—")}</span></td>
        <td>${escapeHtml(c.localisation || "—")}</td>
        <td>${(c.quantite || 0) <= 1 ? `<span class="qte-faible">${c.quantite || 0}</span>` : (c.quantite || 0)}</td>
        <td>${quantiteRestante <= 0 ? `<span class="qte-faible">${quantiteRestante}</span>` : quantiteRestante}</td>
        <td>${c.prix != null ? Number(c.prix).toFixed(2) + " €" : "—"}</td>
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
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

function escapeCsv(valeur) {
  if (valeur == null) return "";
  const texte = String(valeur).replace(/\r?\n/g, " ");
  return `"${texte.replace(/"/g, '""')}"`;
}

function exporterCsv() {
  if (RESULTATS_AFFICHES.length === 0) {
    alert("Aucun élément à exporter pour le moment.");
    return;
  }

  const separateur = ";";
  const entetes = ["id", "reference", "description", "categorie", "localisation", "quantite", "quantiteRestante", "prix", "statut", "numeroSerie", "ligneCredit", "url", "commentaire", "photoUrl"];
  const lignes = [entetes.map(v => escapeCsv(v)).join(separateur)];

  RESULTATS_AFFICHES.forEach(c => {
    const quantiteEmpruntee = RESERVATIONS_ACTIVES.get(c.id) || 0;
    const quantiteRestante = Math.max(0, (c.quantite || 0) - quantiteEmpruntee);
    const statut = quantiteEmpruntee > 0 ? "Emprunté" : "Disponible";
    const valeurs = [
      c.id || "",
      c.reference || "",
      c.description || "",
      c.categorie || "",
      c.localisation || "",
      c.quantite ?? "",
      quantiteRestante,
      c.prix ?? "",
      statut,
      c.numeroSerie || "",
      c.ligneCredit || "",
      c.url || "",
      c.commentaire || "",
      c.photoUrl || ""
    ];
    lignes.push(valeurs.map(v => escapeCsv(v)).join(separateur));
  });

  const contenuCsv = "\uFEFF" + lignes.join("\r\n");
  const blob = new Blob([contenuCsv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `inventaire-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

// ---- Upload image via Issue + Action ----
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture du fichier image impossible."));
    reader.readAsDataURL(file);
  });
}

async function creerIssueUploadImage(reference, dataUrl) {
  const token = window.localStorage.getItem("GITHUB_TOKEN") || "";
  if (!token) {
    throw new Error("Token GitHub manquant. Exécute: localStorage.setItem('GITHUB_TOKEN','TON_TOKEN')");
  }

  const payload = { reference, dataUrl };
  const res = await fetch("https://api.github.com/repos/thomasrobert1/Outil-de-Gestion-d-Inventaire/issues", {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: `[IMG_UPLOAD] ${reference}`,
      body: JSON.stringify(payload)
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Création issue upload impossible: ${res.status} ${txt}`);
  }

  return res.json();
}

async function attendreImageDepuisIssue(issueNumber, timeoutMs = 120000, intervalMs = 3000) {
  const token = window.localStorage.getItem("GITHUB_TOKEN") || "";
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `https://api.github.com/repos/thomasrobert1/Outil-de-Gestion-d-Inventaire/issues/${issueNumber}/comments`,
      {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    if (res.ok) {
      const comments = await res.json();
      const marker = comments.find(c => typeof c.body === "string" && c.body.startsWith("IMAGE_SAVED"));
      if (marker) {
        const lines = marker.body.split("\n");
        const imageUrlLine = lines.find(l => l.startsWith("imageUrl="));
        const imageUrl = imageUrlLine ? imageUrlLine.replace("imageUrl=", "").trim() : "";
        if (imageUrl) return imageUrl;
      }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error("Timeout: image non générée par GitHub Actions.");
}

[
  "filtre-recherche", "filtre-categorie", "filtre-localisation",
  "filtre-ligne-credit", "filtre-disponibilite", "filtre-groupement"
].forEach(id => {
  document.getElementById(id).addEventListener("input", appliquerFiltresEtAfficher);
  document.getElementById(id).addEventListener("change", appliquerFiltresEtAfficher);
});

document.getElementById("f-localisation").addEventListener("change", event => {
  if (event.target.value === VALEUR_GESTION_LOCALISATIONS) {
    window.location.href = "membres.html#gestion-localisations";
  }
});

// ----------------------------------------------------------
// Modale ajout / édition
// ----------------------------------------------------------
const modale = document.getElementById("modale-composant");

document.getElementById("btn-exporter-csv").addEventListener("click", exporterCsv);

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
      const dataUrl = await fileToDataUrl(fichierPhoto);
      const issue = await creerIssueUploadImage(reference, dataUrl);
      photoUrl = await attendreImageDepuisIssue(issue.number);
    }

    const donnees = {
      reference,
      description,
      categorie,
      localisation,
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
      if (quantite === 0) {
        await deleteDoc(doc(db, "composants", idExistant));
      } else {
        await updateDoc(doc(db, "composants", idExistant), donnees);
      }
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
