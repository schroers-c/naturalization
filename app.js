/**
 * Grundkenntnistest practice — PWA with offline support.
 * Serve repo root:  python3 -m http.server 8765
 *
 * Persists in localStorage: per-question stats, exposure (for weighted runs),
 * session runs, settings (see APP_STORAGE_KEY).
 */

const LETTERS = ["a", "b", "c", "d"];
const ROUND_SIZE = 50;
const LEGACY_STATS_KEY = "grundkenntnistest-qstats-v1";
const APP_STORAGE_KEY = "grundkenntnistest-app-v2";
/** Wrong answers in continuous mode: earliest repeat after this many other questions. */
const WRONG_REPEAT_GAP = 5;
/** Avoid re-showing the same question within this many steps (continuous). */
const RECENT_WINDOW = 10;

function assetUrl(relativePath) {
  if (!relativePath || typeof relativePath !== "string") return "";
  const p = relativePath.replace(/^\/+/, "");
  return new URL(p, location.href).href;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL("/sw.js", location.origin), { scope: "/" })
      .catch((err) => console.warn("SW register failed:", err));
  });
}

function updateOnlineBadge() {
  const badge = document.getElementById("offline-badge");
  if (!badge) return;
  badge.classList.toggle("hidden", navigator.onLine);
}

registerServiceWorker();
window.addEventListener("online", updateOnlineBadge);
window.addEventListener("offline", updateOnlineBadge);

function defaultAppBlob() {
  return {
    v: 2,
    byId: {},
    exposure: {},
    globalSeq: 0,
    runs: [],
    settings: {
      feedbackTiming: "each",
      playMode: "quiz",
    },
  };
}

function loadAppBlob() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === "object" && p.v === 2) {
        return {
          ...defaultAppBlob(),
          ...p,
          byId: p.byId && typeof p.byId === "object" ? p.byId : {},
          exposure: p.exposure && typeof p.exposure === "object" ? p.exposure : {},
          runs: Array.isArray(p.runs) ? p.runs : [],
          settings: {
            ...defaultAppBlob().settings,
            ...(p.settings && typeof p.settings === "object" ? p.settings : {}),
          },
        };
      }
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const leg = localStorage.getItem(LEGACY_STATS_KEY);
    if (leg) {
      const p = JSON.parse(leg);
      if (p && p.byId && typeof p.byId === "object") {
        const b = defaultAppBlob();
        b.byId = p.byId;
        return b;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return defaultAppBlob();
}

function saveAppBlob(blob) {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(blob));
  } catch (e) {
    console.warn("Speichern fehlgeschlagen:", e);
  }
}

/** Run-IDs immer als String; sonst schlägt <select>.value (string) vs. JSON-Zahl fehl. */
function normRunId(id) {
  if (id == null || id === "") return "";
  return String(id);
}

/** Fehlende oder nicht-string IDs reparieren und einmal persistieren. */
function normalizeStoredRunIds() {
  let dirty = false;
  for (const r of state.runs || []) {
    if (!r || typeof r !== "object") continue;
    const sid = normRunId(r.id);
    if (!sid) {
      r.id = newRunId();
      dirty = true;
    } else if (r.id !== sid) {
      r.id = sid;
      dirty = true;
    }
  }
  if (dirty) persistApp();
}

function syncStateFromBlob() {
  state.questionStats = state.appBlob.byId;
  state.exposure = state.appBlob.exposure;
  state.globalSeq = state.appBlob.globalSeq || 0;
  state.runs = state.appBlob.runs;
  state.settings = state.appBlob.settings;
  normalizeStoredRunIds();
}

function persistApp() {
  state.appBlob.byId = state.questionStats;
  state.appBlob.exposure = state.exposure;
  state.appBlob.globalSeq = state.globalSeq;
  state.appBlob.runs = state.runs;
  state.appBlob.settings = state.settings;
  saveAppBlob(state.appBlob);
}

/** After upgrading from legacy-only storage, write v2 once so data survives reload. */
function persistAppIfMigratedFromLegacy() {
  try {
    const hasV2 = localStorage.getItem(APP_STORAGE_KEY);
    const hasLeg = localStorage.getItem(LEGACY_STATS_KEY);
    if (!hasV2 && hasLeg) persistApp();
  } catch (_) {
    /* ignore */
  }
}

const state = {
  appBlob: defaultAppBlob(),
  flat: [],
  queue: [],
  mode: null,
  /** stratified | weighted | category */
  sampleKind: null,
  categoryFilterId: null,
  index: 0,
  answered: 0,
  correct: 0,
  selected: null,
  revealed: false,
  questionStats: {},
  exposure: {},
  globalSeq: 0,
  runs: [],
  settings: defaultAppBlob().settings,
  categories: [],
  isContinuous: false,
  wrongCooldown: {},
  recentShownSession: [],
  sessionAnswers: [],
  continuousCounter: 0,
  /** Timer state */
  timerInterval: null,
  startTime: null,
  /** Avoid double-counting exposure on re-render; reset when the displayed question changes. */
  lastExposureQid: null,
};

function el(id) {
  return document.getElementById(id);
}

function questionsByCategory(flat) {
  const m = new Map();
  for (const q of flat) {
    const k = String(q.categoryId);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(q);
  }
  return m;
}

function allocateStratifiedCounts(map, k) {
  const entries = [...map.entries()].filter(([, arr]) => arr.length > 0);
  const total = entries.reduce((s, [, arr]) => s + arr.length, 0);
  if (total === 0 || k === 0) return {};
  const alloc = {};
  const parts = entries.map(([id, arr]) => {
    const n = arr.length;
    const exact = (k * n) / total;
    const floor = Math.floor(exact);
    alloc[id] = floor;
    return { id, floor, frac: exact - floor };
  });
  let sum = Object.values(alloc).reduce((a, b) => a + b, 0);
  let rem = k - sum;
  parts.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rem; i++) {
    alloc[parts[i % parts.length].id] += 1;
  }
  return alloc;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickStratifiedRandomBatch(flat, k) {
  const map = questionsByCategory(flat);
  const alloc = allocateStratifiedCounts(map, Math.min(k, flat.length));
  const out = [];
  for (const [catId, need] of Object.entries(alloc)) {
    if (need <= 0) continue;
    const pool = map.get(catId);
    if (!pool || !pool.length) continue;
    out.push(...shuffle(pool).slice(0, need));
  }
  return shuffle(out);
}

function weightForQuestion(q) {
  const s = state.questionStats[String(q.id)];
  const c = s ? s.correct : 0;
  const w = s ? s.wrong : 0;
  const total = c + w;
  if (total === 0) {
    return 1;
  }
  const wrongRatio = w / total;
  const ratioPart = 1 + wrongRatio * 48;
  const wrongCountPart = w * 3.2;
  const correctDampen = c * 0.18;
  return Math.max(0.08, ratioPart + wrongCountPart - correctDampen);
}

function exposureBoost(q) {
  const ex = state.exposure[String(q.id)] || { shown: 0, lastSeq: 0 };
  const shown = ex.shown || 0;
  const last = ex.lastSeq || 0;
  
  // Massive boost for unseen questions per user request (Zero UI)
  const unseen = shown === 0 ? 50 : 1;
  const gap = Math.max(0, state.globalSeq - last);
  const recency = 1 + Math.min(5, gap / 20);
  return unseen * recency;
}

function combinedWeight(q) {
  return weightForQuestion(q) * exposureBoost(q);
}

function pickWeightedWithoutReplacement(pool, count) {
  const remaining = pool.slice();
  const out = [];
  const target = Math.min(count, remaining.length);
  for (let k = 0; k < target; k++) {
    let sum = 0;
    const weights = remaining.map((q) => {
      const wt = combinedWeight(q);
      sum += wt;
      return wt;
    });
    let r = Math.random() * sum;
    let idx = 0;
    for (; idx < weights.length; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    if (idx >= weights.length) idx = weights.length - 1;
    out.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return out;
}

function pickStratifiedWeightedBatch(flat, k) {
  const map = questionsByCategory(flat);
  const alloc = allocateStratifiedCounts(map, Math.min(k, flat.length));
  const out = [];
  for (const [catId, need] of Object.entries(alloc)) {
    if (need <= 0) continue;
    const pool = map.get(catId);
    if (!pool || !pool.length) continue;
    out.push(...pickWeightedWithoutReplacement(pool, need));
  }
  return shuffle(out);
}

function recordAnswer(questionId, isCorrect) {
  const key = String(questionId);
  const cur = state.questionStats[key]
    ? { ...state.questionStats[key] }
    : { correct: 0, wrong: 0 };
  if (isCorrect) cur.correct += 1;
  else cur.wrong += 1;
  state.questionStats[key] = cur;
  persistApp();
}

function recordExposure(questionId) {
  const key = String(questionId);
  const prev = state.exposure[key] || { shown: 0, lastSeq: 0 };
  state.globalSeq += 1;
  state.exposure[key] = {
    shown: (prev.shown || 0) + 1,
    lastSeq: state.globalSeq,
  };
}

function shouldHideSessionScoreDuringQuiz() {
  return getFeedbackTiming() === "end";
}

function updateSessionStatsDisplay() {
  const answeredEl = el("stat-answered");
  const correctEl = el("stat-correct");
  const pctEl = el("stat-pct");
  if (!answeredEl || !correctEl || !pctEl) return;
  answeredEl.textContent = state.answered;
  correctEl.textContent = state.correct;
  const a = state.answered;
  pctEl.textContent =
    a === 0 ? "—" : `${Math.round((state.correct / a) * 100)}%`;
}

function flattenQuestions(data) {
  const out = [];
  let ordinal = 0;
  for (const cat of data.categories || []) {
    for (const sub of cat.subsections || []) {
      for (const q of sub.questions || []) {
        ordinal += 1;
        out.push({
          id: ordinal,
          categoryId: cat.id,
          categoryTitle: cat.title,
          subsectionId: sub.id,
          subsectionTitle: sub.title,
          ...q,
        });
      }
    }
  }
  return out;
}

function extractCategories(data) {
  const out = [];
  for (const cat of data.categories || []) {
    if (cat && cat.id != null) {
      out.push({
        id: String(cat.id),
        title: typeof cat.title === "string" ? cat.title : String(cat.id),
      });
    }
  }
  return out;
}

async function loadData() {
  const candidates = [
    new URL("grundkenntnistest_kanton_zuerich.json", location.href).href,
    `${location.origin}/grundkenntnistest_kanton_zuerich.json`,
  ];
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

function showScreen(name) {
  const screens = ["screen-quiz", "screen-practice", "screen-analyze", "screen-quiz-active", "screen-results"];
  screens.forEach((id) => {
    const node = el(id);
    if (node) node.classList.toggle("hidden", id !== name);
  });

  const header = document.querySelector(".app-header");
  if (header) {
    header.classList.remove("hidden");
  }
  const gear = el("btn-quiz-settings");
  if (gear) {
    const showGear = name === "screen-quiz" || name === "screen-quiz-active";
    gear.classList.toggle("hidden", !showGear);
  }
  const exitQuiz = el("btn-quiz-exit");
  if (exitQuiz) {
    exitQuiz.classList.toggle("hidden", name !== "screen-quiz-active");
  }
}

function openMenu() {
  el("nav-overlay").classList.add("active");
}

function closeMenu() {
  el("nav-overlay").classList.remove("active");
}

function switchTab(tabName) {
  showScreen(`screen-${tabName}`);
  closeMenu();

  // Update active state in menu
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.screen === tabName);
  });

  if (tabName === "analyze") renderStatsView();
}

/** Settings from persisted state (UI: chips in #quiz-settings-sheet). */
function getPlayMode() {
  return state.settings.playMode === "continuous" ? "continuous" : "quiz";
}

function getFeedbackTiming() {
  return state.settings.feedbackTiming === "end" ? "end" : "each";
}

function activePool() {
  if (state.categoryFilterId != null) {
    return state.flat.filter(
      (q) => String(q.categoryId) === String(state.categoryFilterId)
    );
  }
  return state.flat;
}

function tickWrongCooldowns() {
  const o = state.wrongCooldown;
  for (const k of Object.keys(o)) {
    if (o[k] > 0) o[k] -= 1;
  }
}

function pushRecent(qid) {
  state.recentShownSession.push(String(qid));
  if (state.recentShownSession.length > RECENT_WINDOW) {
    state.recentShownSession.shift();
  }
}

function dueWrongPool(pool) {
  return pool.filter((q) => state.wrongCooldown[String(q.id)] === 0);
}

function pickOneStratified(pool) {
  const map = questionsByCategory(pool);
  const alloc = allocateStratifiedCounts(map, 1);
  const catPick = Object.keys(alloc).find((id) => alloc[id] > 0);
  const arr = map.get(catPick) || pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickOneWeighted(pool, excludeIds) {
  const ex = excludeIds || new Set();
  const filtered = pool.filter((q) => !ex.has(String(q.id)));
  const use = filtered.length ? filtered : pool;
  const batch = pickWeightedWithoutReplacement(use, 1);
  return batch[0];
}

function pickNextContinuousQuestion() {
  const pool = activePool();
  if (!pool.length) return state.flat[0];

  const recent = new Set(state.recentShownSession);
  const exclude = new Set(recent);

  const due = dueWrongPool(pool);
  if (due.length) {
    const pick = due[Math.floor(Math.random() * due.length)];
    delete state.wrongCooldown[String(pick.id)];
    return pick;
  }

  let candidate;
  if (state.sampleKind === "weighted") {
    candidate = pickOneWeighted(pool, exclude);
  } else if (state.sampleKind === "stratified") {
    const reduced = pool.filter((q) => !exclude.has(String(q.id)));
    candidate = pickOneStratified(reduced.length ? reduced : pool);
  } else {
    const reduced = pool.filter((q) => !exclude.has(String(q.id)));
    candidate =
      reduced[Math.floor(Math.random() * reduced.length)] ||
      pool[Math.floor(Math.random() * pool.length)];
  }
  return candidate;
}

function ensureContinuousQueueAhead() {
  if (!state.isContinuous) return;
  while (state.queue.length - state.index < 12) {
    const q = pickNextContinuousQuestion();
    state.queue.push(q);
  }
}

function resetSessionTracking() {
  state.wrongCooldown = {};
  state.recentShownSession = [];
  state.sessionAnswers = [];
  state.continuousCounter = 0;
  state.lastExposureQid = null;
}

function startStratifiedRandom() {
  state.mode = "random";
  state.sampleKind = "stratified";
  state.categoryFilterId = null;
  state.isContinuous = getPlayMode() === "continuous";
  resetSessionTracking();
  if (state.isContinuous) {
    state.queue = [];
    state.index = 0;
    ensureContinuousQueueAhead();
  } else {
    state.queue = pickStratifiedRandomBatch(state.flat, ROUND_SIZE);
    state.index = 0;
  }
  state.answered = 0;
  state.correct = 0;
  state.selected = null;
  state.revealed = false;
  showScreen("screen-quiz-active");
  startTimer();
  renderQuiz();
}

function startStratifiedWeighted() {
  state.mode = "weighted";
  state.sampleKind = "weighted";
  state.categoryFilterId = null;
  state.isContinuous = getPlayMode() === "continuous";
  resetSessionTracking();
  if (state.isContinuous) {
    state.queue = [];
    state.index = 0;
    ensureContinuousQueueAhead();
  } else {
    state.queue = pickStratifiedWeightedBatch(state.flat, ROUND_SIZE);
    state.index = 0;
  }
  state.answered = 0;
  state.correct = 0;
  state.selected = null;
  state.revealed = false;
  showScreen("screen-quiz-active");
  startTimer();
  renderQuiz();
}

function startCategory(catId) {
  state.mode = "category";
  state.sampleKind = "category";
  state.categoryFilterId = String(catId);
  state.isContinuous = getPlayMode() === "continuous";
  const pool = state.flat.filter((q) => String(q.categoryId) === String(catId));
  const n = Math.min(ROUND_SIZE, pool.length);
  resetSessionTracking();
  if (state.isContinuous) {
    state.queue = [];
    state.index = 0;
    ensureContinuousQueueAhead();
  } else {
    state.queue = shuffle(pool).slice(0, n);
    state.index = 0;
  }
  state.answered = 0;
  state.correct = 0;
  state.selected = null;
  state.revealed = false;
  showScreen("screen-quiz-active");
  startTimer();
  renderQuiz();
}

function modeLabelText() {
  const cat = state.categoryFilterId
    ? state.categories.find((c) => c.id === String(state.categoryFilterId))
    : null;
  const catBit = cat ? ` · ${cat.id}` : "";
  if (state.isContinuous) {
    if (state.mode === "random") return `Kontinuierlich · Anteil je Kategorie${catBit}`;
    if (state.mode === "weighted") return `Kontinuierlich · gewichtet${catBit}`;
    if (state.mode === "category") return `Kontinuierlich · nur Kat.${catBit}`;
  }
  if (state.mode === "random") return `Zufall (${ROUND_SIZE}) · Kataloganteile${catBit}`;
  if (state.mode === "weighted") return `Gewichtet (${ROUND_SIZE})${catBit}`;
  if (state.mode === "category") {
    return cat ? `Nur: ${truncateText(cat.title, 36)}` : "Kategorie";
  }
  return "Übung";
}

function renderQuiz() {
  if (state.isContinuous) {
    ensureContinuousQueueAhead();
  }

  const total = state.queue.length;
  const i = state.index;
  if (i >= total && !state.isContinuous) {
    stopTimer();
    renderDone();
    return;
  }
  if (i >= total && state.isContinuous) {
    ensureContinuousQueueAhead();
  }

  const q = state.queue[i];
  if (!q) {
    stopTimer();
    renderDone();
    return;
  }

  if (!state.revealed && state.lastExposureQid !== q.id) {
    recordExposure(q.id);
    state.lastExposureQid = q.id;
    pushRecent(q.id);
    if (state.isContinuous) {
      state.continuousCounter += 1;
    }
  }

  const modeLbl = el("quiz-mode-label");
  if (modeLbl) modeLbl.textContent = modeLabelText();
  updateSessionStatsDisplay();
  const sessionStatsWrap = el("quiz-session-stats");
  if (sessionStatsWrap) {
    const hideScore = shouldHideSessionScoreDuringQuiz();
    sessionStatsWrap.classList.toggle("hidden", hideScore);
    sessionStatsWrap.setAttribute("aria-hidden", hideScore ? "true" : "false");
  }

  const progCur = el("progress-current");
  const progTot = el("progress-total");
  if (progCur && progTot) {
    if (state.isContinuous) {
      progCur.textContent = String(state.continuousCounter || i + 1);
      progTot.textContent = "∞";
    } else {
      progCur.textContent = String(i + 1);
      progTot.textContent = String(total);
    }
  }

  const fillPct = state.isContinuous
    ? Math.min(100, ((state.continuousCounter % ROUND_SIZE) / ROUND_SIZE) * 100)
    : Math.min(100, (i / Math.max(1, total)) * 100);
  const pf = el("progress-fill");
  if (pf) pf.style.width = `${fillPct}%`;

  const meta = el("quiz-progress-meta");
  if (meta) {
    const mode = modeLabelText();
    if (state.isContinuous) {
      meta.textContent = `${mode} · Frage ${state.continuousCounter || i + 1}`;
    } else {
      meta.textContent = `${mode} · Frage ${i + 1} / ${total}`;
    }
  }

  const ctxCat = el("ctx-cat");
  const ctxSub = el("ctx-sub");
  if (ctxCat) ctxCat.textContent = `${q.categoryId} ${q.categoryTitle}`;
  if (ctxSub) ctxSub.textContent = `${q.subsectionId} ${q.subsectionTitle}`;

  const qtext = el("question-text");
  if (qtext) qtext.textContent = q.question || "";

  const qImgWrap = el("question-image-wrap");
  if (qImgWrap) {
    qImgWrap.innerHTML = "";
    const stemImg =
      q.question_image && typeof q.question_image === "string"
        ? q.question_image.trim()
        : "";
    if (stemImg) {
      qImgWrap.classList.remove("hidden");
      qImgWrap.setAttribute("aria-hidden", "false");
      const img = document.createElement("img");
      img.className = "question-stem-img";
      img.src = assetUrl(stemImg);
      img.alt = "Abbildung zur Frage";
      qImgWrap.appendChild(img);
    } else {
      qImgWrap.classList.add("hidden");
      qImgWrap.setAttribute("aria-hidden", "true");
    }
  }

  const opts = el("options");
  opts.innerHTML = "";
  const isImage = !!q.options_are_images;
  opts.classList.toggle("options-list--images", isImage);

  const timing = getFeedbackTiming();
  const showColors = state.revealed && timing === "each";

  for (const letter of LETTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.dataset.letter = letter;

    const lab = document.createElement("span");
    lab.className = "letter";
    lab.textContent = letter.toUpperCase();

    const content = document.createElement("span");
    const text = q.options && q.options[letter];
    const imgPath = q.images && q.images[letter];

    if (isImage && imgPath) {
      const img = document.createElement("img");
      img.className = "opt-img";
      img.src = assetUrl(imgPath);
      img.alt = `Antwort ${letter.toUpperCase()}`;
      content.appendChild(img);
    } else if (text != null && text !== "") {
      content.textContent = text;
    } else if (isImage) {
      content.textContent = "(Bild)";
    } else {
      content.textContent = "—";
    }

    btn.appendChild(lab);
    btn.appendChild(content);

    if (state.revealed) {
      btn.disabled = true;
      if (showColors) {
        const ok = letter === String(q.correct_answer || "").trim().toLowerCase();
        const picked = letter === state.selected;
        if (ok) btn.classList.add("correct");
        else if (picked) btn.classList.add("wrong");
        else btn.classList.add("dim");
      } else {
        const picked = letter === state.selected;
        if (picked) btn.classList.add("picked-blind");
        else btn.classList.add("dim");
      }
    } else {
      btn.addEventListener("click", () => pickOption(letter));
    }

    opts.appendChild(btn);
  }

  const fb = el("feedback");
  if (fb) {
    fb.className = "feedback hidden";
    if (state.revealed && timing === "each") {
      fb.classList.remove("hidden");
      fb.classList.add("visible");
      const ok = state.selected === String(q.correct_answer || "").trim().toLowerCase();
      fb.classList.add(ok ? "ok" : "bad");
      fb.textContent = ok
        ? "Richtig!"
        : `Leider falsch. Richtig wäre: ${String(q.correct_answer || "").toUpperCase()}.`;
    } else if (state.revealed && timing === "end") {
      fb.classList.remove("visible", "ok", "bad", "neutral");
      fb.textContent = "";
    } else {
      fb.classList.remove("visible", "ok", "bad", "neutral");
      fb.textContent = "";
    }
  }

  const nextBtn = el("btn-next");
  if (nextBtn) {
    const needNextClick =
      state.revealed && (timing !== "end" || state.isContinuous);
    nextBtn.disabled = !needNextClick;
    nextBtn.classList.toggle("hidden", !needNextClick);
  }
}

function pickOption(letter) {
  if (state.revealed) return;
  const q = state.queue[state.index];
  state.selected = letter;
  state.revealed = true;
  state.answered += 1;
  const ok = letter === String(q.correct_answer || "").trim().toLowerCase();
  if (ok) state.correct += 1;
  recordAnswer(q.id, ok);
  state.sessionAnswers.push({ id: q.id, ok, selected: letter, correct: q.correct_answer });
  if (state.isContinuous && !ok) {
    state.wrongCooldown[String(q.id)] = WRONG_REPEAT_GAP;
  }
  updateSessionStatsDisplay();
  if (!state.isContinuous) {
    const total = state.queue.length;
    const pf = el("progress-fill");
    if (pf) pf.style.width = `${((state.index + 1) / total) * 100}%`;
  }
  if (getFeedbackTiming() === "end" && !state.isContinuous) {
    nextQuestion();
    return;
  }
  renderQuiz();
}

function nextQuestion() {
  if (!state.revealed) return;
  tickWrongCooldowns();
  state.index += 1;
  state.selected = null;
  state.revealed = false;
  if (state.isContinuous) {
    if (state.index > 28) {
      const cut = 14;
      state.queue.splice(0, cut);
      state.index -= cut;
    }
    ensureContinuousQueueAhead();
  }
  renderQuiz();
}

function newRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function saveRunFromSession(opts = {}) {
  const incomplete = Boolean(opts.incomplete);
  const rawItems = state.sessionAnswers.map((x) => ({
    id: x.id,
    ok: x.ok,
  }));
  const items = rawItems.slice(-500);
  if (!items.length) return;
  let durationSec = null;
  if (state.startTime != null && typeof state.startTime === "number") {
    durationSec = Math.max(0, Math.round((Date.now() - state.startTime) / 1000));
  }
  const run = {
    id: newRunId(),
    ts: new Date().toISOString(),
    mode: state.mode,
    sampleKind: state.sampleKind,
    categoryId: state.categoryFilterId,
    continuous: state.isContinuous,
    incomplete,
    total: items.length,
    correct: items.filter((x) => x.ok).length,
    items,
    durationSec,
  };
  state.runs.unshift(run);
  if (state.runs.length > 80) state.runs.length = 80;
  persistApp();
  state.sessionAnswers = [];
}

function renderDone(opts = {}) {
  const incomplete = opts.incomplete === true;
  const total = state.answered;
  const timing = getFeedbackTiming();
  const wrongForEndMode =
    timing === "end" && total > 0
      ? state.sessionAnswers.filter((x) => !x.ok).length
      : 0;
  saveRunFromSession({ incomplete });
  showScreen("screen-results");
  const pct = total ? Math.round((state.correct / total) * 100) : 0;
  el("done-summary").textContent = `${state.correct} von ${total} richtig (${pct}%)`;

  let detail = "";
  if (incomplete && state.isContinuous) {
    detail =
      timing === "end" && total > 0
        ? `Training beendet — ${wrongForEndMode} Fehler (ohne Einzelfeedback bis zur Auswertung).`
        : "Training-Session beendet.";
  } else if (state.mode === "weighted") {
    detail = state.isContinuous
      ? "Kontinuierliche Übung beendet — falsch beantwortete Fragen kommen nach ein paar anderen Fragen wieder."
      : `Gewichtete Übung mit ${state.queue.length} Fragen (Kataloganteile, Statistik & Seltenheit der Anzeige).`;
  } else if (state.mode === "random") {
    detail = state.isContinuous
      ? "Kontinuierliche Übung beendet."
      : `Zufallsübung mit ${state.queue.length} Fragen (ohne Wiederholung; Anteil je Kategorie wie im Katalog).`;
  } else if (state.mode === "category") {
    const cat = state.categories.find((c) => c.id === String(state.categoryFilterId));
    detail = cat
      ? `Kategorie «${cat.title}».`
      : "Kategorieübung.";
  }

  if (timing === "end" && total > 0 && !(incomplete && state.isContinuous)) {
    detail += ` Runden-Modus: bis zum Schluss ohne Einzelfeedback — ${wrongForEndMode} Fehler.`;
  }

  el("done-detail").textContent = detail;
}

function handleQuizDoneOrExit() {
  stopTimer();
  switchTab("quiz");
}

function handleActiveQuizBack() {
  stopTimer();
  if (
    state.answered > 0 &&
    state.isContinuous &&
    getFeedbackTiming() === "end"
  ) {
    renderDone({ incomplete: true });
    return;
  }
  if (state.answered > 0) {
    saveRunFromSession({ incomplete: true });
  }
  switchTab("quiz");
}

function truncateText(s, maxLen) {
  if (!s || typeof s !== "string") return "—";
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function getStatsRows() {
  return state.flat.map((q) => {
    const s = state.questionStats[String(q.id)];
    const correct = s ? s.correct || 0 : 0;
    const wrong = s ? s.wrong || 0 : 0;
    const tot = correct + wrong;
    const pct = tot === 0 ? null : (correct / tot) * 100;
    return { q, correct, wrong, total: tot, pct };
  });
}

function rowMatchesFilter(row, filter) {
  if (filter === "all") return true;
  if (filter === "practiced") return row.total > 0;
  if (filter === "weak") {
    if (row.total === 0) return false;
    if (row.correct === 0) return true;
    return row.pct < 50;
  }
  return true;
}

function sortStatsRows(rows, sortKey) {
  const out = rows.slice();
  out.sort((a, b) => {
    if (sortKey === "id") return a.q.id - b.q.id;
    if (sortKey === "attempts-desc") {
      const ta = a.total;
      const tb = b.total;
      if (tb !== ta) return tb - ta;
      return a.q.id - b.q.id;
    }
    const pa = a.pct;
    const pb = b.pct;
    const na = a.total === 0;
    const nb = b.total === 0;
    if (na && nb) return a.q.id - b.q.id;
    if (na) return 1;
    if (nb) return -1;
    if (sortKey === "pct-asc") {
      if (pa !== pb) return pa - pb;
      return a.q.id - b.q.id;
    }
    if (sortKey === "pct-desc") {
      if (pa !== pb) return pb - pa;
      return a.q.id - b.q.id;
    }
    return a.q.id - b.q.id;
  });
  return out;
}

const MAX_SEQ_SEG = 48;

/**
 * Kleines Rechteck: innen waagrecht in Segmente geteilt (links = ältere Antworten).
 * @param {HTMLElement} host
 * @param {boolean[]} history
 * @param {{ correct: number, wrong: number }} totals
 */
function mountAnswerSequenceInto(host, history, totals) {
  host.replaceChildren();
  const inner = document.createElement("div");
  inner.className = "answer-seq-tile__inner";
  const c = totals ? totals.correct + totals.wrong : 0;

  if (history.length) {
    const parts =
      history.length > MAX_SEQ_SEG ? history.slice(-MAX_SEQ_SEG) : history;
    for (const ok of parts) {
      const s = document.createElement("span");
      s.className =
        "answer-seq-tile__seg " +
        (ok ? "answer-seq-tile__seg--ok" : "answer-seq-tile__seg--bad");
      inner.appendChild(s);
    }
    if (history.length > MAX_SEQ_SEG) {
      host.title = `Letzte ${MAX_SEQ_SEG} von ${history.length} Antworten (links älter, rechts jünger)`;
    } else {
      host.title = history.map((o) => (o ? "richtig" : "falsch")).join(" → ");
    }
  } else if (c > 0) {
    const one = document.createElement("span");
    one.className = "answer-seq-tile__seg answer-seq-tile__seg--unknown";
    inner.appendChild(one);
    host.title =
      "Zähler vorhanden, aber keine chronologische Folge aus gespeicherten Durchgängen.";
  } else {
    const one = document.createElement("span");
    one.className = "answer-seq-tile__seg answer-seq-tile__seg--empty";
    inner.appendChild(one);
    host.title = "Noch nicht geübt";
  }
  host.appendChild(inner);
}

function bindMatrixCellOpen(cell, qid) {
  cell.classList.add("stats-mat-cell--clickable");
  cell.setAttribute("role", "button");
  cell.addEventListener("click", (e) => {
    e.stopPropagation();
    showStatsModal(String(qid));
  });
}

function renderStatsSparkline(allRows) {
  const host = el("stats-sparkline");
  if (!host) return;
  host.innerHTML = "";
  host.className = "stats-spark-matrix";
  for (const row of allRows) {
    const qid = String(row.q.id);
    const pdf = row.q.number_in_pdf;
    const title =
      pdf != null
        ? `Frage PDF Nr. ${pdf} — ${truncateText(row.q.question || "", 72)}`
        : `Frage ${row.q.id} — ${truncateText(row.q.question || "", 72)}`;
    const cell = document.createElement("div");
    cell.title = title;
    if (row.total === 0) {
      cell.className = "stats-mat-cell stats-mat-cell--empty";
      bindMatrixCellOpen(cell, qid);
      host.appendChild(cell);
      continue;
    }
    cell.className = "stats-mat-cell";
    const history = answerHistoryForQuestion(qid);
    mountAnswerSequenceInto(cell, history, {
      correct: row.correct,
      wrong: row.wrong,
    });
    bindMatrixCellOpen(cell, qid);
    host.appendChild(cell);
  }
}

/** Chronological OK/fail for one question across saved runs (ältester Durchgang zuerst). */
function answerHistoryForQuestion(qid) {
  const want = String(qid);
  const hist = [];
  for (const run of runsChronological()) {
    for (const it of run.items || []) {
      if (String(it.id) === want) hist.push(!!it.ok);
    }
  }
  return hist;
}

function markFromHistoryOrTotals(history, correct, wrong) {
  if (history.length) return history[history.length - 1];
  const t = correct + wrong;
  if (!t) return null;
  if (wrong === 0) return true;
  if (correct === 0) return false;
  return correct >= wrong;
}

function appendMarkCell(td, markOk) {
  td.className = "stats-qcol-mark num";
  if (markOk === true) {
    td.innerHTML =
      '<span class="stats-mark stats-mark--ok" aria-label="Richtig"><span class="stats-mark-glyph" aria-hidden="true">✓</span></span>';
  } else if (markOk === false) {
    td.innerHTML =
      '<span class="stats-mark stats-mark--bad" aria-label="Falsch"><span class="stats-mark-glyph" aria-hidden="true">✗</span></span>';
  } else {
    td.innerHTML =
      '<span class="stats-mark stats-mark--none"><span class="stats-mark-glyph" aria-hidden="true">·</span></span>';
  }
}

function bindStatsQRowOpen(tr, qid) {
  tr.addEventListener("click", () => showStatsModal(String(qid)));
}

/** Eine Kachel pro Antwort im Durchgang (wie Gesamt-Matrix). */
function renderRunSparkline(run) {
  const host = el("stats-sparkline");
  if (!host) return;
  host.innerHTML = "";
  host.className = "stats-spark-matrix";
  for (const it of run.items || []) {
    const cell = document.createElement("div");
    cell.className = "stats-mat-cell";
    cell.title = it.ok ? "Richtig — antippen für Frage" : "Falsch — antippen für Frage";
    mountAnswerSequenceInto(cell, [!!it.ok], {
      correct: it.ok ? 1 : 0,
      wrong: it.ok ? 0 : 1,
    });
    bindMatrixCellOpen(cell, String(it.id));
    host.appendChild(cell);
  }
}

function renderStatsQlistGlobal(sortedRows) {
  const tbody = el("stats-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const row of sortedRows) {
    const q = row.q;
    const qid = String(q.id);
    const history = answerHistoryForQuestion(qid);
    const markOk = markFromHistoryOrTotals(history, row.correct, row.wrong);
    const tr = document.createElement("tr");
    tr.className = "stats-qrow";
    tr.dataset.qId = qid;
    bindStatsQRowOpen(tr, qid);

    const tdH = document.createElement("td");
    tdH.className = "stats-qcol-tile";
    const tile = document.createElement("span");
    tile.className = "answer-seq-tile answer-seq-tile--inline";
    mountAnswerSequenceInto(tile, history, {
      correct: row.correct,
      wrong: row.wrong,
    });
    tdH.appendChild(tile);

    const tdM = document.createElement("td");
    appendMarkCell(tdM, markOk);

    const tdT = document.createElement("td");
    tdT.className = "stats-qcol-text";
    tdT.textContent = truncateText(q.question || "", 140);

    const tdN = document.createElement("td");
    tdN.className = "stats-qcol-num num";
    tdN.textContent =
      q.number_in_pdf != null ? `Nr. ${q.number_in_pdf}` : "—";

    const tdP = document.createElement("td");
    tdP.className = "stats-qcol-pct num";
    if (row.total === 0) tdP.textContent = "—";
    else {
      tdP.textContent = `${Math.round(row.pct)}%`;
      if (row.pct >= 70) tdP.classList.add("pct-good");
      else if (row.pct < 50) tdP.classList.add("pct-bad");
    }

    tr.appendChild(tdH);
    tr.appendChild(tdM);
    tr.appendChild(tdT);
    tr.appendChild(tdN);
    tr.appendChild(tdP);
    tbody.appendChild(tr);
  }
}

function renderStatsQlistRun(run) {
  const tbody = el("stats-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const it of run.items || []) {
    const q = state.flat.find((x) => String(x.id) === String(it.id));
    if (!q) continue;
    const qid = String(it.id);
    const tr = document.createElement("tr");
    tr.className = "stats-qrow";
    tr.dataset.qId = qid;
    bindStatsQRowOpen(tr, qid);

    const tdM = document.createElement("td");
    appendMarkCell(tdM, it.ok);

    const tdT = document.createElement("td");
    tdT.className = "stats-qcol-text";
    tdT.textContent = truncateText(q.question || "", 140);

    const tdN = document.createElement("td");
    tdN.className = "stats-qcol-num num";
    tdN.textContent =
      q.number_in_pdf != null ? `Nr. ${q.number_in_pdf}` : "—";

    const tdP = document.createElement("td");
    tdP.className = "stats-qcol-pct num";
    tdP.textContent = it.ok ? "100%" : "0%";
    tdP.classList.add(it.ok ? "pct-good" : "pct-bad");

    tr.appendChild(tdM);
    tr.appendChild(tdT);
    tr.appendChild(tdN);
    tr.appendChild(tdP);
    tbody.appendChild(tr);
  }
}

function formatRunDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-CH", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** mm:ss from seconds (Dauer eines Durchgangs). */
function formatRunDurationSec(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function runDurationSuffix(run) {
  const t = formatRunDurationSec(run.durationSec);
  return t ? ` · ${t}` : "";
}

function runModeLabel(run) {
  let base = "—";
  if (run.mode === "random")
    base = run.continuous ? "Kontinuierlich · Anteile" : "Zufall (50)";
  else if (run.mode === "weighted")
    base = run.continuous ? "Kontinuierlich · gewichtet" : "Gewichtet (50)";
  else if (run.mode === "category") {
    const c = state.categories.find((x) => x.id === String(run.categoryId));
    base = c ? `Kategorie ${c.id}` : "Kategorie";
  } else if (run.mode) base = run.mode;
  return run.incomplete ? `${base} · abgebrochen` : base;
}

function runsChronological() {
  return [...(state.runs || [])].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}

function populateRunPicker() {
  const sel = el("stats-run-picker");
  if (!sel) return;
  const prev = normRunId(sel.value);
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Gesamt — alle Fragen (Richtig/Falsch je Frage)";
  sel.appendChild(opt0);
  const chrono = runsChronological();
  chrono.forEach((run, i) => {
    const rid = normRunId(run.id);
    if (!rid) return;
    const o = document.createElement("option");
    o.value = rid;
    o.textContent = `Durchgang ${i + 1}: ${formatRunDate(run.ts)}${runDurationSuffix(run)} · ${runModeLabel(run)} · ${run.correct}/${run.total} richtig`;
    sel.appendChild(o);
  });
  const ids = new Set(chrono.map((r) => normRunId(r.id)).filter(Boolean));
  if (prev && ids.has(prev)) sel.value = prev;
  else sel.value = "";
}

function runChronoNumber(runId) {
  const want = normRunId(runId);
  const chrono = runsChronological();
  const idx = chrono.findIndex((r) => normRunId(r.id) === want);
  return idx >= 0 ? idx + 1 : 0;
}

function deleteSelectedRun() {
  const sel = el("stats-run-picker");
  const id = normRunId(sel && sel.value);
  if (!id) return;
  if (!confirm("Diesen Durchgang wirklich löschen?")) return;

  const run = state.runs.find((r) => normRunId(r.id) === id);
  if (run) {
    for (const it of run.items || []) {
      const qid = String(it.id);
      if (state.questionStats[qid]) {
        if (it.ok && state.questionStats[qid].correct > 0) {
          state.questionStats[qid].correct -= 1;
        } else if (!it.ok && state.questionStats[qid].wrong > 0) {
          state.questionStats[qid].wrong -= 1;
        }
      }
    }
  }

  state.runs = state.runs.filter((r) => normRunId(r.id) !== id);
  persistApp();
  if (sel) sel.value = "";
  renderStatsView();
}

function renderStatsView() {
  const emptyEl = el("stats-empty");
  const globalPanel = el("stats-global-panel");
  const summaryEl = el("stats-summary");
  const runActions = el("stats-run-only-actions");
  const globalControls = el("stats-global-controls");
  const hintEl = el("stats-qlist-hint");
  if (!emptyEl || !globalPanel || !summaryEl) return;

  populateRunPicker();
  const runPicker = el("stats-run-picker");
  let selectedRunId = normRunId(runPicker && runPicker.value);
  let selectedRun = selectedRunId
    ? state.runs.find((r) => normRunId(r.id) === selectedRunId)
    : null;
  if (selectedRunId && !selectedRun && runPicker) {
    runPicker.value = "";
    selectedRunId = "";
    selectedRun = null;
  }

  const qtbl = el("stats-qlist-table");
  if (qtbl) qtbl.classList.toggle("stats-qlist--run-detail", Boolean(selectedRun));

  if (!state.flat.length) {
    emptyEl.textContent =
      "Fragen sind noch nicht geladen — bitte Seite neu laden oder Server prüfen.";
    emptyEl.classList.remove("hidden");
    globalPanel.classList.add("hidden");
    if (runActions) runActions.classList.add("hidden");
    return;
  }

  globalPanel.classList.remove("hidden");

  if (selectedRun) {
    if (runActions) runActions.classList.remove("hidden");
    if (globalControls) globalControls.classList.add("hidden");
    if (hintEl) {
      hintEl.textContent =
        "Oben: eine Kachel pro Antwort in Reihenfolge. Zeile antippen: volle Frage mit Lösung.";
    }
    emptyEl.classList.add("hidden");
    const wrong = (selectedRun.items || []).filter((x) => !x.ok).length;
    const n = runChronoNumber(selectedRun.id);
    const dur = formatRunDurationSec(selectedRun.durationSec);
    const durPart = dur ? ` · Dauer ${dur}` : "";
    summaryEl.textContent = `Durchgang ${n}: ${formatRunDate(selectedRun.ts)}${durPart} · ${runModeLabel(selectedRun)} — ${selectedRun.correct} von ${selectedRun.total} richtig (${wrong} falsch).`;
    renderRunSparkline(selectedRun);
    renderStatsQlistRun(selectedRun);
    return;
  }

  if (runActions) runActions.classList.add("hidden");
  if (globalControls) globalControls.classList.remove("hidden");
  if (hintEl) {
    hintEl.textContent =
      "Kacheln: innen waagrecht geteilt — jedes Stück eine Antwort in Zeitfolge (links älter, rechts jünger; grün = richtig, rot = falsch). Oben dieselbe Darstellung je Frage. Zeile antippen: volle Frage.";
  }

  const allRows = getStatsRows();
  let practiced = 0;
  let sumCorrect = 0;
  let sumWrong = 0;
  for (const r of allRows) {
    if (r.total > 0) practiced += 1;
    sumCorrect += r.correct;
    sumWrong += r.wrong;
  }
  const sumAttempts = sumCorrect + sumWrong;

  if (sumAttempts === 0) {
    emptyEl.textContent =
      "Noch keine Antworten gespeichert — die Übersicht unten zeigt alle Fragen als «noch nicht geübt».";
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
  }

  summaryEl.textContent =
    sumAttempts === 0
      ? "Sobald du übst, erscheinen hier Richtig-/Falsch-Zähler und Quoten pro Frage."
      : `Gesamt: ${sumCorrect} richtig, ${sumWrong} falsch (${sumAttempts} Antworten). ${practiced} von ${allRows.length} Fragen mindestens einmal geübt.`;

  renderStatsSparkline(allRows);

  const sortKey = el("stats-sort")?.value || "id";
  const filter = el("stats-filter")?.value || "all";
  const filtered = allRows.filter((r) => rowMatchesFilter(r, filter));
  const sorted = sortStatsRows(filtered, sortKey);
  renderStatsQlistGlobal(sorted);
}

function openStats() {
  switchTab("analyze");
}

function deleteAllRuns() {
  if (!confirm("Alle gespeicherten Durchgänge löschen?")) return;

  for (const run of state.runs) {
    for (const it of run.items || []) {
      const qid = String(it.id);
      if (state.questionStats[qid]) {
        if (it.ok && state.questionStats[qid].correct > 0) {
          state.questionStats[qid].correct -= 1;
        } else if (!it.ok && state.questionStats[qid].wrong > 0) {
          state.questionStats[qid].wrong -= 1;
        }
      }
    }
  }

  state.runs = [];
  persistApp();
  const sel = el("stats-run-picker");
  if (sel) sel.value = "";
  renderStatsView();
}

function setModeButtonsEnabled(on) {
  el("btn-random").disabled = !on;
  el("btn-weighted").disabled = !on;
  const statsBtn = el("btn-open-stats");
  if (statsBtn) statsBtn.disabled = !on;
  document.querySelectorAll(".category-mode-btn").forEach((b) => {
    b.disabled = !on;
  });
}

function buildCategoryTiles() {
  const grid = el("category-mode-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const cat of state.categories) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card category-mode-btn";
    btn.dataset.categoryId = cat.id;
    const n = state.flat.filter((q) => String(q.categoryId) === String(cat.id)).length;
    btn.innerHTML = `<h3>Kategorie ${cat.id}</h3><p>${cat.title}</p><p class="card-meta">${n} Fragen · zufällig in dieser Kategorie</p>`;
    btn.addEventListener("click", () => startCategory(cat.id));
    grid.appendChild(btn);
  }
}

function syncQuizSettingsPanel() {
  const isCont = state.settings.playMode === "continuous";
  const fbEndOn = state.settings.feedbackTiming === "end";
  const quizChip = el("qs-play-quiz");
  const trainChip = el("qs-play-training");
  const eachChip = el("qs-fb-each");
  const endChip = el("qs-fb-end");
  const fbRow = el("qs-fb-chips");
  if (quizChip && trainChip) {
    quizChip.classList.toggle("is-active", !isCont);
    trainChip.classList.toggle("is-active", isCont);
  }
  if (eachChip && endChip) {
    eachChip.classList.toggle("is-active", !fbEndOn);
    endChip.classList.toggle("is-active", fbEndOn);
    endChip.disabled = false;
  }
  if (fbRow) fbRow.classList.remove("quiz-settings-chips--disabled");
}

function openQuizSettingsSheet() {
  syncQuizSettingsPanel();
  const sheet = el("quiz-settings-sheet");
  if (sheet) {
    sheet.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
  }
}

function closeQuizSettingsSheet() {
  const sheet = el("quiz-settings-sheet");
  if (sheet) {
    sheet.classList.add("hidden");
    sheet.setAttribute("aria-hidden", "true");
  }
}

function bindQuizSettingsSheet() {
  el("btn-quiz-settings")?.addEventListener("click", () => {
    openQuizSettingsSheet();
  });
  el("quiz-settings-close")?.addEventListener("click", closeQuizSettingsSheet);
  el("quiz-settings-backdrop")?.addEventListener("click", closeQuizSettingsSheet);

  el("qs-play-quiz")?.addEventListener("click", () => {
    state.settings.playMode = "quiz";
    persistApp();
    syncQuizSettingsPanel();
  });
  el("qs-play-training")?.addEventListener("click", () => {
    state.settings.playMode = "continuous";
    persistApp();
    syncQuizSettingsPanel();
  });
  el("qs-fb-each")?.addEventListener("click", () => {
    state.settings.feedbackTiming = "each";
    persistApp();
    syncQuizSettingsPanel();
  });
  el("qs-fb-end")?.addEventListener("click", () => {
    state.settings.feedbackTiming = "end";
    persistApp();
    syncQuizSettingsPanel();
  });
}

/** @deprecated Alias — alle Aufrufer nutzen dieselbe Analyse-Ansicht inkl. Durchgänge. */
function renderStats() {
  renderStatsView();
}

function init() {
  state.appBlob = loadAppBlob();
  syncStateFromBlob();
  updateOnlineBadge();
  setModeButtonsEnabled(false);
  el("menu-meta").textContent = "Fragen werden geladen…";

  loadData()
    .then((data) => {
      state.flat = flattenQuestions(data);
      state.categories = extractCategories(data);
      buildCategoryTiles();
      if (!state.flat.length) {
        el("load-error").textContent =
          "Keine Fragen in der JSON-Datei. Bitte extract_grundkenntnistest.py ausführen.";
        el("load-error").classList.remove("hidden");
        return;
      }
      el("menu-meta").textContent = `${state.flat.length} Fragen geladen`;
      setModeButtonsEnabled(true);
      persistAppIfMigratedFromLegacy();
      updateOnlineBadge();
      syncQuizSettingsPanel();
    })
    .catch((e) => {
      el("load-error").innerHTML =
        `Daten konnten nicht geladen werden. Im Projektordner einen Server starten und <code>/</code> öffnen:<br><code style="font-size:0.85rem">python3 -m http.server 8765</code> → <code>http://localhost:8765/</code><br><small>${String(e.message || e)}</small>`;
      el("load-error").classList.remove("hidden");
      el("menu-meta").textContent = "Laden fehlgeschlagen";
    });

  el("btn-random").addEventListener("click", startStratifiedRandom);
  el("btn-weighted").addEventListener("click", startStratifiedWeighted);
  el("btn-next").addEventListener("click", nextQuestion);
  el("btn-quiz-exit")?.addEventListener("click", handleActiveQuizBack);
  el("btn-done-menu").addEventListener("click", handleQuizDoneOrExit);

  const btnOpenStats = el("btn-open-stats");
  if (btnOpenStats) btnOpenStats.addEventListener("click", openStats);
  const btnStatsBack = el("btn-stats-back");
  if (btnStatsBack) btnStatsBack.addEventListener("click", handleQuizDoneOrExit);
  const statsSort = el("stats-sort");
  if (statsSort) statsSort.addEventListener("change", renderStatsView);
  const statsFilter = el("stats-filter");
  if (statsFilter) statsFilter.addEventListener("change", renderStatsView);
  const statsRunPicker = el("stats-run-picker");
  if (statsRunPicker) statsRunPicker.addEventListener("change", renderStatsView);
  const btnDeleteSelectedRun = el("btn-delete-selected-run");
  if (btnDeleteSelectedRun) btnDeleteSelectedRun.addEventListener("click", deleteSelectedRun);

  const btnRunsClear = el("btn-runs-clear-all");
  if (btnRunsClear) btnRunsClear.addEventListener("click", deleteAllRuns);

  bindQuizSettingsSheet();
  syncQuizSettingsPanel();

  // Zero UI Navigation
  el("menu-trigger")?.addEventListener("click", openMenu);
  el("menu-close")?.addEventListener("click", closeMenu);
  el("nav-overlay")?.addEventListener("click", (e) => {
    if (e.target.classList.contains("nav-link")) {
      e.preventDefault();
      switchTab(e.target.dataset.screen);
    }
    if (e.target.id === "nav-overlay") closeMenu();
  });
  
  // Keyboard support for minimalist UI
  document.addEventListener("keydown", (e) => {
    if (!el("screen-quiz-active").classList.contains("hidden")) {
      if (state.revealed) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          nextQuestion();
        }
        return;
      }
      const map = { 1: "a", 2: "b", 3: "c", 4: "d", a: "a", b: "b", c: "c", d: "d" };
      const letter = map[e.key.toLowerCase()];
      if (letter) pickOption(letter);
    }
    
    if (e.key === "Escape") {
      const statsModal = el("stats-modal");
      if (statsModal && !statsModal.classList.contains("hidden")) {
        el("stats-modal-close")?.click();
        return;
      }
      const sheet = el("quiz-settings-sheet");
      if (sheet && !sheet.classList.contains("hidden")) {
        closeQuizSettingsSheet();
        return;
      }
      closeMenu();
    }
  });

  initStatsModal();

  const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
  if (
    hash === "practice" ||
    hash === "lernen" ||
    hash === "overview" ||
    hash === "ubersicht" ||
    hash === "übersicht"
  ) {
    switchTab("practice");
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch (_) {
      /* ignore */
    }
  } else {
    switchTab("quiz");
  }
}

function startTimer() {
  stopTimer();
  state.startTime = Date.now();
  state.timerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  const timerEl = el("quiz-timer");
  if (!timerEl || !state.startTime) return;
  const diff = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showStatsModal(id) {
  const q = state.flat.find((x) => String(x.id) === String(id));
  if (!q) return;

  const title = el("stats-modal-title");
  if (title) {
    title.textContent =
      q.number_in_pdf != null ? `Frage Nr. ${q.number_in_pdf}` : `Frage ${q.id}`;
  }
  const stemEl = el("stats-modal-stem");
  if (!stemEl) return;
  stemEl.textContent = q.question || "";

  const imgWrap = el("stats-modal-img-wrap");
  if (!imgWrap) return;
  imgWrap.innerHTML = "";
  let needsImg = false;
  const stemFile = q.question_image && typeof q.question_image === "string" ? q.question_image.trim() : "";
  if (stemFile) {
    const img = document.createElement("img");
    img.src = assetUrl(stemFile);
    img.alt = "Abbildung zur Frage";
    img.className = "cheat-modal-stem-img";
    imgWrap.appendChild(img);
    needsImg = true;
  }
  imgWrap.classList.toggle("hidden", !needsImg);

  const optsBox = el("stats-modal-options");
  if (!optsBox) return;
  optsBox.innerHTML = "";
  optsBox.classList.toggle("cheat-modal-options--images", !!q.options_are_images);

  const isImage = !!q.options_are_images;
  const correctLetter = String(q.correct_answer || "")
    .trim()
    .toLowerCase();

  for (const letter of LETTERS) {
    const row = document.createElement("div");
    row.className = "cheat-modal-opt";
    const isCorrect = letter === correctLetter;
    if (isCorrect) row.classList.add("cheat-modal-opt--correct");

    const lab = document.createElement("span");
    lab.className = "cheat-modal-opt-letter";
    lab.textContent = `${letter.toUpperCase()})`;

    const body = document.createElement("div");
    body.className = "cheat-modal-opt-body";

    if (isImage && q.images && q.images[letter]) {
      const img = document.createElement("img");
      img.className = "cheat-modal-opt-img";
      img.src = assetUrl(q.images[letter]);
      img.alt = `Antwort ${letter.toUpperCase()}`;
      body.appendChild(img);
    } else {
      const t = q.options && q.options[letter];
      const p = document.createElement("p");
      p.className = "cheat-modal-opt-text";
      p.textContent = t != null && t !== "" ? t : "—";
      body.appendChild(p);
    }

    row.appendChild(lab);
    row.appendChild(body);
    if (isCorrect) {
      const badge = document.createElement("span");
      badge.className = "cheat-modal-opt-badge";
      badge.textContent = "richtig";
      row.appendChild(badge);
    }
    optsBox.appendChild(row);
  }

  if (q.note && isImage) {
    const note = document.createElement("p");
    note.className = "cheat-modal-note";
    note.textContent = q.note;
    optsBox.appendChild(note);
  }

  const modal = el("stats-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }
  el("stats-modal-close")?.focus();
}

function initStatsModal() {
  const modal = el("stats-modal");
  const close = el("stats-modal-close");
  const hide = () => {
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  };
  if (close) {
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      hide();
    });
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hide();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      hide();
    }
  });
}

init();
