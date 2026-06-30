// ============================================================
// PRODUIT.JS — Fiche détaillée d'un composant + réservations
// ============================================================
import {
  db, storage, doc, getDoc, updateDoc, collection, addDoc,
  getDocs, query, where, orderBy, ref, uploadBytes, getDownloadURL,
  PERSONNES
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

  const lignesHistorique = reservations.length === 0
    ? `<p class="texte-discret">Aucune réservation enregistrée pour cet élément.</p>`
    : `<div class="liste-historique">${reservations.map(r => rendreLigneHistorique(r)).join("")}</div>`;

  document.getElementById("zone-fiche").innerHTML = `
    <div class="fiche-titre-zone">
      <div>
        <div class="page-header__eyebrow">${escapeHtml(c.categorie || "Composant")}</div>
        <h1 style="font-size:22px;">${escapeHtml(c.reference)}</h1>
        <div class="page-header__sub">${escapeHtml(c.description)}</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        ${estCompletementEmprunte ? '<span class="badge badge-emprunte">Complètement emprunté</span>' : quantiteEnCours > 0 ? '<span class="badge badge-emprunte">Partiellement emprunté</span>' : '<span class="badge badge-dispo">Disponible</span>'}
        <button class="btn btn-primaire" id="btn-ouvrir-reservation" ${estCompletementEmprunte ? "disabled" : ""}>
          Réserver
        </button>
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

        <div class="fiche-carte">
          <h2>Historique des emprunts</h2>
          ${lignesHistorique}
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-ouvrir-reservation")?.addEventListener("click", ouvrirModaleReservation);
}

function rendreLigneHistorique(r) {
  const statut = statutReservation(r.dateDebut, r.dateFin);
  const labelStatut = { actif: "En cours", passe: "Terminé", futur: "À venir" }[statut];
  return `
    <div class="ligne-historique" style="grid-template-columns:auto 1fr auto;">
      <span class="ligne-historique__statut statut-${statut}" title="${labelStatut}"></span>
      <div>
        <div class="ligne-historique__produit">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__meta">${escapeHtml(r.projet || "Aucun projet associé")}${r.commentaire ? " · " + escapeHtml(r.commentaire) : ""}</div>
      </div>
      <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(r.dateFin)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ----------------------------------------------------------
// Modale de réservation
// ----------------------------------------------------------
const modaleResa = document.getElementById("modale-reservation");
const selectPersonne = document.getElementById("r-personne");
PERSONNES.forEach(p => {
  const opt = document.createElement("option");
  opt.value = p; opt.textContent = p;
  selectPersonne.appendChild(opt);
});

function ouvrirModaleReservation() {
  document.getElementById("form-reservation").reset();
  const aujourdhui = new Date().toISOString().split("T")[0];
  document.getElementById("r-date-debut").value = aujourdhui;
  document.getElementById("r-date-fin").value = "";
  document.getElementById("r-quantite").value = "1";
  modaleResa.hidden = false;
}

document.querySelectorAll('[data-fermer-modale="modale-reservation"]').forEach(btn => {
  btn.addEventListener("click", () => { modaleResa.hidden = true; });
});

document.getElementById("btn-confirmer-reservation").addEventListener("click", async () => {
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const personne = document.getElementById("r-personne").value;
  const projet = document.getElementById("r-projet").value.trim();
  const commentaire = document.getElementById("r-commentaire").value.trim();

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
    await addDoc(collection(db, "reservations"), {
      composantId,
      composantReference: COMPOSANT_ACTUEL.reference,
      dateDebut,
      ...(dateFin ? { dateFin } : {}),
      quantite,
      personne,
      projet,
      commentaire
    });
    modaleResa.hidden = true;
    await chargerFiche();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la réservation : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmer la réservation";
  }
});
