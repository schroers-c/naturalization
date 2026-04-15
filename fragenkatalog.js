/**
 * Read-only catalog: all questions with correct answers, grouped by category (tabs).
 */

const LETTERS = ["a", "b", "c", "d"];

/** false = nur Lösung, true = alle Optionen A–D */
let showAllAnswers = false;
let answerModeToggleBound = false;

function assetUrl(relativePath) {
  if (!relativePath || typeof relativePath !== "string") return "";
  const p = relativePath.replace(/^\/+/, "");
  return new URL(p, location.href).href;
}

async function loadData() {
  const candidates = [new URL("grundkenntnistest_kanton_zuerich.json", location.href).href];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (r.ok) return await r.json();
      lastErr = new Error(String(r.status));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Keine Daten");
}

function activateTab(tablist, panels, index) {
  const tabs = [...tablist.querySelectorAll(".catalog-tab")];
  tabs.forEach((t, i) => {
    const on = i === index;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  panels.forEach((p, i) => {
    const on = i === index;
    p.hidden = !on;
    p.classList.toggle("hidden", !on);
    if (on) {
      p.scrollTop = 0;
    }
  });
  window.scrollTo(0, 0);
  const cat = tabs[index]?.dataset?.categoryId;
  if (cat) {
    const h = `#k${cat}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }
}

function bindTabKeyboard(tablist, panels) {
  const tabs = () => [...tablist.querySelectorAll(".catalog-tab")];
  tablist.addEventListener("keydown", (e) => {
    const list = tabs();
    const cur = list.findIndex((t) => t === document.activeElement);
    if (cur < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (cur + 1) % list.length;
      activateTab(tablist, panels, next);
      list[next].focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (cur - 1 + list.length) % list.length;
      activateTab(tablist, panels, next);
      list[next].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      activateTab(tablist, panels, 0);
      list[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = list.length - 1;
      activateTab(tablist, panels, last);
      list[last].focus();
    }
  });
}

function syncAnswerModeButton() {
  const btn = document.getElementById("btn-catalog-answer-mode");
  if (!btn) return;
  btn.setAttribute("aria-pressed", showAllAnswers ? "true" : "false");
  btn.textContent = showAllAnswers
    ? "Nur richtige Antwort anzeigen"
    : "Alle Antworten anzeigen";
}

function rerenderAllAnswerBlocks() {
  document.querySelectorAll(".catalog-q").forEach((block) => {
    const q = block.__quizQ;
    if (!q) return;
    const old = block.querySelector(".catalog-answer");
    if (old) old.replaceWith(renderAnswerBlock(q, showAllAnswers));
  });
}

function bindAnswerModeToggle() {
  if (answerModeToggleBound) return;
  answerModeToggleBound = true;
  const btn = document.getElementById("btn-catalog-answer-mode");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showAllAnswers = !showAllAnswers;
    syncAnswerModeButton();
    rerenderAllAnswerBlocks();
  });
}

function renderAnswerBlock(q, showAll) {
  const correct = String(q.correct_answer || "").toLowerCase();
  const wrap = document.createElement("div");
  wrap.className = showAll
    ? "catalog-answer catalog-answer--all"
    : "catalog-answer";

  if (showAll) {
    for (const letter of LETTERS) {
      const row = document.createElement("div");
      const isCorrect = letter === correct;
      row.className =
        "catalog-opt" + (isCorrect ? " catalog-opt--correct" : "");
      row.title = isCorrect ? "Richtige Antwort" : "";

      const head = document.createElement("div");
      head.className = "catalog-opt-head";
      const lab = document.createElement("span");
      lab.className = "catalog-opt-letter";
      lab.textContent = `${letter.toUpperCase()})`;
      head.appendChild(lab);
      if (isCorrect) {
        const badge = document.createElement("span");
        badge.className = "catalog-opt-badge";
        badge.textContent = "Lösung";
        head.appendChild(badge);
      }
      row.appendChild(head);

      const body = document.createElement("div");
      body.className = "catalog-opt-body";
      const isImage =
        !!q.options_are_images && q.images && q.images[letter];
      if (isImage) {
        const img = document.createElement("img");
        img.className = "catalog-opt-img";
        img.src = assetUrl(q.images[letter]);
        img.alt = `Antwort ${letter.toUpperCase()}`;
        body.appendChild(img);
      } else {
        const t = q.options && q.options[letter];
        const p = document.createElement("p");
        p.className = "catalog-opt-text";
        p.textContent = t != null && t !== "" ? t : "—";
        body.appendChild(p);
      }
      row.appendChild(body);
      wrap.appendChild(row);
    }
    if (q.note && q.options_are_images) {
      const note = document.createElement("p");
      note.className = "catalog-note";
      note.textContent = q.note;
      wrap.appendChild(note);
    }
    return wrap;
  }

  if (q.options_are_images && q.images && q.images[correct]) {
    const label = document.createElement("p");
    label.className = "catalog-answer-label";
    label.textContent = `Richtige Antwort: ${correct.toUpperCase()}`;
    const img = document.createElement("img");
    img.className = "catalog-answer-img";
    img.src = assetUrl(q.images[correct]);
    img.alt = `Antwort ${correct.toUpperCase()}`;
    wrap.appendChild(label);
    wrap.appendChild(img);
    if (q.note) {
      const note = document.createElement("p");
      note.className = "catalog-note";
      note.textContent = q.note;
      wrap.appendChild(note);
    }
    return wrap;
  }

  const optText =
    q.options && correct && q.options[correct] != null
      ? q.options[correct]
      : "—";
  const p = document.createElement("p");
  p.className = "catalog-answer-text";
  const strong = document.createElement("strong");
  strong.textContent = `Richtige Antwort (${correct.toUpperCase()}): `;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(optText));
  wrap.appendChild(p);
  return wrap;
}

function renderCatalog(data) {
  const tablist = document.getElementById("catalog-tabs");
  const panelsRoot = document.getElementById("catalog-panels");
  const meta = document.getElementById("catalog-meta");
  const cats = data.categories || [];

  tablist.innerHTML = "";
  panelsRoot.innerHTML = "";
  const panels = [];

  let totalQ = 0;
  cats.forEach((cat) => {
    for (const sub of cat.subsections || []) {
      totalQ += (sub.questions || []).length;
    }
  });
  meta.textContent = `${totalQ} Fragen · ${cats.length} Kategorien`;

  cats.forEach((cat, idx) => {
    const tabId = `catalog-tab-${cat.id}`;
    const panelId = `catalog-panel-${cat.id}`;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "catalog-tab" + (idx === 0 ? " is-active" : "");
    tab.id = tabId;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tab.setAttribute("aria-selected", idx === 0 ? "true" : "false");
    tab.tabIndex = idx === 0 ? 0 : -1;
    tab.dataset.categoryId = String(cat.id);
    tab.dataset.catIndex = String(idx);
    const title = cat.title || "";
    const short =
      title.length > 28 ? `${title.slice(0, 26)}…` : title || String(cat.id);
    tab.textContent = `${cat.id}. ${short}`;
    if (title) tab.title = `${cat.id}. ${title}`;
    tab.addEventListener("click", () => activateTab(tablist, panels, idx));
    tablist.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "catalog-panel" + (idx === 0 ? "" : " hidden");
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabId);
    panel.hidden = idx !== 0;

    for (const sub of cat.subsections || []) {
      const subH = document.createElement("h3");
      subH.className = "catalog-subheading";
      subH.textContent = `${sub.id} ${sub.title}`;
      panel.appendChild(subH);

      for (const q of sub.questions || []) {
        const block = document.createElement("article");
        block.className = "catalog-q";

        const num =
          q.number_in_pdf != null ? String(q.number_in_pdf) : "—";
        const h4 = document.createElement("h4");
        h4.className = "catalog-q-num";
        h4.textContent = `Frage ${num}`;

        const pq = document.createElement("p");
        pq.className = "catalog-q-text";
        pq.textContent = q.question || "";

        block.__quizQ = q;
        block.appendChild(h4);
        block.appendChild(pq);
        const stem =
          q.question_image && typeof q.question_image === "string"
            ? q.question_image.trim()
            : "";
        if (stem) {
          const fig = document.createElement("p");
          fig.className = "catalog-q-figure";
          const img = document.createElement("img");
          img.className = "catalog-q-stem-img";
          img.src = assetUrl(stem);
          img.alt = "Abbildung zur Frage";
          fig.appendChild(img);
          block.appendChild(fig);
        }
        block.appendChild(renderAnswerBlock(q, showAllAnswers));
        panel.appendChild(block);
      }
    }

    panelsRoot.appendChild(panel);
    panels.push(panel);
  });

  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Kategorien");
  bindTabKeyboard(tablist, panels);

  function applyHash() {
    const raw = location.hash.replace(/^#/, "");
    const id = raw.startsWith("k") ? raw.slice(1) : raw;
    if (!id) return;
    const i = cats.findIndex((c) => String(c.id) === id);
    if (i >= 0) activateTab(tablist, panels, i);
  }
  applyHash();
  window.addEventListener("hashchange", applyHash);

  const modeWrap = document.getElementById("catalog-answer-mode-wrap");
  if (modeWrap) modeWrap.classList.remove("hidden");
  bindAnswerModeToggle();
  syncAnswerModeButton();
}

async function init() {
  const errEl = document.getElementById("catalog-load-error");
  try {
    const data = await loadData();
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    renderCatalog(data);
  } catch (e) {
    if (errEl) {
      errEl.classList.remove("hidden");
      errEl.innerHTML =
        `Daten konnten nicht geladen werden. Server im Projektordner starten:<br><code style="font-size:0.85rem">python3 -m http.server 8765</code> → <code>http://localhost:8765/fragenkatalog.html</code><br><small>${String(e.message || e)}</small>`;
    }
    document.getElementById("catalog-meta").textContent = "Laden fehlgeschlagen";
  }
}

init();
