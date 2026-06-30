// ============================================================
// COMPOSANT SIDEBAR PARTAGÉ
// Injecte le menu de navigation gauche identique sur chaque page.
// ============================================================

export function injecterSidebar(pageActive) {
  const liens = [
    {
      id: "inventaire",
      href: "index.html",
      label: "Inventaire",
      icone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
    },
    {
      id: "calendrier",
      href: "calendrier.html",
      label: "Calendrier",
      icone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`
    },
    {
      id: "historique",
      href: "historique.html",
      label: "Historique",
      icone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></svg>`
    }
  ];

  const nav = liens.map(l => `
    <a href="${l.href}" class="sidebar__link ${l.id === pageActive ? 'actif' : ''}">
      ${l.icone}
      <span>${l.label}</span>
    </a>
  `).join("");

  const html = `
    <aside class="sidebar">
      <div class="sidebar__brand">
        <div class="sidebar__brand-mark">Gestion technique</div>
        <div class="sidebar__brand-title">Inventaire Atelier</div>
      </div>
      <nav class="sidebar__nav">${nav}</nav>
      <div class="sidebar__footer">Synchronisé en temps réel</div>
    </aside>
  `;

  document.getElementById("sidebar-zone").outerHTML = html;
}

// Formatte une date ISO (YYYY-MM-DD) en format lisible français
export function formaterDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formaterDateCourte(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Détermine si une réservation est active, passée ou future par rapport à aujourd'hui
export function statutReservation(dateDebut, dateFin) {
  const aujourdhui = new Date().toISOString().split("T")[0];
  const fin = dateFin || null;
  if (fin && fin < aujourdhui) return "passe";
  if (dateDebut > aujourdhui) return "futur";
  return "actif";
}
