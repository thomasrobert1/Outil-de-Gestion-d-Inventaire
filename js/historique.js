// ============================================================
// HISTORIQUE.JS — Liste complète des réservations, filtrable
// ============================================================
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, deleteField } from "./firebase-config.js";
import { injecterSidebar, formaterDate, statutReservation } from "./sidebar.js";

injecterSidebar("historique");

let TOUTES_RESERVATIONS = [];
let COMPOSANTS = [];
let MEMBRES = [];
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
  const dateDebut = document.getElementById("r-date-debut")?.value || "";
  const dateFinCompare = document.getElementById("r-date-fin")?.value || "9999-12-31";
  const reservationId = reservation?.id || RESERVATION_A_EDITER?.id || "";
  const localisationEditee = localiserReservation(reservation || RESERVATION_A_EDITER);

  if (!composantId) {
    select.innerHTML = `<option value="">Sélectionnez d'abord un composant</option>`;
    select.disabled = true;
    if (aide) aide.textContent = "Choisis d'abord le composant pour voir les localisations.";
    return;
  }

  const { disponibilites, totalParLocalisation } = calculerDisponibilitesParLocalisation(composantId, dateDebut || "0001-01-01", dateFinCompare, reservationId);
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

function getDateFinReservation(reservation) {
  if (reservation?.dateFin) return reservation.dateFin;
  const dateDebut = reservation?.dateDebut;
  const duree = parseInt(reservation?.dureeJours, 10);
  if (!dateDebut || isNaN(duree) || duree < 1) return "";
  const d = new Date(`${dateDebut}T00:00:00`);
  d.setDate(d.getDate() + duree - 1);
  return d.toISOString().split("T")[0];
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

function remplirFiltrePersonne() {
  const select = document.getElementById("filtre-personne");
  if (!select) return;
  const valeurs = Array.from(new Set(MEMBRES.map(m => m.nom).filter(Boolean).concat("Invité"))).sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">Toutes les personnes</option>${valeurs.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}`;
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
    const statut = statutReservation(r.dateDebut, getDateFinReservation(r), r.dureeJours);
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
    const dateFin = getDateFinReservation(r);
    const statut = statutReservation(r.dateDebut, dateFin, r.dureeJours);
    return `
      <div class="ligne-historique" style="grid-template-columns:auto 1fr auto auto auto auto;gap:12px;align-items:center;">
        <span class="ligne-historique__statut statut-${statut}" title="${labelStatut[statut]}"></span>
        <div class="ligne-historique__produit">
          <a href="produit.html?id=${r.composantId}">${escapeHtml(r.composantReference)}</a>
          <div class="ligne-historique__meta">${escapeHtml(r.commentaire || "")}</div>
        </div>
        <div class="ligne-historique__projet">${escapeHtml(r.projet || "Aucun projet")}</div>
        <div class="ligne-historique__personne">${escapeHtml(r.personne)}</div>
        <div class="ligne-historique__dates">${formaterDate(r.dateDebut)} &rarr; ${formaterDate(dateFin)}</div>
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
  definirComposantSelectionneParId(reservation.composantId || "");
  document.getElementById("r-date-debut").value = reservation.dateDebut || "";
  document.getElementById("r-date-fin").value = getDateFinReservation(reservation) || "";
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
  rafraichirSelectLocalisationReservation(reservation);
  document.getElementById("modale-reservation-titre").textContent = "Modifier une réservation";
  document.getElementById("btn-confirmer-reservation").textContent = "Enregistrer les modifications";
}

async function enregistrerReservationDepuisHistorique() {
  const reservationId = document.getElementById("r-reservation-id").value;
  const composantId = synchroniserComposantSelectionneDepuisRecherche();
  const dateDebut = document.getElementById("r-date-debut").value;
  const dateFin = document.getElementById("r-date-fin").value;
  const quantite = parseInt(document.getElementById("r-quantite").value, 10);
  const localisation = (document.getElementById("r-localisation")?.value || "").trim();
  const personne = document.getElementById("r-personne").value.trim();
  const projet = document.getElementById("r-projet").value.trim();
  const commentaire = document.getElementById("r-commentaire").value.trim();

  if (!reservationId || !composantId || !dateDebut || !personne || isNaN(quantite) || quantite < 1) {
    alert("Merci de renseigner le composant, la date de début, la quantité et l'emprunteur.");
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

  const dateFinCompare = dateFin || "9999-12-31";
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
    .filter(r => {
      const finExistante = getDateFinReservation(r) || "9999-12-31";
      return r.dateDebut <= dateFinCompare && finExistante >= dateDebut;
    })
    .reduce((sum, r) => sum + (parseInt(r.quantite, 10) || 1), 0);

  if (quantiteReserveeDansPeriode + quantite > (composant.quantite || 0)) {
    alert("Cette réservation dépasse la quantité disponible pour la période sélectionnée.");
    return;
  }

  const btn = document.getElementById("btn-confirmer-reservation");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";

  try {
    await updateDoc(doc(db, "reservations", reservationId), {
      composantId,
      composantReference: composant.reference || "",
      localisation,
      dateDebut,
      ...(dateFin ? { dateFin } : { dateFin: deleteField() }),
      dureeJours: deleteField(),
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

async function initialiserPageHistorique() {
  try {
    await chargerComposants();
    await chargerMembres();
    await chargerHistorique();
  } catch (err) {
    console.error(err);
    const zone = document.getElementById("zone-historique");
    if (zone) {
      zone.innerHTML = `
        <div class="tableau-conteneur">
          <div class="etat-vide">
            <div class="etat-vide__titre">Erreur de chargement</div>
            <p>${escapeHtml(err?.message || "Une erreur est survenue lors du chargement de l'historique.")}</p>
          </div>
        </div>`;
    }
  }
}

await initialiserPageHistorique();
