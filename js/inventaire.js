// ============================================================
// INVENTAIRE.JS — Logique de la page d'inventaire
// ============================================================
import {
  db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  CATEGORIES, LIGNES_CREDIT,
  COLLECTIONS_REFERENTIELS,
  chargerLibellesCollection,
  televerserImage
} from "./firebase-config.js";
import { injecterSidebar } from "./sidebar.js";

injecterSidebar("inventaire");

let TOUS_COMPOSANTS = [];
let RESERVATIONS_ACTIVES = new Map(); // ids des composants et quantités empruntées actuellement
let RESULTATS_AFFICHES = [];
let LOCALISATIONS_DISPONIBLES = [];
const VALEUR_GESTION_LOCALISATIONS = "__gestion_localisations__";
const VALEUR_LOCALISATION_AUTRE = "__autre_localisation__";
const TRANSFERT_ETAT = new Map();

function normaliserRepartitionLocalisations(composant) {
  const repartition = Array.isArray(composant?.localisationsQuantites)
    ? composant.localisationsQuantites
    : [];

  const map = new Map();
  repartition.forEach(item => {
    const localisation = String(item?.localisation || "").trim();
    const quantite = parseInt(item?.quantite, 10);
    if (!localisation || isNaN(quantite) || quantite < 1) return;
    map.set(localisation, (map.get(localisation) || 0) + quantite);
  });

  if (map.size === 0 && composant?.localisation) {
    const quantiteFallback = parseInt(composant?.quantite, 10) || 0;
    if (quantiteFallback > 0) {
      map.set(String(composant.localisation).trim(), quantiteFallback);
    }
  }

  return Array.from(map.entries())
    .map(([localisation, quantite]) => ({ localisation, quantite }))
    .sort((a, b) => (b.quantite - a.quantite) || a.localisation.localeCompare(b.localisation));
}

function listerLocalisationsComposant(composant) {
  const repartition = normaliserRepartitionLocalisations(composant);
  if (repartition.length > 0) return repartition.map(item => item.localisation);
  return composant?.localisation ? [composant.localisation] : [];
}

function localisationPrincipaleComposant(composant) {
  const localisations = listerLocalisationsComposant(composant);
  return localisations[0] || "Non renseigné";
}

function formaterLocalisationsPourExport(composant) {
  const repartition = normaliserRepartitionLocalisations(composant);
  if (repartition.length === 0) return composant?.localisation || "";
  return repartition.map(item => `${item.localisation}:${item.quantite}`).join(" | ");
}

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

  LOCALISATIONS_DISPONIBLES = [...localisations];

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
  const fallbackLocalisations = [...new Set(TOUS_COMPOSANTS.flatMap(c => listerLocalisationsComposant(c)).filter(Boolean))].sort();
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
    if (localisation && !listerLocalisationsComposant(c).includes(localisation)) return false;
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
      const cle = groupement === "localisation"
        ? localisationPrincipaleComposant(c)
        : (c[groupement] || "Non renseigné");
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
        <td>${rendreBadgeCouleur(c.categorie, "categorie")}</td>
        <td>${rendreBadgesLocalisationsComposant(c)}</td>
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

function hashTexte(texte) {
  return Array.from(String(texte || ""))
    .reduce((acc, char) => ((acc * 33) + char.charCodeAt(0)) >>> 0, 5381);
}

function styleBadgeDepuisTexte(texte, type = "categorie") {
  const hash = hashTexte(texte);
  const decalage = type === "localisation" ? 33 : 0;
  const teinte = (hash + decalage) % 360;
  const fond = `hsl(${teinte}, 78%, 93%)`;
  const texteCouleur = `hsl(${teinte}, 56%, 32%)`;
  const bordure = `hsl(${teinte}, 48%, 80%)`;
  return `--badge-bg:${fond};--badge-fg:${texteCouleur};--badge-brd:${bordure};`;
}

function rendreBadgeCouleur(libelle, type) {
  const valeur = libelle || "Non renseigné";
  return `<span class="badge badge-couleur badge-${type}" style="${styleBadgeDepuisTexte(valeur, type)}">${escapeHtml(valeur)}</span>`;
}

function rendreBadgesLocalisationsComposant(composant) {
  const repartition = normaliserRepartitionLocalisations(composant);

  if (repartition.length === 0) {
    return rendreBadgeCouleur(composant?.localisation, "localisation");
  }

  return `<div class="cell-localisations-multi">${repartition.map(item => `
    <span>${rendreBadgeCouleur(item.localisation, "localisation")} <span class="texte-discret">(${item.quantite})</span></span>
  `).join("")}</div>`;
}

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
      formaterLocalisationsPourExport(c),
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

function toutesLesLocalisationsConnues() {
  const set = new Set((LOCALISATIONS_DISPONIBLES || []).filter(Boolean));
  TOUS_COMPOSANTS.forEach(c => {
    listerLocalisationsComposant(c).forEach(loc => {
      if (loc) set.add(loc);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function repartitionVersMap(composant) {
  const map = new Map();
  normaliserRepartitionLocalisations(composant).forEach(item => {
    map.set(item.localisation, item.quantite);
  });
  return map;
}

function quantiteDisponibleLocalisation(composant, localisation) {
  if (!localisation) return 0;
  return repartitionVersMap(composant).get(localisation) || 0;
}

function initialiserEtatTransfert() {
  TRANSFERT_ETAT.clear();
  TOUS_COMPOSANTS.forEach(composant => {
    const repartition = normaliserRepartitionLocalisations(composant);
    const depuis = repartition[0]?.localisation || "";
    TRANSFERT_ETAT.set(composant.id, {
      selectionne: false,
      depuis,
      quantite: depuis ? 1 : 0
    });
  });
}

function remplirSelectDestinationTransfert() {
  const select = document.getElementById("tm-destination");
  if (!select) return;

  const options = toutesLesLocalisationsConnues().map(loc => `<option value="${escapeAttr(loc)}">${escapeHtml(loc)}</option>`);
  select.innerHTML = [
    `<option value="">Sélectionner une localisation</option>`,
    ...options,
    `<option value="${VALEUR_LOCALISATION_AUTRE}">Autre (saisie manuelle)…</option>`
  ].join("");
}

function destinationTransfertCourante() {
  const select = document.getElementById("tm-destination");
  if (!select) return "";
  if (select.value !== VALEUR_LOCALISATION_AUTRE) return String(select.value || "").trim();
  return String(document.getElementById("tm-destination-autre")?.value || "").trim();
}

function mettreAJourVisibiliteDestinationAutre() {
  const select = document.getElementById("tm-destination");
  const zone = document.getElementById("tm-destination-autre-zone");
  if (!select || !zone) return;
  zone.hidden = select.value !== VALEUR_LOCALISATION_AUTRE;
}

function rendreRepartitionTransfert(composant) {
  const repartition = normaliserRepartitionLocalisations(composant);
  if (repartition.length === 0) return "<span class=\"texte-discret\">Aucune localisation</span>";
  return `<div class="transfert-repartition">${repartition.map(item => `${rendreBadgeCouleur(item.localisation, "localisation")} <span class="texte-discret">(${item.quantite})</span>`).join("")}</div>`;
}

function rendreLignesTransfert() {
  const tbody = document.getElementById("tm-lignes");
  if (!tbody) return;

  const recherche = String(document.getElementById("tm-recherche")?.value || "").toLowerCase().trim();
  const composants = TOUS_COMPOSANTS.filter(c => {
    if (!recherche) return true;
    const cible = `${c.reference || ""} ${c.description || ""}`.toLowerCase();
    return cible.includes(recherche);
  });

  if (composants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="texte-discret">Aucun composant trouvé avec ce filtre.</td></tr>`;
    mettreAJourAideTransfert();
    mettreAJourSelectAllTransfert();
    return;
  }

  tbody.innerHTML = composants.map(composant => {
    const etat = TRANSFERT_ETAT.get(composant.id) || { selectionne: false, depuis: "", quantite: 0 };
    const localisations = listerLocalisationsComposant(composant);
    const optionsDepuis = [
      `<option value="">Sélectionner</option>`,
      ...localisations.map(loc => `<option value="${escapeAttr(loc)}"${loc === etat.depuis ? " selected" : ""}>${escapeHtml(loc)}</option>`)
    ].join("");

    const qteDisponible = quantiteDisponibleLocalisation(composant, etat.depuis);
    const valeurQte = etat.quantite > 0 ? etat.quantite : (qteDisponible > 0 ? 1 : 0);
    const qteInvalide = etat.selectionne && (!etat.depuis || valeurQte < 1 || valeurQte > qteDisponible);
    const classeLigne = qteInvalide ? ' class="transfert-aide-erreur"' : "";

    return `
      <tr data-tm-id="${escapeAttr(composant.id)}"${classeLigne}>
        <td>
          <input type="checkbox" data-tm-select ${etat.selectionne ? "checked" : ""}>
        </td>
        <td class="cell-ref">${escapeHtml(composant.reference || "")}</td>
        <td>${escapeHtml(composant.description || "")}</td>
        <td>
          <select data-tm-depuis class="transfert-loc-select" ${localisations.length === 0 ? "disabled" : ""}>
            ${optionsDepuis}
          </select>
        </td>
        <td>
          <input type="number" data-tm-qte class="transfert-qte-input" min="1" value="${valeurQte}" ${qteDisponible > 0 ? `max="${qteDisponible}"` : "disabled"}>
          <div class="texte-discret">Max: ${qteDisponible}</div>
        </td>
        <td>${composant.quantite || 0}</td>
        <td>${rendreRepartitionTransfert(composant)}</td>
      </tr>
    `;
  }).join("");

  mettreAJourAideTransfert();
  mettreAJourSelectAllTransfert();
}

function mettreAJourSelectAllTransfert() {
  const selectAll = document.getElementById("tm-select-all");
  if (!selectAll) return;

  const idsVisibles = Array.from(document.querySelectorAll("#tm-lignes tr[data-tm-id]")).map(tr => tr.dataset.tmId);
  if (idsVisibles.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const nbSelectionnes = idsVisibles.filter(id => TRANSFERT_ETAT.get(id)?.selectionne).length;
  selectAll.checked = nbSelectionnes === idsVisibles.length;
  selectAll.indeterminate = nbSelectionnes > 0 && nbSelectionnes < idsVisibles.length;
}

function mettreAJourAideTransfert() {
  const aide = document.getElementById("tm-aide-selection");
  if (!aide) return;

  const destination = destinationTransfertCourante();
  const selectionnes = TOUS_COMPOSANTS.filter(c => TRANSFERT_ETAT.get(c.id)?.selectionne);

  if (selectionnes.length === 0) {
    aide.className = "champ-aide";
    aide.textContent = "Sélectionnez au moins un composant à transférer.";
    return;
  }

  const erreurs = [];
  selectionnes.forEach(c => {
    const etat = TRANSFERT_ETAT.get(c.id);
    const qte = parseInt(etat?.quantite, 10) || 0;
    const depuis = String(etat?.depuis || "").trim();
    const qteDispo = quantiteDisponibleLocalisation(c, depuis);
    if (!depuis) erreurs.push(`${c.reference || c.id}: localisation source manquante.`);
    else if (qte < 1 || qte > qteDispo) erreurs.push(`${c.reference || c.id}: quantité invalide (max ${qteDispo}).`);
    if (destination && depuis && destination === depuis) erreurs.push(`${c.reference || c.id}: source et destination identiques.`);
  });

  if (!destination) {
    aide.className = "champ-aide transfert-aide-erreur";
    aide.textContent = `Destination manquante. ${selectionnes.length} composant(s) sélectionné(s).`;
    return;
  }

  if (erreurs.length > 0) {
    aide.className = "champ-aide transfert-aide-erreur";
    aide.textContent = `Corriger ${erreurs.length} erreur(s) avant de confirmer.`;
    return;
  }

  aide.className = "champ-aide transfert-aide-ok";
  aide.textContent = `${selectionnes.length} composant(s) prêt(s) à être transféré(s) vers "${destination}".`;
}

function ouvrirModaleTransfert() {
  initialiserEtatTransfert();
  remplirSelectDestinationTransfert();
  const champRecherche = document.getElementById("tm-recherche");
  if (champRecherche) champRecherche.value = "";
  document.getElementById("tm-destination")?.focus();
  mettreAJourVisibiliteDestinationAutre();
  rendreLignesTransfert();
  document.getElementById("modale-transfert-localisation").hidden = false;
}

async function confirmerTransfertMultiLocalisation() {
  const destination = destinationTransfertCourante();
  if (!destination) {
    alert("Merci de sélectionner une localisation de destination.");
    return;
  }

  const cibles = TOUS_COMPOSANTS
    .map(c => ({ composant: c, etat: TRANSFERT_ETAT.get(c.id) || {} }))
    .filter(item => item.etat.selectionne);

  if (cibles.length === 0) {
    alert("Sélectionnez au moins un composant.");
    return;
  }

  const misesAJour = [];
  for (const { composant, etat } of cibles) {
    const depuis = String(etat.depuis || "").trim();
    const quantite = parseInt(etat.quantite, 10) || 0;

    if (!depuis) {
      alert(`Localisation source manquante pour ${composant.reference || composant.id}.`);
      return;
    }
    if (depuis === destination) {
      alert(`Source et destination identiques pour ${composant.reference || composant.id}.`);
      return;
    }

    const map = repartitionVersMap(composant);
    const disponible = map.get(depuis) || 0;
    if (quantite < 1 || quantite > disponible) {
      alert(`Quantité invalide pour ${composant.reference || composant.id}. Maximum autorisé: ${disponible}.`);
      return;
    }

    const resteSource = disponible - quantite;
    if (resteSource > 0) map.set(depuis, resteSource);
    else map.delete(depuis);
    map.set(destination, (map.get(destination) || 0) + quantite);

    const localisationsQuantites = Array.from(map.entries())
      .map(([localisation, qte]) => ({ localisation, quantite: qte }))
      .sort((a, b) => (b.quantite - a.quantite) || a.localisation.localeCompare(b.localisation));

    misesAJour.push({
      id: composant.id,
      donnees: {
        localisation: localisationsQuantites[0]?.localisation || "",
        localisationsQuantites
      }
    });
  }

  const btn = document.getElementById("btn-confirmer-transfert-localisation");
  btn.disabled = true;
  btn.textContent = "Transfert en cours…";

  try {
    await Promise.all(misesAJour.map(item => updateDoc(doc(db, "composants", item.id), item.donnees)));
    document.getElementById("modale-transfert-localisation").hidden = true;
    await chargerComposants();
    alert(`${misesAJour.length} composant(s) transféré(s) vers "${destination}".`);
  } catch (err) {
    console.error(err);
    alert("Erreur lors du transfert: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Appliquer les transferts";
  }
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
const modaleTransfert = document.getElementById("modale-transfert-localisation");

document.getElementById("btn-exporter-csv").addEventListener("click", exporterCsv);
document.getElementById("btn-transfert-localisation").addEventListener("click", ouvrirModaleTransfert);

document.getElementById("btn-ajouter").addEventListener("click", () => {
  document.getElementById("modale-composant-titre").textContent = "Ajouter un composant / outil";
  document.getElementById("form-composant").reset();
  document.getElementById("f-id").value = "";
  modale.hidden = false;
});

document.querySelectorAll('[data-fermer-modale="modale-composant"]').forEach(btn => {
  btn.addEventListener("click", () => { modale.hidden = true; });
});

document.querySelectorAll('[data-fermer-modale="modale-transfert-localisation"]').forEach(btn => {
  btn.addEventListener("click", () => { modaleTransfert.hidden = true; });
});

document.getElementById("tm-destination")?.addEventListener("change", () => {
  mettreAJourVisibiliteDestinationAutre();
  mettreAJourAideTransfert();
});

document.getElementById("tm-destination-autre")?.addEventListener("input", mettreAJourAideTransfert);
document.getElementById("tm-recherche")?.addEventListener("input", rendreLignesTransfert);

document.getElementById("tm-select-all")?.addEventListener("change", e => {
  const coche = Boolean(e.target.checked);
  document.querySelectorAll("#tm-lignes tr[data-tm-id]").forEach(tr => {
    const id = tr.dataset.tmId;
    const etat = TRANSFERT_ETAT.get(id);
    if (!etat) return;
    etat.selectionne = coche;
    TRANSFERT_ETAT.set(id, etat);
  });
  rendreLignesTransfert();
});

document.getElementById("tm-lignes")?.addEventListener("change", e => {
  const tr = e.target.closest("tr[data-tm-id]");
  if (!tr) return;
  const id = tr.dataset.tmId;
  const composant = TOUS_COMPOSANTS.find(c => c.id === id);
  if (!composant) return;

  const etat = TRANSFERT_ETAT.get(id) || { selectionne: false, depuis: "", quantite: 0 };

  if (e.target.matches("[data-tm-select]")) {
    etat.selectionne = Boolean(e.target.checked);
  }

  if (e.target.matches("[data-tm-depuis]")) {
    etat.depuis = e.target.value;
    const max = quantiteDisponibleLocalisation(composant, etat.depuis);
    etat.quantite = max > 0 ? Math.min(Math.max(parseInt(etat.quantite, 10) || 1, 1), max) : 0;
  }

  TRANSFERT_ETAT.set(id, etat);
  rendreLignesTransfert();
});

document.getElementById("tm-lignes")?.addEventListener("input", e => {
  if (!e.target.matches("[data-tm-qte]")) return;
  const tr = e.target.closest("tr[data-tm-id]");
  if (!tr) return;
  const id = tr.dataset.tmId;
  const composant = TOUS_COMPOSANTS.find(c => c.id === id);
  if (!composant) return;
  const etat = TRANSFERT_ETAT.get(id) || { selectionne: false, depuis: "", quantite: 0 };
  const max = quantiteDisponibleLocalisation(composant, etat.depuis);
  const qte = parseInt(e.target.value, 10) || 0;
  etat.quantite = max > 0 ? Math.min(Math.max(qte, 1), max) : 0;
  TRANSFERT_ETAT.set(id, etat);
  mettreAJourAideTransfert();
  mettreAJourSelectAllTransfert();
});

document.getElementById("btn-confirmer-transfert-localisation")?.addEventListener("click", confirmerTransfertMultiLocalisation);

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
      photoUrl = await televerserImage(fichierPhoto, "images");
    }

    const donnees = {
      reference,
      description,
      categorie,
      localisation,
      localisationsQuantites: quantite > 0 ? [{ localisation, quantite }] : [],
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
