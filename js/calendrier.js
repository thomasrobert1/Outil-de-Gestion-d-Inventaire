// ============================================================
// CALENDRIER.JS — Vue mensuelle des réservations
// ============================================================
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, deleteField } from "./firebase-config.js";
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

function localiserReservation(reservation) {
  return String(reservation?.localisation || "").trim();
}

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

  if (map.size === 0) {
    const quantiteFallback = parseInt(composant?.quantite, 10) || 0;
    const localisationFallback = String(composant?.localisation || "Stock principal").trim();
    if (quantiteFallback > 0 && localisationFallback) {
      map.set(localisationFallback, quantiteFallback);
    }
  }

  return Array.from(map.entries())
    .map(([localisation, quantite]) => ({ localisation, quantite }))
    .sort((a, b) => (b.quantite - a.quantite) || a.localisation.localeCompare(b.localisation));
}

function calculerDisponibilitesParLocalisation(composantId, dateDebut, dateFinCompare, reservationId = "") {
  const composant = COMPOSANTS.find(c => c.id === composantId);
  const repartition = normaliserRepartitionLocalisations(composant);

  const totalParLocalisation = new Map(repartition.map(item => [item.localisation, item.quantite]));
  const reserveParLocalisation = new Map(repartition.map(item => [item.localisation, 0]));

  let reserveSansLocalisation = 0;
  TOUTES_RESERVATIONS
    .filter(r => r.id !== reservationId)
    .filter(r => r.composantId === composantId)
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

  const composantId = document.getElementById("r-composant")?.value || reservation?.composantId || "";
  const dateDebut = document.getElementById("r-date-debut")?.value || new Date().toISOString().split("T")[0];
  const dateFinSaisi = document.getElementById("r-date-fin")?.value || "";
  const dureeJours = parseInt(document.getElementById("r-duree")?.value, 10) || 1;
  const dateFinCompare = dateFinSaisi || getDateFinReservation({ dateDebut, dureeJours, dateFin: dateFinSaisi }) || "9999-12-31";
  const reservationId = reservation?.id || RESERVATION_A_EDITER?.id || "";
  const localisationEditee = localiserReservation(reservation || RESERVATION_A_EDITER);

  if (!composantId) {
    select.innerHTML = `<option value="">Sélectionnez d'abord un composant</option>`;
    select.disabled = true;
    if (aide) aide.textContent = "Choisis d'abord le composant pour voir les localisations.";
    return;
  }

  const { disponibilites, totalParLocalisation } = calculerDisponibilitesParLocalisation(composantId, dateDebut, dateFinCompare, reservationId);
  const localisations = Array.from(totalParLocalisation.keys());
  const localisationsPrenables = localisations.filter(localisation => {
    const dispo = disponibilites.get(localisation) || 0;
    return dispo > 0 || localisation === localisationEditee;
  });

  if (localisationsPrenables.length === 0) {
    select.innerHTML = `<option value="">Aucune localisation disponible</option>`;
    select.disabled = true;
    if (aide) aide.textContent = "Aucune localisation n'a de stock disponible sur la période choisie.";
    return;
  }

  let options = `<option value="">— Sélectionner —</option>`;
  options += localisationsPrenables.map(localisation => {
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
  } else if (localisationsPrenables.length === 1) {
    select.value = localisationsPrenables[0];
  }

  if (aide) {
    aide.textContent = "Choisis la localisation depuis laquelle le composant est prélevé.";
  }
}

function normaliserTexteRecherche(valeur) {
  return String(valeur || "").trim().toLowerCase();
}

function libelleComposant(c) {
  return `${c.reference || "Sans référence"} — ${c.description || "Sans description"}`;
}

function trouverComposantDepuisRecherche(texteSaisi) {
  const recherche = normaliserTexteRecherche(texteSaisi);
  if (!recherche) return null;

  const idExact = COMPOSANTS_PAR_LIBELLE.get(recherche);
  if (idExact) return COMPOSANTS.find(c => c.id === idExact) || null;

  const candidats = COMPOSANTS.filter(c => {
    const reference = normaliserTexteRecherche(c.reference || "");
    const description = normaliserTexteRecherche(c.description || "");
    const libelle = normaliserTexteRecherche(libelleComposant(c));
    return reference.includes(recherche) || description.includes(recherche) || libelle.includes(recherche);
  });

  return candidats.length === 1 ? candidats[0] : null;
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
  const composant = trouverComposantDepuisRecherche(texte);
  const id = composant?.id || "";
  inputId.value = id;

  // Quand la recherche donne un résultat unique, on normalise le libellé affiché.
  if (composant) {
    inputRecherche.value = libelleComposant(composant);
  }

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
  MEMBRES = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
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
  if (!r?.dateDebut) return "";
  if (r.dateFin) return r.dateFin;
  const duree = parseInt(r.dureeJours, 10) || 1;
  const dateDebut = new Date(`${r.dateDebut}T00:00:00`);
  dateDebut.setDate(dateDebut.getDate() + duree - 1);
  return dateDebut.toISOString().split("T")[0];
}

function reservationEstDansPeriode(r, dateStr) {
  if (!r?.dateDebut || !dateStr) return false;
  const dateFin = getDateFinReservation(r);
  if (!dateFin) return false;
  return r.dateDebut <= dateStr && dateFin >= dateStr;
}

function referenceReservation(r) {
  if (r?.composantReference) return r.composantReference;
  const composant = COMPOSANTS.find(c => c.id === r?.composantId);
  return composant?.reference || "Composant sans référence";
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
      `<div class="evenement-resa" data-resa-id="${r.id}" title="${escapeAttr(referenceReservation(r))} — ${escapeAttr(r.personne || "")}">
        <div>${escapeHtml(referenceReservation(r))}</div>
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
              <a href="produit.html?id=${r.composantId}">${escapeHtml(referenceReservation(r))}</a>
            </div>
            <div class="ligne-historique__meta">${escapeHtml(r.personne)} ${r.projet ? "· " + escapeHtml(r.projet) : ""}${r.localisation ? " · " + escapeHtml(r.localisation) : ""}</div>
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
  document.getElementById("r-date-fin").value = reservation ? (getDateFinReservation(reservation) || "") : "";
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
  rafraichirSelectLocalisationReservation(reservation);
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
document.getElementById("r-composant-recherche")?.addEventListener("input", () => {
  synchroniserComposantSelectionneDepuisRecherche();
  rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER);
});
document.getElementById("r-composant-recherche")?.addEventListener("change", () => rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER));
document.getElementById("r-composant-recherche")?.addEventListener("blur", () => rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER));
document.getElementById("r-date-debut")?.addEventListener("change", () => rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER));
document.getElementById("r-date-fin")?.addEventListener("change", () => rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER));
document.getElementById("r-duree")?.addEventListener("input", () => rafraichirSelectLocalisationReservation(RESERVATION_A_EDITER));

document.getElementById("btn-nouvelle-reservation")?.addEventListener("click", ouvrirModaleReservation);

document.getElementById("btn-confirmer-reservation").addEventListener("click", async () => {
  const composantId = synchroniserComposantSelectionneDepuisRecherche();
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const dureeJours = parseInt(document.getElementById("r-duree").value, 10);
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const localisation = (document.getElementById("r-localisation")?.value || "").trim();
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

  const selectLocalisation = document.getElementById("r-localisation");
  if (selectLocalisation && !selectLocalisation.disabled && !localisation) {
    alert("Merci de sélectionner la localisation de prélèvement.");
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
  if (selectLocalisation && !selectLocalisation.disabled) {
    const { disponibilites } = calculerDisponibilitesParLocalisation(composantId, dateDebut, dateFinCompare, reservationId);
    const quantiteDisponibleLocalisation = disponibilites.get(localisation) || 0;
    if (quantite > quantiteDisponibleLocalisation) {
      alert(`La localisation \"${localisation}\" ne dispose que de ${quantiteDisponibleLocalisation} unité(s) sur la période demandée.`);
      return;
    }
  }

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
    const donneesBase = {
      composantId,
      composantReference: composant?.reference || "",
      localisation,
      dateDebut,
      dureeJours,
      quantite,
      personne,
      projet,
      commentaire
    };

    if (estEdition) {
      await updateDoc(doc(db, "reservations", reservationId), {
        ...donneesBase,
        ...(dateFin ? { dateFin } : { dateFin: deleteField() })
      });
    } else {
      await addDoc(collection(db, "reservations"), {
        ...donneesBase,
        ...(dateFin ? { dateFin } : {})
      });
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

async function initialiserPageCalendrier() {
  try {
    await chargerComposants();
    await chargerMembres();
    await chargerReservations();
  } catch (err) {
    console.error(err);
    const zone = document.getElementById("zone-calendrier");
    if (zone) {
      zone.innerHTML = `
        <div class="tableau-conteneur">
          <div class="etat-vide">
            <div class="etat-vide__titre">Erreur de chargement</div>
            <p>${escapeHtml(err?.message || "Une erreur est survenue lors du chargement du calendrier.")}</p>
          </div>
        </div>`;
    }
  }
}

await initialiserPageCalendrier();
