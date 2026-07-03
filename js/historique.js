// ============================================================
// HISTORIQUE.JS — Liste complète des réservations, filtrable
// ============================================================
import { db, collection, getDocs, updateDoc, deleteDoc, doc } from "./firebase-config.js";
import { injecterSidebar, formaterDate, statutReservation } from "./sidebar.js";

injecterSidebar("historique");

let TOUTES_RESERVATIONS = [];
let COMPOSANTS = [];
let MEMBRES = [];
let RESERVATION_A_EDITER = null;

function remplirFiltrePersonne() {
  const select = document.getElementById("filtre-personne");
  if (!select) return;
  const valeurs = Array.from(new Set(MEMBRES.map(m => m.nom).filter(Boolean).concat("Invité"))).sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">Toutes les personnes</option>${valeurs.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}`;
}

async function chargerComposants() {
  const snap = await getDocs(collection(db, "composants"));
  COMPOSANTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const select = document.getElementById("r-composant");
  if (!select) return;
  select.innerHTML = `<option value="">— Sélectionner —</option>${COMPOSANTS.map(c => `
    <option value="${escapeAttr(c.id)}">${escapeHtml(c.reference || "Sans référence")} — ${escapeHtml(c.description || "Sans description")}</option>
  `).join("")}`;
}

async function chargerMembres() {
  const snap = await getDocs(collection(db, "membres"));
  MEMBRES = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nom.localeCompare(b.nom));
  const select = document.getElementById("r-personne");
  if (!select) return;
  const valeurs = MEMBRES.map(m => m.nom).filter(Boolean);
  const valeurActuelle = select.value;
  select.innerHTML = `<option value="">— Sélectionner —</option>${valeurs.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}<option value="Invité">Invité</option>`;
  if (valeurActuelle) select.value = valeurActuelle;
  remplirFiltrePersonne();
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

async function chargerHistorique() {
  const snap = await getDocs(collection(db, "reservations"));
  TOUTES_RESERVATIONS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  appliquerFiltresEtAfficher();
}

function appliquerFiltresEtAfficher() {
  const recherche = document.getElementById("filtre-recherche").value.toLowerCase().trim();
  const statutVoulu = document.getElementById("filtre-statut").value;
  const personne = document.getElementById("filtre-personne").value;
  const tri = document.getElementById("filtre-tri").value;

  let resultats = TOUTES_RESERVATIONS.filter(r => {
    const statut = statutReservation(r.dateDebut, r.dateFin);
    if (statutVoulu && statut !== statutVoulu) return false;
    if (personne && r.personne !== personne) return false;
    if (recherche) {
      const cible = `${r.composantReference} ${r.projet || ""} ${r.personne} ${r.commentaire || ""}`.toLowerCase();
      if (!cible.includes(recherche)) return false;
    }
    return true;
  });

  resultats.sort((a, b) => tri === "ancien"
    ? a.dateDebut.localeCompare(b.dateDebut)
    : b.dateDebut.localeCompare(a.dateDebut)
  );

  document.getElementById("compteur-resultats").textContent =
    `${resultats.length} réservation${resultats.length > 1 ? "s" : ""} affichée${resultats.length > 1 ? "s" : ""} sur ${TOUTES_RESERVATIONS.length}`;

  const zone = document.getElementById("zone-historique");

  if (resultats.length === 0) {
    zone.innerHTML = `
      <div class="tableau-conteneur">
        <div class="etat-vide">
          <div class="etat-vide__titre">Aucune réservation trouvée</div>
          <p>Ajuste les filtres, ou réserve un composant depuis sa fiche produit.</p>
        </div>
      </div>`;
    return;
  }

  const labelStatut = { actif: "En cours", passe: "Terminé", futur: "À venir" };

  zone.innerHTML = `<div class="liste-historique">${resultats.map(r => {
    const statut = statutReservation(r.dateDebut, r.dateFin);
    return `
      <div class="ligne-historique" style="grid-template-columns:auto 1fr auto auto auto auto;gap:12px;align-items:center;">
        <span class="ligne-historique__statut statut-${statut}" title="${labelStatut[statut]}"></span>
        <div class="ligne-historique__produit">
          <a href="produit.html?id=${r.composantId}">${escapeHtml(r.composantReference)}</a>
          <div class="ligne-historique__meta">${escapeHtml(r.commentaire || "")}</div>
        </div>
        <div class="ligne-historique__projet">${escapeHtml(r.projet || "Aucun projet")}</div>
        <div class="ligne-historique__personne">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(r.dateFin)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn btn-secondaire btn-sm" type="button" data-edit-reservation="${r.id}">Modifier</button>
          <button class="btn btn-danger btn-sm" type="button" data-delete-reservation="${r.id}">Supprimer</button>
        </div>
      </div>
    `;
  }).join("")}</div>`;

  zone.querySelectorAll("[data-edit-reservation]").forEach(btn => {
    btn.addEventListener("click", () => ouvrirModaleEditionReservation(TOUTES_RESERVATIONS.find(r => r.id === btn.dataset.editReservation)));
  });
  zone.querySelectorAll("[data-delete-reservation]").forEach(btn => {
    btn.addEventListener("click", () => supprimerReservation(btn.dataset.deleteReservation));
  });
}

async function supprimerReservation(reservationId) {
  if (!reservationId || !confirm("Supprimer cette réservation ?")) return;

  try {
    await deleteDoc(doc(db, "reservations", reservationId));
    await chargerHistorique();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + err.message);
  }
}

function ouvrirModaleEditionReservation(reservation) {
  if (!reservation) return;
  RESERVATION_A_EDITER = reservation;
  document.getElementById("modale-reservation").hidden = false;
  document.getElementById("r-reservation-id").value = reservation.id;
  document.getElementById("r-composant").value = reservation.composantId || "";
  document.getElementById("r-date-debut").value = reservation.dateDebut || "";
  document.getElementById("r-date-fin").value = reservation.dateFin || "";
  document.getElementById("r-quantite").value = reservation.quantite || "1";
  const selectPersonne = document.getElementById("r-personne");
  if (selectPersonne) {
    const options = Array.from(selectPersonne.options).map(o => o.value);
    if (!options.includes(reservation.personne || "")) {
      const opt = new Option(reservation.personne || "", reservation.personne || "");
      selectPersonne.add(opt);
    }
    selectPersonne.value = reservation.personne || "";
  }
  document.getElementById("r-projet").value = reservation.projet || "";
  document.getElementById("r-commentaire").value = reservation.commentaire || "";
  document.getElementById("modale-reservation-titre").textContent = "Modifier une réservation";
  document.getElementById("btn-confirmer-reservation").textContent = "Enregistrer les modifications";
}

async function enregistrerReservationDepuisHistorique() {
  const reservationId = document.getElementById("r-reservation-id").value;
  const composantId = document.getElementById("r-composant").value;
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const personne = document.getElementById("r-personne").value.trim();
  const projet = document.getElementById("r-projet").value.trim();
  const commentaire = document.getElementById("r-commentaire").value.trim();

  if (!reservationId || !composantId || !dateDebut || !personne || isNaN(quantite) || quantite < 1) {
    alert("Merci de renseigner le composant, la date de début, la quantité et l'emprunteur.");
    return;
  }

  const btn = document.getElementById("btn-confirmer-reservation");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    await updateDoc(doc(db, "reservations", reservationId), {
      composantId,
      dateDebut,
      ...(dateFin ? { dateFin } : {}),
      quantite,
      personne,
      projet,
      commentaire
    });
    RESERVATION_A_EDITER = null;
    document.getElementById("modale-reservation").hidden = true;
    await chargerHistorique();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la modification : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer les modifications";
  }
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

["filtre-recherche", "filtre-statut", "filtre-personne", "filtre-tri"].forEach(id => {
  document.getElementById(id).addEventListener("input", appliquerFiltresEtAfficher);
  document.getElementById(id).addEventListener("change", appliquerFiltresEtAfficher);
});

document.querySelectorAll('[data-fermer-modale="modale-reservation"]').forEach(btn => {
  btn.addEventListener("click", () => {
    RESERVATION_A_EDITER = null;
    document.getElementById("modale-reservation").hidden = true;
  });
});

document.querySelectorAll("[data-ajouter-membre]").forEach(btn => {
  btn.addEventListener("click", ajouterMembreDepuisReservation);
});

document.getElementById("btn-confirmer-reservation").addEventListener("click", enregistrerReservationDepuisHistorique);

await chargerComposants();
await chargerMembres();
await chargerHistorique();
}
