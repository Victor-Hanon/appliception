/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PARSER
   Extracts numbered ideas from brainstorm markdown files.
   Handles formats:
     "N. Title"              (plain)
     "**N. Title**"          (bold)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function parseMarkdown(rawText, weekLabel) {
  const text  = rawText.replace(/\r/g, '');
  const lines = text.split('\n');
  const ideas = [];
  let i = 0;

  // Noise lines to skip inside descriptions
  const isNoise = (l) =>
    /^\d{2}:\d{2}$/.test(l) ||
    /^(Session du |Excavated|Identified|Brainstormed|Inventoried|Pivoted|---$)/.test(l) ||
    /^(Mes |Mon |Ce qui |L'idée |On a |On continue|On creuse|Alors|Allez|Inarrê|Bon,|Voici|En att|Avant|Salut|Dis-moi|Q\s*:|R\s*:)/.test(l);

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    // Match: optional **, then digit(s), period, space, title, optional **
    const m = line.match(/^\*{0,2}(\d{1,3})\.\s+\*{0,2}([^*\n]+?)\*{0,2}\s*$/);

    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 200) {
        i++;
        // Skip blank lines before description
        while (i < lines.length && !lines[i].trim()) i++;

        // Collect description until first blank line (= end of paragraph)
        const descParts = [];
        while (i < lines.length) {
          const l = lines[i].trim();
          if (!l) break;
          // Stop if we hit the next numbered idea
          if (l.match(/^\*{0,2}\d{1,3}\.\s+/)) break;
          if (!isNoise(l)) {
            descParts.push(l.replace(/\*{1,2}/g, '').trim());
          }
          i++;
        }

        ideas.push({
          id:    weekLabel + '::' + num,
          num,
          title: m[2].replace(/\*{1,2}/g, '').trim(),
          desc:  descParts.join(' '),
          week:  weekLabel,
        });
        continue;
      }
    }
    i++;
  }

  return ideas.sort((a, b) => a.num - b.num);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STORAGE
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const SK_IDEAS    = 'bs2_ideas';
const SK_STATUSES = 'bs2_statuses';
const SK_EXPANDED = 'bs2_expanded';

function load() {
  try {
    return {
      ideas:    JSON.parse(localStorage.getItem(SK_IDEAS)    || '[]'),
      statuses: JSON.parse(localStorage.getItem(SK_STATUSES) || '{}'),
      expanded: new Set(JSON.parse(localStorage.getItem(SK_EXPANDED) || '[]')),
    };
  } catch { return { ideas: [], statuses: {}, expanded: new Set() }; }
}
function saveIdeas(v)    { localStorage.setItem(SK_IDEAS,    JSON.stringify(v)); }
function saveStatuses(v) { localStorage.setItem(SK_STATUSES, JSON.stringify(v)); }
function saveExpanded(s) { localStorage.setItem(SK_EXPANDED, JSON.stringify([...s])); }

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function weekStats(ideas, statuses, week) {
  const list = week === 'all' ? ideas : ideas.filter(i => i.week === week);
  const count = (s) => list.filter(i => statuses[i.id] === s).length;
  return { total: list.length, starred: count('starred'), done: count('done'), skip: count('skip') };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   APP
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
class App {
  constructor() {
    const s       = load();
    this.ideas    = s.ideas;
    this.statuses = s.statuses;
    this.expanded = s.expanded;
    this.filter   = 'all';   // all | pending | starred | done | skip
    this.search   = '';
    this.week     = 'all';
    this.dragging = false;

    this._render();
    this._bind();
  }

  /* ── Derived ── */
  get weeks() { return [...new Set(this.ideas.map(i => i.week))]; }

  get filtered() {
    let list = this.ideas;
    if (this.week !== 'all') list = list.filter(i => i.week === this.week);
    if (this.filter === 'pending')
      list = list.filter(i => !this.statuses[i.id] || this.statuses[i.id] === 'pending');
    else if (this.filter !== 'all')
      list = list.filter(i => this.statuses[i.id] === this.filter);
    if (this.search) {
      const q = this.search.toLowerCase();
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.desc.toLowerCase().includes(q)  ||
        String(i.num).includes(q)
      );
    }
    return list;
  }

  /* ── Status toggle ── */
  setStatus(id, status) {
    if (this.statuses[id] === status) delete this.statuses[id];
    else this.statuses[id] = status;
    saveStatuses(this.statuses);
    this._updateCard(id);
    this._updateSidebar();
    this._updateProgress();
  }

  /* ── Expand toggle ── */
  toggleExpand(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    saveExpanded(this.expanded);
    this._updateCardExpand(id);
  }

  /* ── File loading ── */
  async loadFiles(files) {
    for (const file of files) {
      const text      = await file.text();
      const weekLabel = file.name.replace(/\.(md|txt)$/i, '');
      this.ideas = this.ideas.filter(i => i.week !== weekLabel);
      this.ideas.push(...parseMarkdown(text, weekLabel));
    }
    this.ideas.sort((a, b) => a.week.localeCompare(b.week) || a.num - b.num);
    saveIdeas(this.ideas);
    if (files.length) this.week = files[files.length - 1].name.replace(/\.(md|txt)$/i, '');
    this._render();
  }

  /* ━━ SURGICAL UPDATES (no full re-render) ━━ */

  _updateCard(id) {
    const cardEl = document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    const idea   = this.ideas.find(i => i.id === id);
    if (!idea) return;
    const status = this.statuses[id] || 'pending';
    cardEl.className = `card s-${status}`;

    // Dot
    const dot = cardEl.querySelector('.card-status-dot');
    if (dot) dot.className = `card-status-dot s-${status}`;

    // Action buttons
    cardEl.querySelectorAll('.act-btn').forEach(btn => {
      const t = btn.dataset.type;
      btn.classList.toggle('on', status === t);
    });
  }

  _updateCardExpand(id) {
    const cardEl = document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    const open  = this.expanded.has(id);
    const desc  = cardEl.querySelector('.card-desc');
    const arrow = cardEl.querySelector('.card-toggle-arrow');
    const fade  = cardEl.querySelector('.card-desc-fade');
    const label = cardEl.querySelector('.card-toggle-label');
    if (desc)  desc.classList.toggle('open', open);
    if (arrow) arrow.classList.toggle('open', open);
    if (fade)  fade.style.opacity = open ? '0' : '1';
    if (label) label.textContent  = open ? 'Réduire' : 'Voir tout';
  }

  _updateSidebar() {
    this.weeks.forEach(w => {
      const btn = document.querySelector(`[data-week-btn="${CSS.escape(w)}"]`);
      if (!btn) return;
      const s   = weekStats(this.ideas, this.statuses, w);
      const meta = btn.querySelector('.week-meta');
      if (meta) meta.innerHTML = this._weekMetaHtml(s);
    });
    // All
    const allBtn = document.querySelector('[data-week-btn="all"]');
    if (allBtn) {
      const s = weekStats(this.ideas, this.statuses, 'all');
      const meta = allBtn.querySelector('.week-meta');
      if (meta) meta.innerHTML = this._weekMetaHtml(s);
    }
  }

  _updateProgress() {
    const s    = weekStats(this.ideas, this.statuses, 'all');
    const done = s.starred + s.done + s.skip;
    const pct  = s.total ? Math.round(done / s.total * 100) : 0;
    const fill = document.querySelector('.progress-fill');
    const txt  = document.querySelector('.progress-txt');
    if (fill) fill.style.width = pct + '%';
    if (txt)  txt.textContent  = `${done}/${s.total} triées`;
  }

  /* ━━ FULL RENDER ━━ */
  _render() {
    const root = document.getElementById('root');

    // Save scroll + focus before re-render
    const mainEl    = root.querySelector('.main');
    const scroll    = mainEl?.scrollTop || 0;
    const wasSearch = document.activeElement?.id === 'search';
    const selStart  = document.activeElement?.selectionStart;
    const selEnd    = document.activeElement?.selectionEnd;

    root.innerHTML = this._html();

    // Restore scroll + focus
    const newMain = root.querySelector('.main');
    if (newMain && scroll) newMain.scrollTop = scroll;
    if (wasSearch) {
      const el = document.getElementById('search');
      if (el) { el.focus(); el.setSelectionRange(selStart, selEnd); }
    }
  }

  /* ━━ HTML BUILDERS ━━ */
  _weekMetaHtml(s) {
    const pend = s.total - s.starred - s.done - s.skip;
    return `
      <span class="week-meta-item" title="En attente">${pend} en attente</span>
      ${s.starred ? `<span class="week-meta-item" title="Intéressantes" style="color:var(--star)">★${s.starred}</span>` : ''}
      ${s.done    ? `<span class="week-meta-item" title="Retenues"       style="color:var(--done)">✓${s.done}</span>`    : ''}
      ${s.skip    ? `<span class="week-meta-item" title="Passées"        style="color:var(--skip)">✗${s.skip}</span>`    : ''}
    `;
  }

  _html() {
    const { filter, search, week, dragging } = this;
    const ideas    = this.ideas;
    const weeks    = this.weeks;
    const filtered = this.filtered;
    const allStats = weekStats(ideas, this.statuses, 'all');
    const triaged  = allStats.starred + allStats.done + allStats.skip;
    const pct      = allStats.total ? Math.round(triaged / allStats.total * 100) : 0;

    const sidebarWeeks = weeks.map(w => {
      const s = weekStats(ideas, this.statuses, w);
      return `
        <button class="week-btn ${week === w ? 'active' : ''}" data-week-btn="${esc(w)}" data-action="week" data-val="${esc(w)}">
          <div class="week-name">${esc(w)}</div>
          <div class="week-meta">${this._weekMetaHtml(s)}</div>
        </button>
      `;
    }).join('');

    const filterDefs = [
      { id: 'all',     label: 'Toutes',         cls: 'f-all'  },
      { id: 'pending', label: '· Non triées',    cls: 'f-pend' },
      { id: 'starred', label: '★ Intéressantes', cls: 'f-star' },
      { id: 'done',    label: '✓ Retenues',      cls: 'f-done' },
      { id: 'skip',    label: '✗ Passées',       cls: 'f-skip' },
    ];

    const cards = filtered.map(idea => {
      const status = this.statuses[idea.id] || 'pending';
      const open   = this.expanded.has(idea.id);
      const hasDesc = idea.desc.length > 0;
      return `
        <div class="card s-${status}" data-card-id="${esc(idea.id)}">
          <div class="card-top">
            <div class="card-meta">
              <span class="card-num">#${String(idea.num).padStart(2,'0')}</span>
              ${weeks.length > 1 ? `<span class="card-week-tag">${esc(idea.week)}</span>` : ''}
              <span class="card-status-dot s-${status}" style="margin-left:auto"></span>
            </div>
            <div class="card-title">${esc(idea.title)}</div>
          </div>
          ${hasDesc ? `
            <div class="card-desc-wrap">
              <div class="card-desc ${open ? 'open' : ''}" data-action="expand" data-id="${esc(idea.id)}">${esc(idea.desc)}</div>
              <div class="card-desc-fade" style="opacity:${open ? 0 : 1}"></div>
            </div>
            <button class="card-toggle" data-action="expand" data-id="${esc(idea.id)}">
              <span class="card-toggle-arrow ${open ? 'open' : ''}">▼</span>
              <span class="card-toggle-label">${open ? 'Réduire' : 'Voir tout'}</span>
            </button>
          ` : ''}
          <div class="card-actions">
            <button class="act-btn t-star ${status === 'starred' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="starred">
              ★ Intéressante
            </button>
            <button class="act-btn t-done ${status === 'done' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="done">
              ✓ Retenir
            </button>
            <button class="act-btn t-skip ${status === 'skip' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="skip">
              ✗ Passer
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      ${dragging ? `<div class="drop-overlay"><span>Déposer le fichier .md</span><p>Vos idées seront chargées automatiquement</p></div>` : ''}

      <div class="header">
        <div class="header-logo">
          Appliception
          <span>${allStats.total} idées</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="progress-txt">${triaged}/${allStats.total} triées</span>
        </div>
        <button class="btn btn-white" data-action="load">+ Charger .md</button>
      </div>

      <div class="layout">
        <div class="sidebar">
          ${weeks.length > 0 ? `
            <div class="sidebar-label">Sessions</div>
            <button class="week-btn ${week === 'all' ? 'active' : ''}" data-week-btn="all" data-action="week" data-val="all">
              <div class="week-name">Toutes les sessions</div>
              <div class="week-meta">${this._weekMetaHtml(allStats)}</div>
            </button>
            ${sidebarWeeks}
          ` : `
            <div class="sidebar-label">Sessions</div>
            <div class="sidebar-empty">
              Chargez un fichier <strong>.md</strong> pour commencer,<br>
              ou glissez-le directement ici.
            </div>
          `}
        </div>

        <div class="main">
          <div class="filters">
            ${filterDefs.map(f => `
              <button class="filter-btn ${f.cls} ${filter === f.id ? 'active' : ''}" data-action="filter" data-val="${f.id}">
                ${f.label}
              </button>
            `).join('')}
            <input id="search" class="search" type="text"
              placeholder="Rechercher une idée..." value="${esc(search)}" />
            <span class="result-count">${filtered.length} idée${filtered.length > 1 ? 's' : ''}</span>
          </div>

          ${filtered.length === 0 ? `
            <div class="empty">
              ${ideas.length === 0 ? `
                <div class="empty-icon">🧠</div>
                <h2>Prêt pour le brainstorm ?</h2>
                <p>Chargez votre fichier <strong>idées.md</strong> pour voir toutes vos idées organisées ici.</p>
                <button class="btn btn-accent" data-action="load">+ Charger un fichier .md</button>
              ` : `
                <div class="empty-icon">🔍</div>
                <h2>Aucun résultat</h2>
                <p>Essayez de modifier vos filtres ou votre recherche.</p>
              `}
            </div>
          ` : `
            <div class="grid">${cards}</div>
          `}
        </div>
      </div>
    `;
  }

  /* ━━ EVENT BINDING ━━ */
  _bind() {
    const root = document.getElementById('root');

    // Delegated clicks
    root.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const { action, val, id, type } = el.dataset;

      if (action === 'load')   { document.getElementById('fileInput').click(); return; }
      if (action === 'week')   { this.week   = val; this._render(); return; }
      if (action === 'filter') { this.filter = val; this._render(); return; }
      if (action === 'status') { this.setStatus(id, type); return; }
      if (action === 'expand') { this.toggleExpand(id); return; }
    });

    // Search input (surgical: only re-render cards)
    root.addEventListener('input', e => {
      if (e.target.id !== 'search') return;
      this.search = e.target.value;
      // Re-render grid + count only
      const gridWrap = root.querySelector('.main > :last-child');
      const countEl  = root.querySelector('.result-count');
      const filtered = this.filtered;
      if (countEl) countEl.textContent = `${filtered.length} idée${filtered.length > 1 ? 's' : ''}`;
      if (gridWrap) {
        if (filtered.length === 0) {
          gridWrap.outerHTML = `
            <div class="empty">
              <div class="empty-icon">🔍</div>
              <h2>Aucun résultat</h2>
              <p>Essayez de modifier vos filtres ou votre recherche.</p>
            </div>`;
        } else {
          const cards = filtered.map(idea => {
            const status = this.statuses[idea.id] || 'pending';
            const open   = this.expanded.has(idea.id);
            const hasDesc = idea.desc.length > 0;
            return `
              <div class="card s-${status}" data-card-id="${esc(idea.id)}">
                <div class="card-top">
                  <div class="card-meta">
                    <span class="card-num">#${String(idea.num).padStart(2,'0')}</span>
                    ${this.weeks.length > 1 ? `<span class="card-week-tag">${esc(idea.week)}</span>` : ''}
                    <span class="card-status-dot s-${status}" style="margin-left:auto"></span>
                  </div>
                  <div class="card-title">${esc(idea.title)}</div>
                </div>
                ${hasDesc ? `
                  <div class="card-desc-wrap">
                    <div class="card-desc ${open ? 'open' : ''}" data-action="expand" data-id="${esc(idea.id)}">${esc(idea.desc)}</div>
                    <div class="card-desc-fade" style="opacity:${open ? 0 : 1}"></div>
                  </div>
                  <button class="card-toggle" data-action="expand" data-id="${esc(idea.id)}">
                    <span class="card-toggle-arrow ${open ? 'open' : ''}">▼</span>
                    <span class="card-toggle-label">${open ? 'Réduire' : 'Voir tout'}</span>
                  </button>
                ` : ''}
                <div class="card-actions">
                  <button class="act-btn t-star ${status === 'starred' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="starred">★ Intéressante</button>
                  <button class="act-btn t-done ${status === 'done' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="done">✓ Retenir</button>
                  <button class="act-btn t-skip ${status === 'skip' ? 'on' : ''}" data-action="status" data-id="${esc(idea.id)}" data-type="skip">✗ Passer</button>
                </div>
              </div>`;
          }).join('');
          if (gridWrap.classList.contains('grid')) {
            gridWrap.innerHTML = cards;
          } else {
            gridWrap.outerHTML = `<div class="grid">${cards}</div>`;
          }
        }
      }
    });

    // File input
    document.getElementById('fileInput').addEventListener('change', e => {
      if (e.target.files.length) this.loadFiles(Array.from(e.target.files));
      e.target.value = '';
    });

    // Drag & drop
    document.addEventListener('dragover', e => {
      e.preventDefault();
      if (!this.dragging) { this.dragging = true; this._render(); }
    });
    document.addEventListener('dragleave', e => {
      if (!e.relatedTarget) { this.dragging = false; this._render(); }
    });
    document.addEventListener('drop', e => {
      e.preventDefault();
      this.dragging = false;
      const files = Array.from(e.dataTransfer.files)
        .filter(f => /\.(md|txt)$/i.test(f.name));
      if (files.length) this.loadFiles(files);
      else this._render();
    });
  }
}

/* ━━ BOOT ━━ */
new App();
