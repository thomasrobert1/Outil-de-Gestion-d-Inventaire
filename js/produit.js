// ============================================================
// PRODUIT.JS — Fiche détaillée d'un composant + réservations
// ============================================================
import {
  db, doc, getDoc, updateDoc, deleteDoc, collection, addDoc,
  getDocs, query, where, orderBy, deleteField,
  PERSONNES, CATEGORIES, LIGNES_CREDIT, normaliserCategorie,
  COLLECTIONS_REFERENTIELS, chargerLibellesCollection, televerserImage
} from "./firebase-config.js";
import { injecterSidebar, formaterDate, statutReservation } from "./sidebar.js";

injecterSidebar(""); // aucun onglet du menu n'est "actif" sur une fiche produit

const params = new URLSearchParams(window.location.search);
const composantId = params.get("id");

if (!composantId) {
  document.getElementById("zone-fiche").innerHTML = `<div class="etat-vide__titre">Aucun composant spécifié.</div>`;
} else {
  chargerFiche();
}

let COMPOSANT_ACTUEL = null;
let RESERVATIONS_COURANTES = [];
let RESERVATION_A_EDITER = null;
let MEMBRES = [];
let LOCALISATIONS_REFERENTIEL = [];

async function chargerMembres() {
  const snap = await getDocs(collection(db, "membres"));
  MEMBRES = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  const select = document.getElementById("r-personne");
  if (!select) return;
  const valeurs = MEMBRES.map(m => m.nom).filter(Boolean);
  const valeurActuelle = select.value;
  select.innerHTML = `<option value="">— Sélectionner —</option>${valeurs.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}<option value="Invité">Invité</option>`;
  if (valeurActuelle) select.value = valeurActuelle;
}

async function ajouterMembreDepuisReservation() {
  const nom = window.prompt("Nom du nouveau membre :", "");
  if (!nom) return;
  const nomValide = nom.trim();
  if (!nomValide) return;
  try {
    await addDoc(collection(db, "membres"), { nom: nomValide, role: "", statut: "Actif" });
    await chargerMembres();
    const select = document.getElementById("r-personne");
    if (select) select.value = nomValide;
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l’ajout du membre : " + err.message);
  }
}

async function chargerFiche() {
  try {
    const snap = await getDoc(doc(db, "composants", composantId));
    if (!snap.exists()) {
      document.getElementById("zone-fiche").innerHTML = `<div class="etat-vide__titre">Composant introuvable.</div>`;
      return;
    }
    COMPOSANT_ACTUEL = { id: snap.id, ...snap.data(), categorie: normaliserCategorie(snap.data().categorie) };

    const reservations = await chargerReservationsDuComposant();
    RESERVATIONS_COURANTES = reservations;
    rendreFiche(COMPOSANT_ACTUEL, reservations);
  } catch (err) {
    console.error(err);
    document.getElementById("zone-fiche").innerHTML = `
      <div class="etat-vide">
        <div class="etat-vide__titre">Erreur de chargement</div>
        <p>Impossible de charger la fiche : ${escapeHtml(err.message || "Erreur inconnue")}</p>
      </div>`;
  }
}

async function chargerReservationsDuComposant() {
  const q = query(collection(db, "reservations"), where("composantId", "==", composantId));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
}

function getDateFinReservation(reservation) {
  if (reservation?.dateFin) return reservation.dateFin;
  const dateDebut = reservation?.dateDebut;
  const duree = parseInt(reservation?.dureeJours, 10);
  if (!dateDebut || isNaN(duree) || duree < 1) return "";
  const d = new Date(`${dateDebut}T00:00:00`);
  d.setDate(d.getDate() + duree - 1);
  return d.toISOString().split("T")[0];
}

function localiserReservation(reservation) {
  return String(reservation?.localisation || "").trim();
}

function normaliserRepartitionLocalisations(composant) {
  const repartitionBrute = Array.isArray(composant?.localisationsQuantites)
    ? composant.localisationsQuantites
    : [];

  const map = new Map();
  repartitionBrute.forEach(entree => {
    const localisation = String(entree?.localisation || "").trim();
    const quantite = parseInt(entree?.quantite, 10);
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

function rendreRepartitionLocalisationsFiche(composant) {
  const repartition = normaliserRepartitionLocalisations(composant);
  if (repartition.length === 0) return "—";

  return `<div class="repartition-localisations-fiche">${repartition.map(item => `
    <div class="repartition-localisations-fiche__ligne">
      <span class="badge badge-couleur badge-localisation">${escapeHtml(item.localisation)}</span>
      <span class="badge-quantite-localisation">${item.quantite}</span>
    </div>
  `).join("")}</div>`;
}

function calculerDisponibilitesParLocalisation(dateDebut, dateFinCompare, reservationId = "") {
  const repartition = normaliserRepartitionLocalisations(COMPOSANT_ACTUEL);
  const totalParLocalisation = new Map(repartition.map(item => [item.localisation, item.quantite]));
  const reserveParLocalisation = new Map(repartition.map(item => [item.localisation, 0]));

  let reserveSansLocalisation = 0;
  RESERVATIONS_COURANTES
    .filter(r => r.id !== reservationId)
    .filter(r => {
      const finExistante = getDateFinReservation(r) || "9999-12-31";
      return r.dateDebut <= dateFinCompare && finExistante >= dateDebut;
    })
    .forEach(r => {
      const q = parseInt(r.quantite, 10) || 1;
      const localisation = localiserReservation(r);
      if (localisation && reserveParLocalisation.has(localisation)) {
        reserveParLocalisation.set(localisation, (reserveParLocalisation.get(localisation) || 0) + q);
      } else {
        reserveSansLocalisation += q;
      }
    });

  if (reserveSansLocalisation > 0 && repartition.length > 0) {
    const localisationPrincipale = repartition[0].localisation;
    reserveParLocalisation.set(
      localisationPrincipale,
      (reserveParLocalisation.get(localisationPrincipale) || 0) + reserveSansLocalisation
    );
  }

  const disponibilites = new Map();
  totalParLocalisation.forEach((total, localisation) => {
    disponibilites.set(localisation, Math.max(0, total - (reserveParLocalisation.get(localisation) || 0)));
  });

  return { disponibilites, totalParLocalisation };
}

function rafraichirSelectLocalisationReservation(reservation = null) {
  const select = document.getElementById("r-localisation");
  const aide = document.getElementById("r-localisation-aide");
  if (!select) return;

  const dateDebut = document.getElementById("r-date-debut")?.value || new Date().toISOString().split("T")[0];
  const dateFin = document.getElementById("r-date-fin")?.value || "";
  const reservationId = reservation?.id || document.getElementById("r-reservation-id")?.value || "";
  const dateFinCompare = dateFin || "9999-12-31";
  const { disponibilites, totalParLocalisation } = calculerDisponibilitesParLocalisation(dateDebut, dateFinCompare, reservationId);

  const localisations = Array.from(totalParLocalisation.keys());
  const localisationEditee = localiserReservation(reservation);

  if (localisations.length === 0) {
    select.innerHTML = `<option value="">Aucune localisation disponible</option>`;
    select.disabled = true;
    if (aide) aide.textContent = "Aucune localisation exploitable sur ce composant.";
    return;
  }

  let options = `<option value="">— Sélectionner —</option>`;
  options += localisations.map(localisation => {
    const dispo = disponibilites.get(localisation) || 0;
    const total = totalParLocalisation.get(localisation) || 0;
    return `<option value="${escapeAttr(localisation)}">${escapeHtml(localisation)} (${dispo} dispo / ${total})</option>`;
  }).join("");

  if (localisationEditee && !totalParLocalisation.has(localisationEditee)) {
    options += `<option value="${escapeAttr(localisationEditee)}">${escapeHtml(localisationEditee)} (hors répartition actuelle)</option>`;
  }

  select.innerHTML = options;
  select.disabled = false;

  if (localisationEditee) {
    select.value = localisationEditee;
  } else if (localisations.length === 1) {
    select.value = localisations[0];
  }

  if (aide) {
    aide.textContent = "Choisis la localisation depuis laquelle le composant est prélevé.";
  }
}

function rendreFiche(c, reservations) {
  const aujourdhui = new Date().toISOString().split("T")[0];
  const reservationsEnCours = reservations.filter(r => {
    const fin = getDateFinReservation(r) || "9999-12-31";
    return r.dateDebut <= aujourdhui && fin >= aujourdhui;
  });
  const quantiteEnCours = reservationsEnCours.reduce((s, r) => s + (parseInt(r.quantite, 10) || 1), 0);
  const quantiteDisponible = Math.max(0, (c.quantite || 0) - quantiteEnCours);
  const reservationActive = reservationsEnCours[0] || null;
  const estCompletementEmprunte = quantiteDisponible === 0;

  const photoBloc = c.photoUrl
    ? `<img src="${c.photoUrl}" alt="${escapeHtml(c.reference)}">`
    : `<div class="fiche-photo__vide">Pas de photo</div>`;

  const historiqueBloc = reservations.length === 0
    ? ""
    : `
        <div class="fiche-carte">
          <h2>Historique des emprunts de ce composant / cet outil</h2>
          <div class="liste-historique">${reservations.map(r => rendreLigneHistorique(r)).join("")}</div>
        </div>`;

  document.getElementById("zone-fiche").innerHTML = `
    <div class="fiche-titre-zone">
      <div>
        <div class="page-header__eyebrow">${escapeHtml(c.categorie || "Composant")}</div>
        <h1 style="font-size:22px;">${escapeHtml(c.reference)}</h1>
        <div class="page-header__sub">${escapeHtml(c.description)}</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${estCompletementEmprunte ? '<span class="badge badge-emprunte">Complètement emprunté</span>' : quantiteEnCours > 0 ? '<span class="badge badge-emprunte">Partiellement emprunté</span>' : '<span class="badge badge-dispo">Disponible</span>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondaire btn-sm" id="btn-modifier-composant">Modifier</button>
          <button class="btn btn-danger btn-sm" id="btn-supprimer-bdd">Supprimer de la base de données</button>
          <button class="btn btn-primaire" id="btn-ouvrir-reservation" ${estCompletementEmprunte ? "disabled" : ""}>
            Réserver
          </button>
        </div>
      </div>
    </div>
    <div class="fiche-produit">
      <div>
        <div class="fiche-photo">
          ${photoBloc}
        </div>
      </div>

      <div>
        <div class="fiche-carte">
          <h2>Informations générales</h2>
          <div class="grille-attributs">
            <div>
              <div class="attribut__label">Référence produit</div>
              <div class="attribut__valeur mono">${escapeHtml(c.reference)}</div>
            </div>
            <div>
              <div class="attribut__label">Catégorie</div>
              <div class="attribut__valeur">${escapeHtml(c.categorie || "—")}</div>
            </div>
            <div>
              <div class="attribut__label">Quantité en stock</div>
              <div class="attribut__valeur mono">${c.quantite}</div>
            </div>
            <div>
              <div class="attribut__label">Quantité empruntée</div>
              <div class="attribut__valeur mono">${quantiteEnCours} / ${c.quantite}</div>
            </div>
            <div>
              <div class="attribut__label">Quantité disponible</div>
              <div class="attribut__valeur mono">${quantiteDisponible}</div>
            </div>
            <div>
              <div class="attribut__label">Prix unitaire</div>
              <div class="attribut__valeur mono">${c.prix != null ? c.prix.toFixed(2) + " €" : "—"}</div>
            </div>
            <div>
              <div class="attribut__label">Localisation</div>
              <div class="attribut__valeur">${rendreRepartitionLocalisationsFiche(c)}</div>
            </div>
            <div>
              <div class="attribut__label">Numéro de série</div>
              <div class="attribut__valeur mono">${escapeHtml(c.numeroSerie || "—")}</div>
            </div>
            <div>
              <div class="attribut__label">Ligne de crédit / appartenance</div>
              <div class="attribut__valeur">${escapeHtml(c.ligneCredit || "—")}</div>
            </div>
            <div>
              <div class="attribut__label">URL / fiche technique</div>
              <div class="attribut__valeur">${c.url ? `<a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">Ouvrir le lien &#8599;</a>` : "—"}</div>
            </div>
          </div>
          ${c.commentaire ? `
            <div style="margin-top:18px;">
              <div class="attribut__label">Commentaire</div>
              <div class="attribut__valeur">${escapeHtml(c.commentaire)}</div>
            </div>` : ""}
        </div>

        ${reservationActive ? `
        <div class="fiche-carte" style="border-left:3px solid var(--alerte);">
          <h2>Emprunt en cours</h2>
          <div class="grille-attributs">
            <div>
              <div class="attribut__label">Emprunté par</div>
              <div class="attribut__valeur">${escapeHtml(reservationActive.personne)}</div>
            </div>
            <div>
              <div class="attribut__label">Projet</div>
              <div class="attribut__valeur">${escapeHtml(reservationActive.projet || "—")}</div>
            </div>
            <div>
              <div class="attribut__label">Localisation prélevée</div>
              <div class="attribut__valeur">${escapeHtml(reservationActive.localisation || "—")}</div>
            </div>
            <div>
              <div class="attribut__label">Du</div>
              <div class="attribut__valeur">${formaterDate(reservationActive.dateDebut)}</div>
            </div>
            <div>
              <div class="attribut__label">Au</div>
              <div class="attribut__valeur">${formaterDate(getDateFinReservation(reservationActive))}</div>
            </div>
          </div>
        </div>` : ""}

        ${historiqueBloc}
      </div>
    </div>
  `;

  document.getElementById("btn-ouvrir-reservation")?.addEventListener("click", () => ouvrirModaleReservation());
  document.getElementById("btn-modifier-composant")?.addEventListener("click", ouvrirModaleEdition);
  document.getElementById("btn-supprimer-bdd")?.addEventListener("click", supprimerComposantBaseDeDonnees);
  document.querySelectorAll("[data-edit-reservation]").forEach(btn => {
    btn.addEventListener("click", () => ouvrirModaleReservation(RESERVATIONS_COURANTES.find(r => r.id === btn.dataset.editReservation) || null));
  });
  document.querySelectorAll("[data-delete-reservation]").forEach(btn => {
    btn.addEventListener("click", () => supprimerReservation(btn.dataset.deleteReservation));
  });
}

async function supprimerReservation(reservationId) {
  if (!reservationId || !confirm("Supprimer cette réservation ?")) return;

  try {
    await deleteDoc(doc(db, "reservations", reservationId));
    await chargerFiche();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + err.message);
  }
}

async function supprimerComposantBaseDeDonnees() {
  if (!COMPOSANT_ACTUEL) return;

  const confirmation = window.confirm(
    `Supprimer définitivement "${COMPOSANT_ACTUEL.reference}" de la base de données ?\n\nCette action supprimera aussi ses réservations liées.`
  );
  if (!confirmation) return;

  try {
    const reservationsSnap = await getDocs(query(collection(db, "reservations"), where("composantId", "==", COMPOSANT_ACTUEL.id)));
    await Promise.all(reservationsSnap.docs.map(r => deleteDoc(doc(db, "reservations", r.id))));
    await deleteDoc(doc(db, "composants", COMPOSANT_ACTUEL.id));
    window.location.href = "index.html";
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression de la base de données : " + err.message);
  }
}

function rendreLigneHistorique(r) {
  const dateFin = getDateFinReservation(r);
  const statut = statutReservation(r.dateDebut, dateFin, r.dureeJours);
  const labelStatut = { actif: "En cours", passe: "Terminé", futur: "À venir" }[statut];
  return `
    <div class="ligne-historique" style="grid-template-columns:auto 1fr auto auto;">
      <span class="ligne-historique__statut statut-${statut}" title="${labelStatut}"></span>
      <div>
        <div class="ligne-historique__produit">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__meta">${escapeHtml(r.projet || "Aucun projet associé")}${r.localisation ? " · " + escapeHtml(r.localisation) : ""}${r.commentaire ? " · " + escapeHtml(r.commentaire) : ""}</div>
      </div>
      <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(dateFin)}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondaire btn-sm" type="button" data-edit-reservation="${r.id}">Modifier</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete-reservation="${r.id}">Supprimer</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ----------------------------------------------------------
// Modale d'édition et réservation
// ----------------------------------------------------------
function remplirSelectEdition(select, valeurs, valeurSelectionnee = "") {
  select.innerHTML = `<option value="">Sélectionner</option>` + valeurs.map(v => {
    const selected = v === valeurSelectionnee ? " selected" : "";
    return `<option value="${escapeAttr(v)}"${selected}>${escapeHtml(v)}</option>`;
  }).join("");
}

async function initialiserListesReferentiel() {
  const [categories, lignesCredit, localisations] = await Promise.all([
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.categories, CATEGORIES),
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.lignesCredit, LIGNES_CREDIT),
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.localisations, [])
  ]);

  LOCALISATIONS_REFERENTIEL = localisations;

  remplirSelectEdition(document.getElementById("edit-categorie"), categories);
  remplirSelectEdition(document.getElementById("edit-ligne-credit"), lignesCredit);

  return { categories, lignesCredit, localisations };
}

function lignesRepartitionModale() {
  return Array.from(document.querySelectorAll(".repartition-ligne"));
}

function lireRepartitionDepuisModale() {
  const lignes = lignesRepartitionModale();
  if (lignes.length === 0) {
    return { repartition: [], total: 0, erreur: "Ajoutez au moins une localisation." };
  }

  const map = new Map();
  for (const ligne of lignes) {
    const select = ligne.querySelector('[data-repartition-localisation]');
    const inputQte = ligne.querySelector('[data-repartition-quantite]');
    const localisation = String(select?.value || "").trim();
    const quantite = parseInt(inputQte?.value, 10);

    if (!localisation) {
      return { repartition: [], total: 0, erreur: "Sélectionnez une localisation sur chaque ligne." };
    }
    if (isNaN(quantite) || quantite < 1) {
      return { repartition: [], total: 0, erreur: "Chaque quantité de localisation doit être supérieure ou égale à 1." };
    }
    map.set(localisation, (map.get(localisation) || 0) + quantite);
  }

  const repartition = Array.from(map.entries())
    .map(([localisation, quantite]) => ({ localisation, quantite }))
    .sort((a, b) => (b.quantite - a.quantite) || a.localisation.localeCompare(b.localisation));

  const total = repartition.reduce((s, item) => s + item.quantite, 0);
  return { repartition, total, erreur: null };
}

function mettreAJourAideRepartition() {
  const aide = document.getElementById("edit-repartition-aide");
  if (!aide) return;

  const quantiteTotale = parseInt(document.getElementById("edit-quantite").value, 10) || 0;
  const { total, erreur } = lireRepartitionDepuisModale();

  if (erreur) {
    aide.textContent = erreur;
    return;
  }

  if (total === quantiteTotale) {
    aide.textContent = `Répartition valide: ${total} / ${quantiteTotale}.`;
  } else {
    aide.textContent = `Répartition incomplète: ${total} / ${quantiteTotale}.`;
  }
}

function creerLigneRepartition(localisation = "", quantite = 1) {
  const ligne = document.createElement("div");
  ligne.className = "repartition-ligne";

  const options = LOCALISATIONS_REFERENTIEL
    .map(libelle => `<option value="${escapeAttr(libelle)}"${libelle === localisation ? " selected" : ""}>${escapeHtml(libelle)}</option>`)
    .join("");

  ligne.innerHTML = `
    <select data-repartition-localisation>
      <option value="">Sélectionner une localisation</option>
      ${options}
    </select>
    <input type="number" data-repartition-quantite min="1" value="${Math.max(1, parseInt(quantite, 10) || 1)}">
    <button type="button" class="btn btn-secondaire btn-sm" data-repartition-supprimer>Retirer</button>
  `;

  ligne.querySelector('[data-repartition-supprimer]').addEventListener("click", () => {
    ligne.remove();
    if (lignesRepartitionModale().length === 0) {
      ajouterLigneRepartition();
    }
    mettreAJourAideRepartition();
  });

  ligne.querySelector('[data-repartition-localisation]').addEventListener("change", mettreAJourAideRepartition);
  ligne.querySelector('[data-repartition-quantite]').addEventListener("input", mettreAJourAideRepartition);

  return ligne;
}

function ajouterLigneRepartition(localisation = "", quantite = 1) {
  const container = document.getElementById("edit-repartition-localisations");
  if (!container) return;
  container.appendChild(creerLigneRepartition(localisation, quantite));
  mettreAJourAideRepartition();
}

function initialiserRepartitionModale(repartition = []) {
  const container = document.getElementById("edit-repartition-localisations");
  if (!container) return;
  container.innerHTML = "";

  if (repartition.length === 0) {
    ajouterLigneRepartition();
    return;
  }

  repartition.forEach(item => {
    ajouterLigneRepartition(item.localisation, item.quantite);
  });
}

async function chargerLocalisationsReferentielAvecFallback(fallback = []) {
  LOCALISATIONS_REFERENTIEL = await chargerLibellesCollection(COLLECTIONS_REFERENTIELS.localisations, fallback);
}

const modaleEdition = document.getElementById("modale-edition-composant");
const modaleResa = document.getElementById("modale-reservation");
try {
  await initialiserListesReferentiel();
  await chargerMembres();
} catch (err) {
  console.error(err);
}

document.querySelectorAll('[data-fermer-modale="modale-edition-composant"]').forEach(btn => {
  btn.addEventListener("click", () => { modaleEdition.hidden = true; });
});

document.querySelectorAll("[data-ajouter-membre]").forEach(btn => {
  btn.addEventListener("click", ajouterMembreDepuisReservation);
});

document.getElementById("btn-ajouter-localisation")?.addEventListener("click", () => {
  ajouterLigneRepartition();
});

document.getElementById("edit-quantite")?.addEventListener("input", mettreAJourAideRepartition);

document.getElementById("btn-enregistrer-edition").addEventListener("click", async () => {
  const reference = document.getElementById("edit-reference").value.trim();
  const description = document.getElementById("edit-description").value.trim();
  const categorie = document.getElementById("edit-categorie").value;
  const quantite = parseInt(document.getElementById("edit-quantite").value, 10);

  if (!reference || !description || !categorie || isNaN(quantite)) {
    alert("Merci de remplir au minimum : référence, description, catégorie et quantité.");
    return;
  }

  const aujourdhui = new Date().toISOString().split("T")[0];
  const quantiteEnCours = RESERVATIONS_COURANTES
    .filter(r => r.dateDebut <= aujourdhui && (!r.dateFin || r.dateFin >= aujourdhui))
    .reduce((s, r) => s + (parseInt(r.quantite, 10) || 1), 0);

  if (quantite < quantiteEnCours) {
    alert(`Impossible de réduire le stock à ${quantite} car ${quantiteEnCours} unité(s) sont déjà empruntées.`);
    return;
  }

  const btn = document.getElementById("btn-enregistrer-edition");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    let photoUrl = COMPOSANT_ACTUEL?.photoUrl || null;
    const fichierPhoto = document.getElementById("edit-photo").files[0];
    if (fichierPhoto) {
      photoUrl = await televerserImage(fichierPhoto, "images");
    }

    const { repartition, total, erreur } = lireRepartitionDepuisModale();
    if (quantite > 0 && erreur) {
      alert(erreur);
      return;
    }
    if (quantite > 0 && total !== quantite) {
      alert(`La somme des localisations doit être égale à la quantité totale (${total}/${quantite}).`);
      return;
    }

    const localisationPrincipale = repartition[0]?.localisation || "";

    const donnees = {
      reference,
      description,
      categorie: normaliserCategorie(categorie),
      localisation: localisationPrincipale,
      localisationsQuantites: repartition,
      quantite,
      prix: parseFloat(document.getElementById("edit-prix").value) || null,
      numeroSerie: document.getElementById("edit-numero-serie").value.trim(),
      ligneCredit: document.getElementById("edit-ligne-credit").value,
      url: document.getElementById("edit-url").value.trim(),
      commentaire: document.getElementById("edit-commentaire").value.trim(),
      ...(photoUrl ? { photoUrl } : {})
    };

    // Si la quantité totale est 0, supprimer le composant
    if (quantite === 0) {
      await deleteDoc(doc(db, "composants", COMPOSANT_ACTUEL.id));
      window.location.href = "index.html";
    } else {
      await updateDoc(doc(db, "composants", COMPOSANT_ACTUEL.id), donnees);
      modaleEdition.hidden = true;
      await chargerFiche();
    }
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la modification : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
  }
});

async function ouvrirModaleEdition() {
  if (!COMPOSANT_ACTUEL) return;
  document.getElementById("modale-edition-composant-titre").textContent = "Modifier le composant";
  document.getElementById("edit-id").value = COMPOSANT_ACTUEL.id;
  document.getElementById("edit-reference").value = COMPOSANT_ACTUEL.reference || "";
  document.getElementById("edit-description").value = COMPOSANT_ACTUEL.description || "";
  document.getElementById("edit-quantite").value = COMPOSANT_ACTUEL.quantite ?? 0;
  document.getElementById("edit-prix").value = COMPOSANT_ACTUEL.prix ?? "";
  document.getElementById("edit-numero-serie").value = COMPOSANT_ACTUEL.numeroSerie || "";
  document.getElementById("edit-url").value = COMPOSANT_ACTUEL.url || "";
  document.getElementById("edit-commentaire").value = COMPOSANT_ACTUEL.commentaire || "";
  document.getElementById("edit-photo").value = "";
  const repartitionExistante = normaliserRepartitionLocalisations(COMPOSANT_ACTUEL);
  const fallbackLocalisations = [...new Set([
    ...(repartitionExistante.map(item => item.localisation)),
    COMPOSANT_ACTUEL.localisation || ""
  ].filter(Boolean))];

  const [categories, lignesCredit] = await Promise.all([
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.categories, CATEGORIES),
    chargerLibellesCollection(COLLECTIONS_REFERENTIELS.lignesCredit, LIGNES_CREDIT)
  ]);
  await chargerLocalisationsReferentielAvecFallback(fallbackLocalisations);

  remplirSelectEdition(document.getElementById("edit-categorie"), categories, COMPOSANT_ACTUEL.categorie || "");
  remplirSelectEdition(document.getElementById("edit-ligne-credit"), lignesCredit, COMPOSANT_ACTUEL.ligneCredit || "");
  initialiserRepartitionModale(repartitionExistante);
  mettreAJourAideRepartition();
  modaleEdition.hidden = false;
}

async function supprimerQuantiteComposant() {
  if (!COMPOSANT_ACTUEL) return;

  const quantiteActuelle = parseInt(COMPOSANT_ACTUEL.quantite || 0, 10);
  const saisie = window.prompt(`Combien d'unité(s) souhaitez-vous retirer du stock de "${COMPOSANT_ACTUEL.reference}" ?`, "1");
  if (saisie === null) return;

  const quantiteASupprimer = parseInt(saisie, 10);
  if (isNaN(quantiteASupprimer) || quantiteASupprimer < 1) {
    alert("Veuillez saisir une quantité valide.");
    return;
  }
  if (quantiteASupprimer > quantiteActuelle) {
    alert(`La quantité demandée dépasse le stock actuel (${quantiteActuelle}).`);
    return;
  }

  const aujourdhui = new Date().toISOString().split("T")[0];
  const quantiteEnCours = RESERVATIONS_COURANTES
    .filter(r => r.dateDebut <= aujourdhui && (!r.dateFin || r.dateFin >= aujourdhui))
    .reduce((s, r) => s + (parseInt(r.quantite, 10) || 1), 0);

  const nouvelleQuantite = quantiteActuelle - quantiteASupprimer;
  if (nouvelleQuantite < quantiteEnCours) {
    alert(`Impossible : ${quantiteEnCours} unité(s) sont déjà empruntées actuellement.`);
    return;
  }

  const confirmation = window.confirm(`Le stock sera réduit de ${quantiteASupprimer} unité(s). Continuer ?`);
  if (!confirmation) return;

  try {
    if (nouvelleQuantite === 0) {
      // Si la quantité devient 0, supprimer le composant
      await deleteDoc(doc(db, "composants", COMPOSANT_ACTUEL.id));
      window.location.href = "index.html";
    } else {
      await updateDoc(doc(db, "composants", COMPOSANT_ACTUEL.id), { quantite: nouvelleQuantite });
      await chargerFiche();
      alert(`Le stock a été réduit à ${nouvelleQuantite} unité(s).`);
    }
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + err.message);
  }
}

function ouvrirModaleReservation(reservation = null) {
  RESERVATION_A_EDITER = reservation;
  document.getElementById("form-reservation").reset();
  const aujourdhui = new Date().toISOString().split("T")[0];
  document.getElementById("r-reservation-id").value = reservation?.id || "";
  document.getElementById("r-date-debut").value = reservation?.dateDebut || aujourdhui;
  document.getElementById("r-date-fin").value = getDateFinReservation(reservation) || "";
  document.getElementById("r-quantite").value = reservation?.quantite || "1";
  const select = document.getElementById("r-personne");
  if (select) {
    const options = Array.from(select.options).map(o => o.value);
    if (!options.includes(reservation?.personne || "")) {
      const opt = new Option(reservation?.personne || "", reservation?.personne || "");
      select.add(opt);
    }
    select.value = reservation?.personne || "";
  }
  document.getElementById("r-projet").value = reservation?.projet || "";
  document.getElementById("r-commentaire").value = reservation?.commentaire || "";
  rafraichirSelectLocalisationReservation(reservation);
  document.getElementById("modale-reservation-titre").textContent = reservation ? "Modifier l'emprunt" : "Réserver cet élément";
  document.getElementById("btn-confirmer-reservation").textContent = reservation ? "Enregistrer les modifications" : "Confirmer la réservation";
  modaleResa.hidden = false;
}

document.querySelectorAll('[data-fermer-modale="modale-reservation"]').forEach(btn => {
  btn.addEventListener("click", () => {
    RESERVATION_A_EDITER = null;
    modaleResa.hidden = true;
  });
});

document.getElementById("r-date-debut")?.addEventListener("change", () => {
  rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER);
});

document.getElementById("r-date-fin")?.addEventListener("change", () => {
  rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER);
});

document.getElementById("btn-confirmer-reservation").addEventListener("click", async () => {
  if (!COMPOSANT_ACTUEL?.id) {
    alert("Le composant est introuvable. Rechargez la page et réessayez.");
    return;
  }

  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const localisation = (document.getElementById("r-localisation")?.value || "").trim();
  const personne = document.getElementById("r-personne").value;
  const projet = document.getElementById("r-projet").value.trim();
  const commentaire = document.getElementById("r-commentaire").value.trim();
  const reservationId = document.getElementById("r-reservation-id").value;
  const estEdition = Boolean(reservationId);

  if (!dateDebut || !personne || isNaN(quantite) || quantite < 1) {
    alert("Merci de renseigner la date de début, la quantité empruntée et l'emprunteur.");
    return;
  }
  if (dateFin && dateFin < dateDebut) {
    alert("La date de fin doit être postérieure ou égale à la date de début.");
    return;
  }
  if (quantite > (COMPOSANT_ACTUEL.quantite || 0)) {
    alert("La quantité empruntée ne peut pas dépasser la quantité en stock.");
    return;
  }

  const dateFinCompare = dateFin || "9999-12-31";

  const selectLocalisation = document.getElementById("r-localisation");
  if (selectLocalisation && !selectLocalisation.disabled && !localisation) {
    alert("Merci de sélectionner la localisation de prélèvement.");
    return;
  }

  if (selectLocalisation && !selectLocalisation.disabled) {
    const { disponibilites } = calculerDisponibilitesParLocalisation(dateDebut, dateFinCompare, reservationId);
    const quantiteDisponibleLocalisation = disponibilites.get(localisation) || 0;
    if (quantite > quantiteDisponibleLocalisation) {
      alert(`La localisation \"${localisation}\" ne dispose que de ${quantiteDisponibleLocalisation} unité(s) sur la période demandée.`);
      return;
    }
  }

  const quantiteReserveeDansPeriode = RESERVATIONS_COURANTES
    .filter(r => r.id !== reservationId)
    .filter(r => {
      const finExistante = getDateFinReservation(r) || "9999-12-31";
      return r.dateDebut <= dateFinCompare && finExistante >= dateDebut;
    })
    .reduce((sum, r) => sum + (parseInt(r.quantite, 10) || 1), 0);

  if (quantiteReserveeDansPeriode + quantite > (COMPOSANT_ACTUEL.quantite || 0)) {
    alert("Cette réservation dépasse la quantité disponible pour la période sélectionnée.");
    return;
  }

  const btn = document.getElementById("btn-confirmer-reservation");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    const donneesBase = {
      composantId: COMPOSANT_ACTUEL.id,
      composantReference: COMPOSANT_ACTUEL.reference,
      localisation,
      dateDebut,
      quantite,
      personne,
      projet,
      commentaire
    };

    if (estEdition) {
      await updateDoc(doc(db, "reservations", reservationId), {
        ...donneesBase,
        ...(dateFin ? { dateFin } : { dateFin: deleteField() }),
        dureeJours: deleteField()
      });
    } else {
      await addDoc(collection(db, "reservations"), {
        ...donneesBase,
        ...(dateFin ? { dateFin } : {})
      });
    }
    RESERVATION_A_EDITER = null;
    modaleResa.hidden = true;
    await chargerFiche();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l'enregistrement de l'emprunt : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = estEdition ? "Enregistrer les modifications" : "Confirmer la réservation";
  }
});
