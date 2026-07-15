// ============================================================
// GESTION.JS — Administration des membres et référentiels
// ============================================================
import {
  db,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  CATEGORIES,
  LIGNES_CREDIT,
  COLLECTIONS_REFERENTIELS,
  chargerDocumentsCollection
} from "./firebase-config.js";
import { injecterSidebar } from "./sidebar.js";

injecterSidebar("membres");

const CONFIGS = [
  {
    key: "membres",
    titre: "Membres",
    description: "Personnes autorisées à emprunter du matériel.",
    collection: COLLECTIONS_REFERENTIELS.membres,
    fields: [
      { name: "nom", label: "Nom complet", type: "text", required: true, placeholder: "Ex. Jean Dupont" },
      { name: "role", label: "Rôle / service", type: "text", placeholder: "Ex. Atelier, maintenance…" },
      { name: "statut", label: "Statut", type: "select", options: ["Actif", "Invité"] }
    ],
    columns: ["Nom", "Rôle / service", "Statut"],
    emptyText: "Aucun membre enregistré"
  },
  {
    key: "categories",
    titre: "Catégories",
    description: "Catégories proposées dans les formulaires des composants.",
    collection: COLLECTIONS_REFERENTIELS.categories,
    fields: [
      { name: "libelle", label: "Libellé", type: "text", required: true, placeholder: "Ex. Composants électroniques" }
    ],
    columns: ["Libellé"],
    emptyText: "Aucune catégorie enregistrée"
  },
  {
    key: "localisations",
    titre: "Localisations",
    description: "Localisations utilisées dans l'inventaire.",
    collection: COLLECTIONS_REFERENTIELS.localisations,
    fields: [
      { name: "libelle", label: "Libellé", type: "text", required: true, placeholder: "Ex. Étagère A1" }
    ],
    columns: ["Libellé"],
    emptyText: "Aucune localisation enregistrée"
  },
  {
    key: "lignesCredit",
    titre: "Lignes de crédit",
    description: "Lignes de crédit proposées lors de la création d'un composant.",
    collection: COLLECTIONS_REFERENTIELS.lignesCredit,
    fields: [
      { name: "libelle", label: "Libellé", type: "text", required: true, placeholder: "Ex. Atelier général" }
    ],
    columns: ["Libellé"],
    emptyText: "Aucune ligne de crédit enregistrée"
  }
];

const ETATS = Object.fromEntries(CONFIGS.map(config => [config.key, { items: [], editionId: "" }]));

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function normaliserValeurEntree(config, item) {
  if (config.key === "membres") {
    return {
      nom: item.nom || "",
      role: item.role || "",
      statut: item.statut || "Actif"
    };
  }

  return { libelle: item.libelle || item.nom || item.label || "" };
}

function trierItems(config, items) {
  const cle = config.key === "membres" ? "nom" : "libelle";
  return [...items].sort((a, b) => (a[cle] || "").localeCompare(b[cle] || ""));
}

async function initialiserReferentielsParDefaut() {
  const [categoriesExistantes, localisationsExistantes, lignesExistantes, composantsSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS_REFERENTIELS.categories)),
    getDocs(collection(db, COLLECTIONS_REFERENTIELS.localisations)),
    getDocs(collection(db, COLLECTIONS_REFERENTIELS.lignesCredit)),
    getDocs(collection(db, "composants"))
  ]);

  if (categoriesExistantes.empty) {
    await Promise.all(CATEGORIES.map(libelle => addDoc(collection(db, COLLECTIONS_REFERENTIELS.categories), { libelle })));
  }

  if (lignesExistantes.empty) {
    await Promise.all(LIGNES_CREDIT.map(libelle => addDoc(collection(db, COLLECTIONS_REFERENTIELS.lignesCredit), { libelle })));
  }

  if (localisationsExistantes.empty) {
    const localisations = [...new Set(composantsSnap.docs.flatMap(d => {
      const data = d.data();
      const depuisRepartition = Array.isArray(data.localisationsQuantites)
        ? data.localisationsQuantites.map(item => item?.localisation).filter(Boolean)
        : [];
      if (depuisRepartition.length > 0) return depuisRepartition;
      return data.localisation ? [data.localisation] : [];
    }))].sort((a, b) => a.localeCompare(b));
    if (localisations.length > 0) {
      await Promise.all(localisations.map(libelle => addDoc(collection(db, COLLECTIONS_REFERENTIELS.localisations), { libelle })));
    }
  }
}

async function chargerDonnees() {
  const zone = document.getElementById("zone-gestion");
  if (!zone) {
    console.error("Impossible de charger la gestion: l'élément #zone-gestion est introuvable.");
    return;
  }

  try {
    await initialiserReferentielsParDefaut();

    const resultats = await Promise.all(CONFIGS.map(async config => {
      const items = await chargerDocumentsCollection(config.collection);
      return { key: config.key, items: trierItems(config, items) };
    }));

    resultats.forEach(resultat => {
      ETATS[resultat.key].items = resultat.items;
    });

    rendreGestion();
  } catch (err) {
    console.error(err);
    zone.innerHTML = `<div class="tableau-conteneur"><div class="etat-vide"><div class="etat-vide__titre">Erreur de chargement</div><p>Impossible de charger la gestion : ${escapeHtml(err.message || "Erreur inconnue")}</p></div></div>`;
  }
}

function rendreGestion() {
  const zone = document.getElementById("zone-gestion");
  if (!zone) return;
  zone.innerHTML = CONFIGS.map(config => rendreSection(config)).join("");

  const cibleDepuisHash = window.location.hash.replace("#", "");
  if (cibleDepuisHash) {
    const element = document.getElementById(cibleDepuisHash);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  CONFIGS.forEach(config => {
    const form = document.querySelector(`[data-form="${config.key}"]`);
    form?.addEventListener("submit", event => {
      event.preventDefault();
      enregistrerElement(config.key);
    });

    document.querySelectorAll(`[data-edit="${config.key}"]`).forEach(btn => {
      btn.addEventListener("click", () => commencerEdition(config.key, btn.dataset.id));
    });

    document.querySelectorAll(`[data-delete="${config.key}"]`).forEach(btn => {
      btn.addEventListener("click", () => supprimerElement(config.key, btn.dataset.id));
    });

    document.querySelectorAll(`[data-cancel="${config.key}"]`).forEach(btn => {
      btn.addEventListener("click", () => annulerEdition(config.key));
    });
  });
}

function rendreSection(config) {
  const etat = ETATS[config.key];
  const itemEdition = etat.editionId ? etat.items.find(item => item.id === etat.editionId) : null;
  const formValues = normaliserValeurEntree(config, itemEdition || {});

  return `
    <section class="fiche-carte gestion-section" id="gestion-${config.key}">
      <div class="gestion-section__head">
        <div>
          <h2 class="gestion-section__title">${escapeHtml(config.titre)}</h2>
          <div class="texte-discret">${escapeHtml(config.description)}</div>
        </div>
        <span class="badge badge-dispo">${etat.items.length}</span>
      </div>

      <form data-form="${config.key}" class="gestion-form">
        <input type="hidden" id="${config.key}-id" value="${escapeAttr(etat.editionId)}">
        <div class="grille-attributs">
          ${config.fields.map(field => rendreChamp(config.key, field, formValues)).join("")}
        </div>
        <div class="gestion-form__actions">
          <button class="btn btn-primaire" type="submit">${etat.editionId ? "Mettre à jour" : "Ajouter"}</button>
          ${etat.editionId ? `<button class="btn btn-secondaire" type="button" data-cancel="${config.key}">Annuler</button>` : ""}
        </div>
      </form>

      <div class="tableau-conteneur gestion-table-wrap">
        ${etat.items.length === 0 ? `<div class="etat-vide"><div class="etat-vide__titre">${escapeHtml(config.emptyText)}</div></div>` : rendreTable(config, etat.items)}
      </div>
    </section>
  `;
}

function rendreChamp(prefixe, field, valeurs) {
  const id = `${prefixe}-${field.name}`;
  const valeur = valeurs[field.name] || "";
  if (field.type === "select") {
    return `
      <div class="champ">
        <label for="${id}">${escapeHtml(field.label)}</label>
        <select id="${id}" ${field.required ? "required" : ""}>
          ${field.options.map(option => `<option value="${escapeAttr(option)}"${option === valeur ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  return `
    <div class="champ">
      <label for="${id}">${escapeHtml(field.label)}</label>
      <input type="text" id="${id}" value="${escapeAttr(valeur)}" ${field.required ? "required" : ""} placeholder="${escapeAttr(field.placeholder || "")}">
    </div>
  `;
}

function rendreTable(config, items) {
  const rows = items.map(item => {
    if (config.key === "membres") {
      return `
        <tr>
          <td>${escapeHtml(item.nom || "—")}</td>
          <td>${escapeHtml(item.role || "—")}</td>
          <td>${escapeHtml(item.statut || "Actif")}</td>
          <td>
            <button class="btn btn-secondaire btn-sm" type="button" data-edit="${config.key}" data-id="${escapeAttr(item.id)}">Modifier</button>
            <button class="btn btn-danger btn-sm" type="button" data-delete="${config.key}" data-id="${escapeAttr(item.id)}">Supprimer</button>
          </td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${escapeHtml(item.libelle || item.nom || item.label || "—")}</td>
        <td>
          <button class="btn btn-secondaire btn-sm" type="button" data-edit="${config.key}" data-id="${escapeAttr(item.id)}">Modifier</button>
          <button class="btn btn-danger btn-sm" type="button" data-delete="${config.key}" data-id="${escapeAttr(item.id)}">Supprimer</button>
        </td>
      </tr>
    `;
  }).join("");

  const header = config.key === "membres"
    ? `<tr><th>Nom</th><th>Rôle / service</th><th>Statut</th><th></th></tr>`
    : `<tr><th>Libellé</th><th></th></tr>`;

  return `
    <table>
      <thead>${header}</thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function commencerEdition(cle, id) {
  ETATS[cle].editionId = id;
  rendreGestion();
  const config = CONFIGS.find(c => c.key === cle);
  const item = ETATS[cle].items.find(x => x.id === id);
  if (!config || !item) return;

  config.fields.forEach(field => {
    const input = document.getElementById(`${cle}-${field.name}`);
    if (input) {
      input.value = item[field.name] || item.libelle || item.nom || "";
    }
  });
}

function annulerEdition(cle) {
  ETATS[cle].editionId = "";
  rendreGestion();
}

async function enregistrerElement(cle) {
  const config = CONFIGS.find(c => c.key === cle);
  if (!config) return;

  const editionId = document.getElementById(`${cle}-id`).value;
  let donnees;

  if (cle === "membres") {
    const nom = document.getElementById(`${cle}-nom`).value.trim();
    const role = document.getElementById(`${cle}-role`).value.trim();
    const statut = document.getElementById(`${cle}-statut`).value;
    if (!nom) {
      alert("Le nom du membre est obligatoire.");
      return;
    }
    donnees = { nom, role, statut };
  } else {
    const libelle = document.getElementById(`${cle}-libelle`).value.trim();
    if (!libelle) {
      alert("Le libellé est obligatoire.");
      return;
    }
    donnees = { libelle };
  }

  try {
    if (editionId) {
      await updateDoc(doc(db, config.collection, editionId), donnees);
    } else {
      await addDoc(collection(db, config.collection), donnees);
    }
    ETATS[cle].editionId = "";
    await chargerDonnees();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l’enregistrement : " + err.message);
  }
}

async function supprimerElement(cle, id) {
  const config = CONFIGS.find(c => c.key === cle);
  if (!config || !id) return;
  if (!confirm(`Supprimer cet élément de ${config.titre.toLowerCase()} ?`)) return;

  try {
    await deleteDoc(doc(db, config.collection, id));
    if (ETATS[cle].editionId === id) ETATS[cle].editionId = "";
    await chargerDonnees();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + err.message);
  }
}

await chargerDonnees();
