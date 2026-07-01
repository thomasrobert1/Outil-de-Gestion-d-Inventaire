// ============================================================
// PRODUIT.JS — Fiche détaillée d'un composant + réservations
// ============================================================
import {
  db, storage, doc, getDoc, updateDoc, deleteDoc, collection, addDoc,
  getDocs, query, where, orderBy, ref, uploadBytes, getDownloadURL,
  PERSONNES, CATEGORIES, LIGNES_CREDIT
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

async function chargerMembres() {
  const snap = await getDocs(collection(db, "membres"));
  MEMBRES = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nom.localeCompare(b.nom));
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
  const snap = await getDoc(doc(db, "composants", composantId));
  if (!snap.exists()) {
    document.getElementById("zone-fiche").innerHTML = `<div class="etat-vide__titre">Composant introuvable.</div>`;
    return;
  }
  COMPOSANT_ACTUEL = { id: snap.id, ...snap.data() };

  const reservations = await chargerReservationsDuComposant();
  RESERVATIONS_COURANTES = reservations;
  rendreFiche(COMPOSANT_ACTUEL, reservations);
}

async function chargerReservationsDuComposant() {
  const q = query(collection(db, "reservations"), where("composantId", "==", composantId));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
}

function rendreFiche(c, reservations) {
  const aujourdhui = new Date().toISOString().split("T")[0];
  const reservationsEnCours = reservations.filter(r => r.dateDebut <= aujourdhui && (!r.dateFin || r.dateFin >= aujourdhui));
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
          <button class="btn btn-danger btn-sm" id="btn-supprimer-composant">Supprimer</button>
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
              <div class="attribut__valeur">${escapeHtml(c.localisation || "—")}</div>
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
              <div class="attribut__label">Du</div>
              <div class="attribut__valeur">${formaterDate(reservationActive.dateDebut)}</div>
            </div>
            <div>
              <div class="attribut__label">Au</div>
              <div class="attribut__valeur">${formaterDate(reservationActive.dateFin)}</div>
            </div>
          </div>
        </div>` : ""}

        ${historiqueBloc}
      </div>
    </div>
  `;

  document.getElementById("btn-ouvrir-reservation")?.addEventListener("click", () => ouvrirModaleReservation());
  document.getElementById("btn-modifier-composant")?.addEventListener("click", ouvrirModaleEdition);
  document.getElementById("btn-supprimer-composant")?.addEventListener("click", supprimerQuantiteComposant);
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

function rendreLigneHistorique(r) {
  const statut = statutReservation(r.dateDebut, r.dateFin);
  const labelStatut = { actif: "En cours", passe: "Terminé", futur: "À venir" }[statut];
  return `
    <div class="ligne-historique" style="grid-template-columns:auto 1fr auto auto;">
      <span class="ligne-historique__statut statut-${statut}" title="${labelStatut}"></span>
      <div>
        <div class="ligne-historique__produit">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__meta">${escapeHtml(r.projet || "Aucun projet associé")}${r.commentaire ? " · " + escapeHtml(r.commentaire) : ""}</div>
      </div>
      <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(r.dateFin)}</div>
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

const modaleEdition = document.getElementById("modale-edition-composant");
const modaleResa = document.getElementById("modale-reservation");
await chargerMembres();

remplirSelectEdition(document.getElementById("edit-categorie"), CATEGORIES);
remplirSelectEdition(document.getElementById("edit-ligne-credit"), LIGNES_CREDIT);

document.querySelectorAll('[data-fermer-modale="modale-edition-composant"]').forEach(btn => {
  btn.addEventListener("click", () => { modaleEdition.hidden = true; });
});

document.querySelectorAll("[data-ajouter-membre]").forEach(btn => {
  btn.addEventListener("click", ajouterMembreDepuisReservation);
});

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
      const cheminStockage = `images/${Date.now()}_${fichierPhoto.name}`;
      const storageRef = ref(storage, cheminStockage);
      await uploadBytes(storageRef, fichierPhoto);
      photoUrl = await getDownloadURL(storageRef);
    }

    const donnees = {
      reference,
      description,
      categorie,
      localisation: document.getElementById("edit-localisation").value.trim(),
      quantite,
      prix: parseFloat(document.getElementById("edit-prix").value) || null,
      numeroSerie: document.getElementById("edit-numero-serie").value.trim(),
      ligneCredit: document.getElementById("edit-ligne-credit").value,
      url: document.getElementById("edit-url").value.trim(),
      commentaire: document.getElementById("edit-commentaire").value.trim(),
      ...(photoUrl ? { photoUrl } : {})
    };

    await updateDoc(doc(db, "composants", COMPOSANT_ACTUEL.id), donnees);
    modaleEdition.hidden = true;
    await chargerFiche();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la modification : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
  }
});

function ouvrirModaleEdition() {
  if (!COMPOSANT_ACTUEL) return;
  document.getElementById("modale-edition-composant-titre").textContent = "Modifier le composant";
  document.getElementById("edit-id").value = COMPOSANT_ACTUEL.id;
  document.getElementById("edit-reference").value = COMPOSANT_ACTUEL.reference || "";
  document.getElementById("edit-description").value = COMPOSANT_ACTUEL.description || "";
  document.getElementById("edit-localisation").value = COMPOSANT_ACTUEL.localisation || "";
  document.getElementById("edit-quantite").value = COMPOSANT_ACTUEL.quantite ?? 0;
  document.getElementById("edit-prix").value = COMPOSANT_ACTUEL.prix ?? "";
  document.getElementById("edit-numero-serie").value = COMPOSANT_ACTUEL.numeroSerie || "";
  document.getElementById("edit-url").value = COMPOSANT_ACTUEL.url || "";
  document.getElementById("edit-commentaire").value = COMPOSANT_ACTUEL.commentaire || "";
  document.getElementById("edit-photo").value = "";
  remplirSelectEdition(document.getElementById("edit-categorie"), CATEGORIES, COMPOSANT_ACTUEL.categorie || "");
  remplirSelectEdition(document.getElementById("edit-ligne-credit"), LIGNES_CREDIT, COMPOSANT_ACTUEL.ligneCredit || "");
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
    await updateDoc(doc(db, "composants", COMPOSANT_ACTUEL.id), { quantite: nouvelleQuantite });
    await chargerFiche();
    alert(nouvelleQuantite === 0 ? "Le stock a été vidé." : `Le stock a été réduit à ${nouvelleQuantite} unité(s).`);
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
  document.getElementById("r-date-fin").value = reservation?.dateFin || "";
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

document.getElementById("btn-confirmer-reservation").addEventListener("click", async () => {
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
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
  const quantiteReserveeDansPeriode = RESERVATIONS_COURANTES
    .filter(r => r.id !== reservationId)
    .filter(r => r.dateDebut <= dateFinCompare && ((r.dateFin || "9999-12-31") >= dateDebut))
    .reduce((sum, r) => sum + (parseInt(r.quantite, 10) || 1), 0);

  if (quantiteReserveeDansPeriode + quantite > (COMPOSANT_ACTUEL.quantite || 0)) {
    alert("Cette réservation dépasse la quantité disponible pour la période sélectionnée.");
    return;
  }

  const btn = document.getElementById("btn-confirmer-reservation");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    const donnees = {
      composantId,
      composantReference: COMPOSANT_ACTUEL.reference,
      dateDebut,
      ...(dateFin ? { dateFin } : {}),
      quantite,
      personne,
      projet,
      commentaire
    };

    if (estEdition) {
      await updateDoc(doc(db, "reservations", reservationId), donnees);
    } else {
      await addDoc(collection(db, "reservations"), donnees);
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
