// ============================================================
// HISTORIQUE.JS — Liste complète des réservations, filtrable
// ============================================================
import { db, collection, getDocs, PERSONNES } from "./firebase-config.js";
import { injecterSidebar, formaterDate, statutReservation } from "./sidebar.js";

injecterSidebar("historique");

let TOUTES_RESERVATIONS = [];

const selectPersonne = document.getElementById("filtre-personne");
PERSONNES.forEach(p => {
  const opt = document.createElement("option");
  opt.value = p; opt.textContent = p;
  selectPersonne.appendChild(opt);
});

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
      <div class="ligne-historique">
        <span class="ligne-historique__statut statut-${statut}" title="${labelStatut[statut]}"></span>
        <div class="ligne-historique__produit">
          <a href="produit.html?id=${r.composantId}">${escapeHtml(r.composantReference)}</a>
          <div class="ligne-historique__meta">${escapeHtml(r.commentaire || "")}</div>
        </div>
        <div class="ligne-historique__projet">${escapeHtml(r.projet || "Aucun projet")}</div>
        <div class="ligne-historique__personne">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(r.dateFin)}</div>
      </div>
    `;
  }).join("")}</div>`;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

["filtre-recherche", "filtre-statut", "filtre-personne", "filtre-tri"].forEach(id => {
  document.getElementById(id).addEventListener("input", appliquerFiltresEtAfficher);
  document.getElementById(id).addEventListener("change", appliquerFiltresEtAfficher);
});

chargerHistorique();
