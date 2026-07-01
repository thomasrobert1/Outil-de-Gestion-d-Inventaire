// ============================================================
// MEMBRES.JS — Liste des personnes pouvant emprunter
// ============================================================
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "./firebase-config.js";
import { injecterSidebar } from "./sidebar.js";

injecterSidebar("membres");

let MEMBRES = [];

async function chargerMembres() {
  const snap = await getDocs(collection(db, "membres"));
  MEMBRES = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nom.localeCompare(b.nom));
  renderMembres();
}

function renderMembres() {
  const zone = document.getElementById("zone-membres");

  if (MEMBRES.length === 0) {
    zone.innerHTML = `
      <div class="etat-vide">
        <div class="etat-vide__titre">Aucun membre enregistré</div>
        <p>Ajoute des personnes ici pour les proposer dans les réservations.</p>
      </div>`;
    return;
  }

  zone.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Nom</th>
          <th>Rôle / service</th>
          <th>Statut</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${MEMBRES.map(m => `
          <tr>
            <td>${escapeHtml(m.nom)}</td>
            <td>${escapeHtml(m.role || "—")}</td>
            <td>${escapeHtml(m.statut || "Actif")}</td>
            <td>
              <button class="btn btn-secondaire btn-sm" data-edit-membre="${m.id}">Modifier</button>
              <button class="btn btn-danger btn-sm" data-delete-membre="${m.id}">Supprimer</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;

  zone.querySelectorAll("[data-edit-membre]").forEach(btn => {
    btn.addEventListener("click", () => ouvrirModaleMembre(MEMBRES.find(m => m.id === btn.dataset.editMembre)));
  });

  zone.querySelectorAll("[data-delete-membre]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce membre ?")) return;
      await deleteDoc(doc(db, "membres", btn.dataset.deleteMembre));
      await chargerMembres();
    });
  });
}

function ouvrirModaleMembre(membre = null) {
  document.getElementById("form-membre").reset();
  document.getElementById("membre-id").value = membre?.id || "";
  document.getElementById("membre-nom").value = membre?.nom || "";
  document.getElementById("membre-role").value = membre?.role || "";
  document.getElementById("membre-statut").value = membre?.statut || "Actif";
  document.getElementById("modale-membre-titre").textContent = membre ? "Modifier un membre" : "Ajouter un membre";
  document.getElementById("modale-membre").hidden = false;
}

async function enregistrerMembre() {
  const nom = document.getElementById("membre-nom").value.trim();
  const role = document.getElementById("membre-role").value.trim();
  const statut = document.getElementById("membre-statut").value;
  const id = document.getElementById("membre-id").value;

  if (!nom) {
    alert("Le nom du membre est obligatoire.");
    return;
  }

  try {
    if (id) {
      await updateDoc(doc(db, "membres", id), { nom, role, statut });
    } else {
      await addDoc(collection(db, "membres"), { nom, role, statut });
    }
    document.getElementById("modale-membre").hidden = true;
    await chargerMembres();
  } catch (err) {
    console.error(err);
    alert("Erreur lors de l’enregistrement du membre : " + err.message);
  }
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

document.getElementById("btn-ajouter-membre").addEventListener("click", () => ouvrirModaleMembre());
document.querySelectorAll('[data-fermer-modale="modale-membre"]').forEach(btn => {
  btn.addEventListener("click", () => { document.getElementById("modale-membre").hidden = true; });
});
document.getElementById("btn-enregistrer-membre").addEventListener("click", enregistrerMembre);

await chargerMembres();
