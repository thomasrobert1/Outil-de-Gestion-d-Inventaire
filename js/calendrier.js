// ============================================================
// CALENDRIER.JS — Vue mensuelle des réservations
// ============================================================
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "./firebase-config.js";
import { injecterSidebar, formaterDate } from "./sidebar.js";

injecterSidebar("calendrier");

const NOMS_MOIS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];
const NOMS_JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let dateAffichee = new Date();
let TOUTES_RESERVATIONS = [];
let COMPOSANTS = [];
let MEMBRES = [];
let dateSelectionnee = null;
let RESERVATION_A_EDITER = null;
let COMPOSANTS_PAR_LIBELLE = new Map();

function normaliserTexteRecherche(valeur) {
  return String(valeur || "").trim().toLowerCase();
}

function libelleComposant(c) {
  return `${c.reference || "Sans référence"} — ${c.description || "Sans description"}`;
}

function definirComposantSelectionneParId(composantId) {
  const inputRecherche = document.getElementById("r-composant-recherche");
  const inputId = document.getElementById("r-composant");
  if (!inputRecherche || !inputId) return;

  inputId.value = composantId || "";
  const composant = COMPOSANTS.find(c => c.id === composantId);
  inputRecherche.value = composant ? libelleComposant(composant) : "";
}

function synchroniserComposantSelectionneDepuisRecherche() {
  const inputRecherche = document.getElementById("r-composant-recherche");
  const inputId = document.getElementById("r-composant");
  if (!inputRecherche || !inputId) return "";

  const texte = inputRecherche.value || "";
  const id = COMPOSANTS_PAR_LIBELLE.get(normaliserTexteRecherche(texte)) || "";
  inputId.value = id;
  return id;
}

async function chargerComposants() {
  const snap = await getDocs(collection(db, "composants"));
  COMPOSANTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  COMPOSANTS_PAR_LIBELLE = new Map();

  const datalist = document.getElementById("r-composants-liste");
  if (!datalist) return;

  datalist.innerHTML = COMPOSANTS.map(c => {
    const libelle = libelleComposant(c);
    COMPOSANTS_PAR_LIBELLE.set(normaliserTexteRecherche(libelle), c.id);
    return `<option value="${escapeAttr(libelle)}"></option>`;
  }).join("");
}

async function chargerReservations() {
  const snap = await getDocs(collection(db, "reservations"));
  TOUTES_RESERVATIONS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rendreCalendrier();
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

function getDateFinReservation(r) {
  if (r.dateFin) return r.dateFin;
  const duree = parseInt(r.dureeJours, 10) || 1;
  const dateDebut = new Date(`${r.dateDebut}T00:00:00`);
  dateDebut.setDate(dateDebut.getDate() + duree - 1);
  return dateDebut.toISOString().split("T")[0];
}

function reservationEstDansPeriode(r, dateStr) {
  return r.dateDebut <= dateStr && getDateFinReservation(r) >= dateStr;
}

function rendreCalendrier() {
  const annee = dateAffichee.getFullYear();
  const mois = dateAffichee.getMonth();

  document.getElementById("mois-titre").textContent = `${NOMS_MOIS[mois]} ${annee}`;

  const premierJourMois = new Date(annee, mois, 1);
  // Lundi = 0 ... Dimanche = 6
  const decalage = (premierJourMois.getDay() + 6) % 7;
  const nbJoursMois = new Date(annee, mois + 1, 0).getDate();
  const nbJoursMoisPrecedent = new Date(annee, mois, 0).getDate();

  const aujourdhuiStr = new Date().toISOString().split("T")[0];

  let cases = [];

  // Jours du mois précédent (grisés)
  for (let i = decalage - 1; i >= 0; i--) {
    cases.push({ numero: nbJoursMoisPrecedent - i, horsMois: true, dateStr: null });
  }
  // Jours du mois actuel
  for (let j = 1; j <= nbJoursMois; j++) {
    const dateStr = `${annee}-${String(mois + 1).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
    cases.push({ numero: j, horsMois: false, dateStr });
  }
  // Complète jusqu'à un multiple de 7
  let j = 1;
  while (cases.length % 7 !== 0) {
    cases.push({ numero: j++, horsMois: true, dateStr: null });
  }

  const entetesJours = NOMS_JOURS.map(j => `<div class="jour-entete">${j}</div>`).join("");

  const casesHtml = cases.map(c => {
    if (c.horsMois) {
      return `<div class="jour-case hors-mois"><div class="jour-case__numero">${c.numero}</div></div>`;
    }
    const estAujourdhui = c.dateStr === aujourdhuiStr;
    const resasDuJour = TOUTES_RESERVATIONS.filter(r => reservationEstDansPeriode(r, c.dateStr));
    const evenementsHtml = resasDuJour.slice(0, 3).map(r =>
      `<div class="evenement-resa" data-resa-id="${r.id}" title="${escapeAttr(r.composantReference)} — ${escapeAttr(r.personne)}">
        <div>${escapeHtml(r.composantReference)}</div>
        <div class="evenement-resa__personne">${escapeHtml(r.personne)}</div>
      </div>`
    ).join("");
    const plusHtml = resasDuJour.length > 3
      ? `<div class="texte-discret" style="font-size:10px;">+${resasDuJour.length - 3} autre(s)</div>` : "";

    return `
      <div class="jour-case ${estAujourdhui ? "aujourdhui" : ""}" data-date="${c.dateStr}">
        <div class="jour-case__numero">${c.numero}</div>
        ${evenementsHtml}
        ${plusHtml}
      </div>`;
  }).join("");

  document.getElementById("zone-calendrier").innerHTML = `
    <div class="grille-calendrier">
      ${entetesJours}
      ${casesHtml}
    </div>
  `;

  // Clic sur une case = détail du jour
  document.querySelectorAll(".jour-case[data-date]").forEach(el => {
    el.addEventListener("click", () => ouvrirDetailJour(el.dataset.date));
  });
}

async function supprimerReservation(reservationId) {
  if (!reservationId || !confirm("Supprimer cette réservation ?")) return;

  try {
    await deleteDoc(doc(db, "reservations", reservationId));
    await chargerReservations();
    document.getElementById("modale-jour").hidden = true;
    document.getElementById("modale-reservation").hidden = true;
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + err.message);
  }
}

function ouvrirDetailJour(dateStr) {
  dateSelectionnee = dateStr;
  const resasDuJour = TOUTES_RESERVATIONS.filter(r => reservationEstDansPeriode(r, dateStr));
  document.getElementById("modale-jour-titre").textContent = formaterDate(dateStr);

  const corps = resasDuJour.length === 0
    ? `<p class="texte-discret">Aucune réservation ce jour-là.</p>`
    : `<div class="liste-historique">${resasDuJour.map(r => `
        <div class="ligne-historique" style="grid-template-columns:1fr auto auto;gap:12px;align-items:center;">
          <div>
            <div class="ligne-historique__produit">
              <a href="produit.html?id=${r.composantId}">${escapeHtml(r.composantReference)}</a>
            </div>
            <div class="ligne-historique__meta">${escapeHtml(r.personne)} ${r.projet ? "· " + escapeHtml(r.projet) : ""}</div>
          </div>
          <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(getDateFinReservation(r))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn btn-secondaire btn-sm" type="button" data-edit-reservation="${r.id}">Modifier</button>
            <button class="btn btn-danger btn-sm" type="button" data-delete-reservation="${r.id}">Supprimer</button>
          </div>
        </div>
      `).join("")}</div>`;

  const boutonAjout = `<button class="btn btn-primaire btn-sm" id="btn-ajouter-reservation-jour" style="margin-top:12px;">Ajouter une réservation</button>`;
  document.getElementById("modale-jour-corps").innerHTML = `${corps}${boutonAjout}`;
  document.getElementById("btn-ajouter-reservation-jour")?.addEventListener("click", () => {
    document.getElementById("modale-jour").hidden = true;
    ouvrirModaleReservation();
  });
  document.querySelectorAll("[data-edit-reservation]").forEach(btn => {
    btn.addEventListener("click", () => {
      const resa = TOUTES_RESERVATIONS.find(r => r.id === btn.dataset.editReservation);
      document.getElementById("modale-jour").hidden = true;
      ouvrirModaleReservation(resa);
    });
  });
  document.querySelectorAll("[data-delete-reservation]").forEach(btn => {
    btn.addEventListener("click", () => supprimerReservation(btn.dataset.deleteReservation));
  });
  document.getElementById("modale-jour").hidden = false;
}

function ouvrirModaleReservation(reservation = null) {
  RESERVATION_A_EDITER = reservation;
  document.getElementById("form-reservation").reset();
  const aujourdHui = new Date().toISOString().split("T")[0];
  definirComposantSelectionneParId(reservation?.composantId || "");
  document.getElementById("r-date-debut").value = reservation?.dateDebut || dateSelectionnee || aujourdHui;
  document.getElementById("r-date-fin").value = reservation?.dateFin || "";
  document.getElementById("r-duree").value = reservation?.dureeJours || "1";
  document.getElementById("r-quantite").value = reservation?.quantite || "1";
  const selectPersonne = document.getElementById("r-personne");
  if (selectPersonne) {
    const options = Array.from(selectPersonne.options).map(o => o.value);
    if (!options.includes(reservation?.personne || "")) {
      const opt = new Option(reservation?.personne || "", reservation?.personne || "");
      selectPersonne.add(opt);
    }
    selectPersonne.value = reservation?.personne || "";
  }
  document.getElementById("r-projet").value = reservation?.projet || "";
  document.getElementById("r-commentaire").value = reservation?.commentaire || "";
  document.querySelector("#modale-reservation .modale__header h3").textContent = reservation ? "Modifier une réservation" : "Créer une réservation";
  document.getElementById("btn-confirmer-reservation").textContent = reservation ? "Enregistrer les modifications" : "Enregistrer la réservation";
  document.getElementById("modale-reservation").hidden = false;
}

document.querySelectorAll('[data-fermer-modale="modale-jour"]').forEach(btn => {
  btn.addEventListener("click", () => { document.getElementById("modale-jour").hidden = true; });
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

document.getElementById("r-composant-recherche")?.addEventListener("change", synchroniserComposantSelectionneDepuisRecherche);
document.getElementById("r-composant-recherche")?.addEventListener("blur", synchroniserComposantSelectionneDepuisRecherche);

document.getElementById("btn-nouvelle-reservation")?.addEventListener("click", ouvrirModaleReservation);

document.getElementById("btn-confirmer-reservation").addEventListener("click", async () => {
  const composantId = synchroniserComposantSelectionneDepuisRecherche();
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const dureeJours = parseInt(document.getElementById("r-duree").value, 10);
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const personne = document.getElementById("r-personne").value.trim();
  const projet = document.getElementById("r-projet").value.trim();
  const commentaire = document.getElementById("r-commentaire").value.trim();
  const reservationId = RESERVATION_A_EDITER?.id || "";
  const estEdition = Boolean(reservationId);

  if (!composantId || !dateDebut || !dureeJours || !personne || isNaN(quantite) || quantite < 1) {
    alert("Merci de renseigner le composant, la date de début, la durée, la quantité empruntée et le nom de l'emprunteur.");
    return;
  }

  if (dateFin && dateFin < dateDebut) {
    alert("La date de fin doit être postérieure ou égale à la date de début.");
    return;
  }

  const composant = COMPOSANTS.find(c => c.id === composantId);
  if (!composant) {
    alert("Le composant sélectionné est introuvable.");
    return;
  }
  if (quantite > (composant.quantite || 0)) {
    alert("La quantité empruntée ne peut pas dépasser la quantité en stock.");
    return;
  }

  const dateFinCompare = dateFin || getDateFinReservation({ dateDebut, dureeJours, dateFin });
  const quantiteReserveeDansPeriode = TOUTES_RESERVATIONS
    .filter(r => r.id !== reservationId)
    .filter(r => r.composantId === composantId)
    .filter(r => reservationEstDansPeriode(r, dateDebut) || reservationEstDansPeriode(r, dateFinCompare) || (r.dateDebut <= dateFinCompare && getDateFinReservation(r) >= dateDebut))
    .reduce((sum, r) => sum + (parseInt(r.quantite, 10) || 1), 0);

  if (quantiteReserveeDansPeriode + quantite > (composant.quantite || 0)) {
    alert("Cette réservation dépasse la quantité disponible pour la période sélectionnée.");
    return;
  }

  const btn = document.getElementById("btn-confirmer-reservation");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    const donnees = {
      composantId,
      composantReference: composant?.reference || "",
      dateDebut,
      ...(dateFin ? { dateFin } : {}),
      dureeJours,
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
    document.getElementById("modale-reservation").hidden = true;
    await chargerReservations();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l'enregistrement : " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = estEdition ? "Enregistrer les modifications" : "Enregistrer la réservation";
  }
});

document.getElementById("btn-mois-precedent").addEventListener("click", () => {
  dateAffichee = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth() - 1, 1);
  rendreCalendrier();
});
document.getElementById("btn-mois-suivant").addEventListener("click", () => {
  dateAffichee = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth() + 1, 1);
  rendreCalendrier();
});
document.getElementById("btn-aujourdhui").addEventListener("click", () => {
  dateAffichee = new Date();
  rendreCalendrier();
});

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

await chargerComposants();
await chargerMembres();
await chargerReservations();
