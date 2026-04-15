/**
 * Themenüberblick: kompakter Spickzettel aus dem Katalog (JSON).
 * Kürzungen sollen inhaltlich lesbar bleiben; Nr.-Links öffnen die volle Frage.
 */

const LETTERS = ["a", "b", "c", "d"];

const CATEGORY_INTRO = {
  "1": `**Bundesversammlung** = Nationalrat und Ständerat zusammen; beide beraten und beschliessen Bundesrecht. **Nationalrat**: wird vom Volk proportional gewählt (grössere Kantone mehr Sitze). **Ständerat**: vertritt die Kantone (voller Kanton je 2 Sitze, «Halbkantone» je 1; insgesamt 46). **Bundesrat**: sieben gewählte Regierungsmitglieder, wichtige Entscheide gemeinsam (Kollegialität). **Bundeskanzlei**: unterstützt Parlament und Bundesrat organisatorisch, **regiert nicht** selbst. **Föderalismus**: Staatsaufgaben sind auf Bund, Kantone und Gemeinden verteilt.`,
  "2": `**Sozialstaat**: z. B. AHV/IV (Alter, Hinterlassene, Invalidität), obligatorische Krankenversicherung, Erwerbsersatz bei Krankheit — Grundlagen oft eidgenössisch, Umsetzung teils kantonal. **Zivilgesellschaft**: Vereine, Petitionen, bürgerschaftliches Engagement.`,
  "3": `Geschichte in Stichworten: 1848 moderner Bundesstaat, Neutralität, Frauenstimmrecht Bund 1971, Gleichstellung von Frau und Mann in der Verfassung 1981; Zürich/Reformation und weitere Fakten in den Listen unten.`,
  "4": `Geografie Schweiz und Kanton Zürich: Nachbarstaaten, Gewässer, Alpen/Mittelland, typische Zahlen und Orte aus dem Katalog.`,
  "5": `Landessprachen, Feiertage, Bräuche, Medien, Sport und Alltagskultur — komprimiert aus dem Fragenkatalog.`,
};

const STOP = new Set(
  "was ist sind bedeutet heisst heißt wie wer wann wo welche welcher welches womit wozu eine einer einem den der die das des dem ein und oder mit ohne von zu im am an aus auf als ob es sie er ihm ihr ihre".split(
    " "
  )
);

/** Lesbare Kurzlabels links vom Pfeil (semantische Aggregation, keine Wortreste). */
const LEFT_LABEL = {
  "m:grenz": "Grenzgänger/in",
  "m:neutral": "Neutralität der Schweiz",
  "m:aufg-bund": "Aufgabe des Bundes",
  "m:aufg-kant": "Aufgabe Kanton Zürich",
  "m:aufg-gem": "Aufgabe Zürcher Gemeinden",
  "m:grundrecht-ch": "Grundrecht in der Schweiz",
  "m:pflichten-ch": "Pflichten von Einwohner/innen",
  "m:kantone-anzahl": "Anzahl Kantone Schweiz",
  "m:gemeinden-anzahl-ch": "Anzahl politische Gemeinden Schweiz",
  "m:gemeinden-anzahl-zh": "Anzahl Gemeinden Kanton Zürich",
  "m:bezirke-zh": "Anzahl Bezirke Kanton Zürich",
  "m:rr-anzahl-zh": "Anzahl Regierungsräte Kanton Zürich",
  "m:stadtrat-zh": "Exekutive Stadt Zürich",
  "m:drei-staatsebenen": "Drei Staatsebenen",
  "m:staatsebene-militaer": "Staatsebene für Militär",
  "m:gewaltmonopol": "Gewaltmonopol",
  "m:bund-wofuer": "Bund zuständig für",
  "m:kantone-wofuer": "Kantone zuständig für",
  "m:gemeinden-wofuer": "Gemeinden zuständig für",
  "m:bund-drei-gewalten": "Bund zuständig für (drei Gewalten)",
  "m:landessprachen-liste": "Landessprachen Schweiz",
  "m:landessprachen-anzahl": "Anzahl Landessprachen Schweiz",
  "m:parlament-kammern": "Zwei Parlamentskammern",
  "m:exekutive-bund": "Exekutive Bund",
  "m:initiative-unterschriften": "Unterschriften Volksinitiative Bund",
  "m:staenderat-aufgabe": "Aufgabe Ständerat",
  "m:nr-st-gemeinsam": "Nationalrat und Ständerat gemeinsam",
  "m:gesetze-zustaendigkeit": "Gesetze: Miete, ZGB, Strafrecht",
  "m:landessprache-vierte": "Vierte Landessprache",
};

const RIGHT_FIXED = {
  "m:neutral": "keine Einmischung in fremde bewaffnete Konflikte",
  "m:grenz": "im Ausland wohnen, in der Schweiz arbeiten",
  "m:drei-staatsebenen": "Bund, Kanton, Gemeinde (von oben nach unten)",
};

/**
 * Wenn die Frage keinen eigenen Merge-Key hat: sinnvoller Listen-Titel statt
 * abgeschnittener Fragewort-Fetzen (normierte Frage, klein).
 */
const SEMANTIC_AGG_LABELS = [
  [/wie\s+viele\s+kantone.*bundesstaat/i, "Anzahl Kantone Schweiz"],
  [/wie\s+viele\s+politische\s+gemeinden.*schweiz/i, "Anzahl politische Gemeinden Schweiz"],
  [/wie\s+viele\s+gemeinden.*im\s+kanton\s+zürich|gemeinden.*kanton\s+zürich/i, "Anzahl Gemeinden Kanton Zürich"],
  [/wie\s+viele\s+bezirke.*kanton\s+zürich/i, "Anzahl Bezirke Kanton Zürich"],
  [/wie\s+viele\s+regierungsräte.*kanton\s+zürich/i, "Anzahl Regierungsräte Kanton Zürich"],
  [/wie\s+viele\s+mitglieder.*regierung.*kanton\s+zürich/i, "Anzahl Regierungsräte Kanton Zürich"],
  [/wie\s+viele\s+personen.*kanton\s+zürich.*ständerat/i, "Ständeratssitze Kanton Zürich"],
  [/welche\s+staatsebene.*militär|für\s+das\s+militär.*zuständig|militär.*zuständig/i, "Staatsebene für Militär"],
  [/drei\s+staatsebenen|föderalistischer\s+staat\s+mit\s+drei/i, "Drei Staatsebenen"],
  [/gewaltmonopol|gewalt\s+gegen\s+menschen.*ausüben/i, "Gewaltmonopol"],
  [/für\s+was\s+ist\s+der\s+bund\s+zuständig/i, "Bund zuständig für"],
  [/für\s+was\s+sind\s+die\s+kantone/i, "Kantone zuständig für"],
  [/für\s+was\s+sind\s+die\s+gemeinden/i, "Gemeinden zuständig für"],
  [/wer\s+hat\s+auf\s+bundesebene\s+die\s+(richterliche|gesetzgebende|ausführende)\s+gewalt/i, "Bund zuständig für (drei Gewalten)"],
  [/was\s+sind\s+die\s+landessprachen/i, "Landessprachen Schweiz"],
  [/wie\s+viele\s+offizielle\s+landessprachen/i, "Anzahl Landessprachen Schweiz"],
  [/was\s+ist\s+die\s+vierte\s+landessprache/i, "Vierte Landessprache"],
  [/was\s+ist\s+eine\s+offizielle\s+landessprache/i, "Landessprache (einzeln)"],
  [/wie\s+heissen\s+die\s+beiden.*kammern/i, "Zwei Parlamentskammern"],
  [/wie\s+heisst\s+die\s+exekutive.*bundesebene|exekutive.*schweiz\s+auf\s+bundesebene/i, "Exekutive Bund"],
  [/wie\s+viele\s+unterschriften.*volksinitiative.*bund/i, "Unterschriften Volksinitiative Bund"],
  [/was\s+ist\s+die\s+aufgabe\s+des\s+ständerates/i, "Aufgabe Ständerat"],
  [/was\s+machen\s+nationalrat\s+und\s+ständerat\s+gemeinsam/i, "Nationalrat und Ständerat gemeinsam"],
  [/wer\s+beschliesst.*bundesebene\s+neue\s+gesetze/i, "Gesetzgebung Bund (neue Gesetze)"],
  [/wer\s+beschliesst.*grossteil.*neuen\s+gesetze.*bundesebene/i, "Gesetzgebung Bund (Grossteil der Gesetze)"],
  [/wer\s+darf\s+auf\s+bundesebene\s+wählen/i, "Wahl und Abstimmung auf Bundesebene"],
  [/ab\s+wann.*bundesebene\s+stimm/i, "Stimmalter Bundesebene"],
  [/wer\s+kann.*bundesebene.*politisches\s+amt/i, "Wählbarkeit politische Ämter Bund"],
  [/über\s+was.*bundesebene\s+abstimmen/i, "Abstimmungsgegenstände Bundesebene"],
  [/was\s+ist\s+die\s+zentrale\s+aufgabe\s+der\s+bundesversammlung/i, "Aufgabe Bundesversammlung"],
  [/wie\s+setzt\s+sich\s+die\s+vereinigte\s+bundesversammlung/i, "Vereinigte Bundesversammlung"],
  [/das\s+bundeshaus.*sitz/i, "Sitz Bundeshaus"],
  [/wer\s+wählt.*sieben\s+mitglieder\s+des\s+bundesrats/i, "Wahl des Bundesrats"],
  [/welche\s+funktion.*parteien.*demokratie/i, "Rolle der Parteien"],
  [/wann\s+ist\s+eine\s+initiative.*bundesebene\s+angenommen/i, "Annahme Volksinitiative Bund"],
  [/wie\s+stimmen\s+die\s+meisten\s+stimberechtigten/i, "Abstimmungsmodus (Mehrheit)"],
  [/an\s+welchem\s+wochentag.*wahlen.*abstimmungen/i, "Wochentag nationale Urnen"],
  [/was\s+bezeichnet\s+man.*vierte\s+gewalt/i, "Vierte Gewalt"],
  [/was\s+bedeutet\s+gewaltenteilung/i, "Gewaltenteilung"],
  [/die\s+schweiz\s+ist\s+ein\s+rechtsstaat/i, "Rechtsstaat (Bedeutung)"],
  [/was\s+bedeutet\s+ständemehr/i, "Ständemehr"],
  [/was\s+bedeutet\s+rechtsgleichheit/i, "Rechtsgleichheit"],
  [/was\s+ist\s+ein\s+wichtiges\s+merkmal\s+der\s+demokratie/i, "Merkmal Demokratie"],
  [/warum.*demokratie.*wahlen/i, "Wahlen in der Demokratie"],
  [/was\s+ist\s+eine\s+partei/i, "Politische Partei"],
  [/was\s+ist\s+ein\s+departement\s+der\s+bundesverwaltung/i, "Departement Bundesverwaltung"],
  [/kollegialitätsprinzip/i, "Kollegialitätsprinzip Bundesrat"],
  [/können.*stimmbürger.*gesetz\s+stoppen|neues\s+gesetz\s+stoppen/i, "Gesetz stoppen (Referendum)"],
  [/was\s+macht.*bundeskanzler/i, "Rolle Bundeskanzlei"],
  [/welche\s+politischen\s+rechte.*ausland/i, "Politische Rechte Auslandschweizer"],
  [/wer.*wählen.*abstimmen.*will.*schweiz/i, "Wahlberechtigung in der Schweiz"],
  [/wie\s+heisst\s+die\s+verfassung.*eidgenossenschaft/i, "Name Bundesverfassung"],
  [/wer\s+führt\s+die\s+regierungsgeschäfte/i, "Regierungsführung Schweiz"],
  [/was\s+bedeutet\s+aktives\s+wahlrecht/i, "Aktives Wahlrecht"],
  [/wie\s+können.*einfluss.*gesetzgebung/i, "Einfluss auf Gesetzgebung"],
  [/gegen\s+was.*referendum/i, "Referendum (Gegenstand)"],
  [/volksinitiative.*wichtiges\s+politisches\s+recht/i, "Bedeutung Volksinitiative"],
  [/wie\s+oft.*bundesparlament\s+wählen/i, "Wahlperiode Bundesparlament"],
  [/bundesversammlung.*246.*mitglieder.*wer\s+wählt/i, "Wahl der Bundesparlamentarier"],
  [/wie\s+heisst.*exekutive.*stadt\s+zürich/i, "Exekutive Stadt Zürich"],
  [/wie\s+heisst.*parlament.*kanton\s+zürich/i, "Parlament Kanton Zürich"],
  [/wie\s+heisst.*exekutive.*kanton\s+zürich/i, "Exekutive Kanton Zürich"],
  [/wie\s+werden.*mitglieder.*zürcher\s+regierung/i, "Wahl Zürcher Regierung"],
  [/wie\s+werden.*kantonsrats.*bestimmt/i, "Wahl Kantonsrat Zürich"],
  [/was\s+passiert.*gemeindeversammlung/i, "Gemeindeversammlung"],
  [/wer\s+wählt.*gemeinderat.*stadt\s+zürich/i, "Wahl Gemeinderat Stadt Zürich"],
  [/wer\s+erteilt.*baubewilligung.*einfamilienhaus/i, "Baubewilligung Einfamilienhaus"],
  [/wer\s+darf\s+motorfahrzeuge.*zulassen/i, "Fahrzeugzulassung"],
  [/wer\s+stellt.*führerausweise/i, "Führerausweis Kanton Zürich"],
  [/in\s+der\s+schweiz\s+gibt\s+es\s+verschiedene\s+gesetze/i, "Zuständigkeit Gesetzbücher (Miete/ZGB/Straf)"],
  [/wie\s+werden.*richter.*bundesgericht/i, "Wahl Bundesgerichtsrichter"],
  [/dürfen.*ausgeliefert/i, "Auslieferung"],
  [/von\s+was\s+hängt.*steuerbelastung/i, "Steuerbelastung"],
  [/was\s+gehört.*kantonssteuern.*gemeindesteuern/i, "Kantons- und Gemeindesteuern"],
  [/was\s+will.*finanzausgleich.*gemeinden/i, "Finanzausgleich Gemeinden"],
  [/wer\s+muss.*militärdienst|zivilschutz/i, "Militär-/Zivilschutzdienst"],
  [/welche\s+pflicht.*nur\s+für\s+männer/i, "Pflichten nur Männer"],
];

function semanticAggregatedLabelFromQuestion(s) {
  if (!s || typeof s !== "string") return null;
  const x = s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [re, lab] of SEMANTIC_AGG_LABELS) {
    if (re.test(x)) return lab;
  }
  return null;
}

/** Frage Nr. (PDF) → Rohfrage aus JSON (global nach Laden). */
let cheatByPdf = {};

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

function buildCheatIndex(data) {
  cheatByPdf = {};
  for (const cat of data.categories || []) {
    for (const sub of cat.subsections || []) {
      for (const q of sub.questions || []) {
        if (q.number_in_pdf != null) {
          cheatByPdf[q.number_in_pdf] = q;
        }
      }
    }
  }
}

function answerSummary(q) {
  const c = String(q.correct_answer || "a")
    .toLowerCase()
    .slice(0, 1);
  if (q.options_are_images) {
    const note = q.note ? ` — ${String(q.note).replace(/\s+/g, " ").trim()}` : "";
    return `Kartenwahl ${c.toUpperCase()}${note}`;
  }
  const t = q.options && q.options[c];
  const text = (t != null && String(t).trim()) || c.toUpperCase();
  return text.replace(/\s+/g, " ").trim();
}

function correctOptionText(q) {
  const c = String(q.correct_answer || "a").toLowerCase().slice(0, 1);
  const t = q.options && q.options[c];
  return (t != null && String(t).trim()) || "";
}

/**
 * Kurzlabel für die *richtige* Antwort, das man ohne Vorwissen versteht
 * (kein Abhacken nach vier Worten bei «Er sorgt für die …»).
 */
function semanticAnswerChip(q) {
  if (q.options_are_images) {
    const c = String(q.correct_answer || "a").toUpperCase();
    const note = q.note ? ` (${String(q.note).replace(/\s+/g, " ").trim()})` : "";
    return `Kartenfrage: Lösung ${c}${note}`;
  }

  let t = correctOptionText(q).replace(/\s+/g, " ").trim();
  t = t.replace(/\([^)]{4,}\)/g, "").trim();

  // «Er sorgt für die/den/das …» → Kerninhalt (Aufgabenformulierungen im Katalog)
  const erSorgt = /^er\s+sorgt\s+für\s+(die\s+|den\s+|das\s+)?(.+)$/i.exec(t);
  if (erSorgt) {
    let core = erSorgt[2].replace(/\.$/, "").trim();
    const firstSeg = core.split(/[,;]/)[0].trim();
    core = firstSeg.length >= 4 ? firstSeg : core;
    if (core.length > 56) core = `${core.slice(0, 53).trim()}…`;
    return core.toLowerCase();
  }

  // «Eine Person, die …» (z. B. Grenzgänger-Erklärung)
  const personDie = /^eine\s+person,?\s+die\s+/i.exec(t);
  if (personDie) {
    const rest = t.slice(personDie[0].length).trim();
    const seg = rest.split(/[,;.]/)[0].trim();
    const out = seg.length >= 6 ? seg : rest.slice(0, 70);
    return out.length > 60 ? `${out.slice(0, 57).trim()}…` : out.toLowerCase();
  }

  // Kurzantworten (typische Multiple-Choice-Nomen)
  if (t.length <= 44) return t.toLowerCase();

  // Längere Sätze: bevorzugt ersten Satz / ersten Halbsatz
  const first = t.split(/(?<=[.!?])\s+/)[0]?.trim() || t;
  if (first.length <= 56) return first.toLowerCase();
  const words = first.split(/\s+/);
  const shortened = words.slice(0, 10).join(" ");
  return `${shortened}…`.toLowerCase();
}

function normQ(q) {
  return (q.question || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeMergeKey(q) {
  const t = normQ(q);

  if (/wie\s+viele\s+kantone.*bundesstaat/i.test(t)) return "m:kantone-anzahl";
  if (/wie\s+viele\s+politische\s+gemeinden.*schweiz/i.test(t)) return "m:gemeinden-anzahl-ch";
  if (/wie\s+viele\s+gemeinden.*kanton\s+zürich/i.test(t)) return "m:gemeinden-anzahl-zh";
  if (/wie\s+viele\s+bezirke.*kanton\s+zürich/i.test(t)) return "m:bezirke-zh";
  if (/wie\s+viele\s+regierungsräte.*kanton\s+zürich/i.test(t)) return "m:rr-anzahl-zh";
  if (/wie\s+viele\s+mitglieder.*regierung.*kanton\s+zürich/i.test(t)) return "m:rr-anzahl-zh";
  if (/wie\s+heisst.*stadt\s+zürich.*exekutive|exekutive.*stadt\s+zürich/i.test(t)) return "m:stadtrat-zh";

  if (/drei\s+staatsebenen|föderalistischer\s+staat\s+mit\s+drei/i.test(t)) return "m:drei-staatsebenen";
  if (/welche\s+staatsebene.*für\s+das\s+militär|für\s+das\s+militär.*zuständig/i.test(t))
    return "m:staatsebene-militaer";
  if (/gewaltmonopol|gewalt\s+gegen\s+menschen.*ausüben/i.test(t)) return "m:gewaltmonopol";

  if (/für\s+was\s+ist\s+der\s+bund\s+zuständig/i.test(t)) return "m:bund-wofuer";
  if (/für\s+was\s+sind\s+die\s+kantone/i.test(t)) return "m:kantone-wofuer";
  if (/für\s+was\s+sind\s+die\s+gemeinden/i.test(t)) return "m:gemeinden-wofuer";

  if (/wer\s+hat\s+auf\s+bundesebene\s+die\s+(richterliche|gesetzgebende|ausführende)\s+gewalt/i.test(t))
    return "m:bund-drei-gewalten";

  if (/was\s+sind\s+die\s+landessprachen/i.test(t)) return "m:landessprachen-liste";
  if (/wie\s+viele\s+offizielle\s+landessprachen/i.test(t)) return "m:landessprachen-anzahl";

  if (/wie\s+heissen\s+die\s+beiden.*kammern/i.test(t)) return "m:parlament-kammern";
  if (/wie\s+heisst\s+die\s+exekutive.*bundesebene|exekutive.*schweiz\s+auf\s+bundesebene/i.test(t))
    return "m:exekutive-bund";
  if (/wie\s+viele\s+unterschriften.*volksinitiative.*bund/i.test(t)) return "m:initiative-unterschriften";
  if (/was\s+ist\s+die\s+aufgabe\s+des\s+ständerates/i.test(t)) return "m:staenderat-aufgabe";
  if (/was\s+machen\s+nationalrat\s+und\s+ständerat\s+gemeinsam/i.test(t)) return "m:nr-st-gemeinsam";
  if (/in\s+der\s+schweiz\s+gibt\s+es\s+verschiedene\s+gesetze/i.test(t)) return "m:gesetze-zustaendigkeit";
  if (/was\s+ist\s+die\s+vierte\s+landessprache/i.test(t)) return "m:landessprache-vierte";

  if (/grenzgäng|grenzganger/i.test(t)) return "m:grenz";
  if (/neutral/.test(t) && (/schweiz|confoederatio|\bch\b|eidgenoss/i.test(t) || /was heisst/.test(t)))
    return "m:neutral";
  if (/was\s+ist\s+/.test(t) && /aufgabe/.test(t) && (/bundesstaat|des\s+bundes|\bbund\b/.test(t)))
    return "m:aufg-bund";
  if (/was\s+ist\s+/.test(t) && /aufgabe/.test(t) && /kanton.*zürich|zürich.*kanton/i.test(t))
    return "m:aufg-kant";
  if (/was\s+ist\s+/.test(t) && /aufgabe/.test(t) && /gemeinden/i.test(t)) return "m:aufg-gem";
  if (/was\s+ist\s+ein\s+grundrecht.*schweiz/i.test(t)) return "m:grundrecht-ch";
  if (/welche\s+pflichten.*einwohner.*schweiz/i.test(t)) return "m:pflichten-ch";

  let s = t.replace(/^was\s+(ist|sind|bedeutet|heisst|heißt)\s+/i, "");
  s = s.replace(/^welche\s+/i, "");
  s = s.replace(/\?+$/g, "").trim();
  return `raw:${s.slice(0, 56)}`;
}

function leftLabelForKey(key, firstQ) {
  if (LEFT_LABEL[key]) return LEFT_LABEL[key];
  if (key.startsWith("raw:")) {
    const fromFull = firstQ ? semanticAggregatedLabelFromQuestion(firstQ.question || "") : null;
    if (fromFull) return fromFull;
    const fromSlice = semanticAggregatedLabelFromQuestion(key.slice(4));
    if (fromSlice) return fromSlice;
    const words = key
      .slice(4)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .slice(0, 5);
    const s = words.join(" ");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Thema";
  }
  return compressGeneric(firstQ);
}

function compressGeneric(q) {
  const words = normQ(q)
    .replace(/[?.!,;:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 5);
  const s = words.join(" ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Thema";
}

function rightBundDreiGewalten(qs) {
  const order = [...qs].sort((a, b) => (a.number_in_pdf || 0) - (b.number_in_pdf || 0));
  const parts = [];
  for (const q of order) {
    const t = normQ(q);
    let label = "";
    if (/gesetzgebende|legislative/.test(t)) label = "Legislative";
    else if (/richterliche|judikative/.test(t)) label = "Judikative";
    else if (/ausführende|exekutive/.test(t)) label = "Exekutive";
    else label = "Gewalt";
    parts.push(`${label}: ${semanticAnswerChip(q)}`);
  }
  return parts.join(" · ");
}

function rightSideForGroup(key, qs) {
  if (RIGHT_FIXED[key]) return RIGHT_FIXED[key];
  if (key === "m:bund-drei-gewalten") return rightBundDreiGewalten(qs);
  if (
    key === "m:aufg-bund" ||
    key === "m:aufg-kant" ||
    key === "m:aufg-gem" ||
    key === "m:grundrecht-ch" ||
    key === "m:pflichten-ch" ||
    key === "m:landessprachen-liste" ||
    key === "m:landessprachen-anzahl" ||
    key === "m:gesetze-zustaendigkeit"
  ) {
    const tags = [];
    const seen = new Set();
    for (const q of qs) {
      const chip = semanticAnswerChip(q);
      const k = chip.replace(/\s+/g, " ").toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        tags.push(chip);
      }
    }
    return tags.join(", ");
  }
  return semanticAnswerChip(qs[0]);
}

function parseBoldToNodes(text, parent) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const strong = document.createElement("strong");
      strong.textContent = parts[i];
      parent.appendChild(strong);
    } else if (parts[i]) {
      parent.appendChild(document.createTextNode(parts[i]));
    }
  }
}

function groupSubsectionQuestions(questions) {
  const map = new Map();
  for (const q of questions) {
    const k = normalizeMergeKey(q);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(q);
  }
  const rows = [];
  for (const [key, qs] of map) {
    qs.sort((a, b) => (a.number_in_pdf || 0) - (b.number_in_pdf || 0));
    rows.push({ key, qs });
  }
  rows.sort((a, b) => (a.qs[0].number_in_pdf || 0) - (b.qs[0].number_in_pdf || 0));
  return rows;
}

function appendQuestionRefButtons(li, gqs) {
  const nums = [
    ...new Set(gqs.map((q) => q.number_in_pdf).filter((n) => n != null)),
  ].sort((a, b) => a - b);
  if (!nums.length) return;

  li.appendChild(document.createTextNode(" "));
  const wrap = document.createElement("span");
  wrap.className = "cheat-q-refs";
  nums.forEach((num, i) => {
    if (i > 0) wrap.appendChild(document.createTextNode(" "));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cheat-q-ref";
    btn.dataset.pdfNum = String(num);
    btn.setAttribute("aria-label", `Frage ${num} im Detail anzeigen`);
    btn.textContent = `Nr. ${num}`;
    wrap.appendChild(btn);
  });
  li.appendChild(wrap);
}

function setupCategoryTabs(navEl, cats, rootEl) {
  if (!navEl || !cats.length || !rootEl) return;

  const sections = [...rootEl.querySelectorAll(".cheat-cat")];
  if (!sections.length) return;

  navEl.innerHTML = "";
  navEl.setAttribute("role", "tablist");
  navEl.setAttribute("aria-label", "Kategorien");

  function showCategory(catId) {
    const sid = `cat-${catId}`;
    sections.forEach((sec) => {
      const on = sec.id === sid;
      sec.hidden = !on;
    });
    navEl.querySelectorAll(".cheat-jump-tab").forEach((btn) => {
      const on = btn.dataset.catId === String(catId);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
    window.scrollTo(0, 0);
  }

  for (const cat of cats) {
    const id = String(cat.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cheat-jump-tab";
    btn.dataset.catId = id;
    btn.id = `cheat-tab-${id}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", `cat-${id}`);
    const short =
      cat.title && cat.title.length > 28 ? `${cat.title.slice(0, 26)}…` : cat.title || cat.id;
    btn.textContent = `${id}. ${short}`;
    btn.addEventListener("click", () => showCategory(id));
    navEl.appendChild(btn);
  }

  sections.forEach((sec) => {
    const id = sec.id.replace(/^cat-/, "");
    sec.setAttribute("role", "tabpanel");
    sec.setAttribute("aria-labelledby", `cheat-tab-${id}`);
  });

  showCategory(String(cats[0].id));
}

function renderCheatSheet(data, root) {
  root.innerHTML = "";
  const cats = data.categories || [];

  cats.forEach((cat, catIndex) => {
    const id = String(cat.id);
    const section = document.createElement("section");
    section.className = "cheat-cat";
    section.id = `cat-${id}`;
    section.hidden = catIndex !== 0;

    const h2 = document.createElement("h2");
    h2.className = "cheat-cat-title";
    h2.textContent = `${id}. ${cat.title || id}`;
    section.appendChild(h2);

    const intro = document.createElement("p");
    intro.className = "cheat-cat-intro";
    const introText = CATEGORY_INTRO[id];
    if (introText) {
      parseBoldToNodes(introText, intro);
    } else {
      intro.textContent = "Stichworte aus dem Fragenkatalog.";
    }
    section.appendChild(intro);

    for (const sub of cat.subsections || []) {
      const subWrap = document.createElement("div");
      subWrap.className = "cheat-sub";
      const h3 = document.createElement("h3");
      h3.textContent = `${sub.id} ${sub.title || ""}`;
      subWrap.appendChild(h3);

      const qs = sub.questions || [];
      const groups = groupSubsectionQuestions(qs);
      const ul = document.createElement("ul");
      ul.className = "cheat-bullets";

      for (const { key, qs: gqs } of groups) {
        const li = document.createElement("li");
        const left = leftLabelForKey(key, gqs[0]);
        const right = rightSideForGroup(key, gqs);
        li.appendChild(document.createTextNode(`${left} → `));
        const strong = document.createElement("strong");
        strong.textContent = right;
        li.appendChild(strong);
        appendQuestionRefButtons(li, gqs);
        ul.appendChild(li);
      }

      subWrap.appendChild(ul);
      section.appendChild(subWrap);
    }

    root.appendChild(section);
  });
}

function closeCheatModal() {
  const modal = document.getElementById("cheat-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openCheatQuestionModal(pdfNum) {
  const modal = document.getElementById("cheat-modal");
  const titleEl = document.getElementById("cheat-modal-title");
  const stemEl = document.getElementById("cheat-modal-stem");
  const imgWrap = document.getElementById("cheat-modal-img-wrap");
  const optsEl = document.getElementById("cheat-modal-options");
  if (!modal || !titleEl || !stemEl || !optsEl) return;

  const q = cheatByPdf[pdfNum];
  if (!q) {
    titleEl.textContent = `Frage Nr. ${pdfNum}`;
    stemEl.textContent = "Diese Frage ist im geladenen Katalog nicht gefunden.";
    optsEl.innerHTML = "";
    if (imgWrap) {
      imgWrap.innerHTML = "";
      imgWrap.classList.add("hidden");
    }
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    return;
  }

  titleEl.textContent = `Frage Nr. ${pdfNum}`;
  stemEl.textContent = q.question || "";

  if (imgWrap) {
    imgWrap.innerHTML = "";
    const stemImg =
      q.question_image && typeof q.question_image === "string"
        ? q.question_image.trim()
        : "";
    if (stemImg) {
      imgWrap.classList.remove("hidden");
      const img = document.createElement("img");
      img.className = "cheat-modal-stem-img cheat-sheet-modal__stem-img";
      img.src = assetUrl(stemImg);
      img.alt = "Abbildung zur Frage";
      imgWrap.appendChild(img);
    } else {
      imgWrap.classList.add("hidden");
    }
  }

  optsEl.innerHTML = "";
  const correct = String(q.correct_answer || "").toLowerCase();
  const isImage = !!q.options_are_images;
  optsEl.classList.toggle("cheat-modal-options--images", isImage);

  for (const letter of LETTERS) {
    const row = document.createElement("div");
    row.className = "cheat-modal-opt";
    const isCorrect = letter === correct;
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
    optsEl.appendChild(row);
  }

  if (q.note && isImage) {
    const note = document.createElement("p");
    note.className = "cheat-modal-note";
    note.textContent = q.note;
    optsEl.appendChild(note);
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("cheat-modal-close")?.focus();
}

function bindCheatModal(rootWrap) {
  const modal = document.getElementById("cheat-modal");
  const backdrop = document.getElementById("cheat-modal-backdrop");
  if (!modal || !backdrop) return;

  rootWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".cheat-q-ref");
    if (!btn) return;
    const n = parseInt(btn.dataset.pdfNum, 10);
    if (!Number.isFinite(n)) return;
    e.preventDefault();
    openCheatQuestionModal(n);
  });

  /** Capture + delegation: backdrop stacking / SVG hits must still close reliably. */
  modal.addEventListener(
    "click",
    (e) => {
      if (modal.classList.contains("hidden")) return;
      const t = e.target;
      if (t && typeof t.closest === "function" && t.closest("#cheat-modal-close")) {
        e.preventDefault();
        closeCheatModal();
        return;
      }
      if (t === backdrop || (backdrop && backdrop.contains(t))) {
        e.preventDefault();
        closeCheatModal();
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeCheatModal();
    }
  });
}

async function init() {
  const root = document.getElementById("cheat-root");
  const jump = document.getElementById("cheat-jump");
  const err = document.getElementById("cheat-load-error");
  const meta = document.getElementById("cheat-meta");
  const wrap =
    document.querySelector(".cheat-wrap") ||
    document.querySelector("main.content-section");
  if (!root || !wrap) return;
  try {
    const data = await loadData();
    if (err) {
      err.classList.add("hidden");
      err.textContent = "";
    }
    let n = 0;
    const cats = data.categories || [];
    for (const c of cats) {
      for (const s of c.subsections || []) {
        n += (s.questions || []).length;
      }
    }
    if (meta) {
      meta.textContent = `${n} Fragen · Stichworte; «Nr. …» = Nummer im Katalog, Klick öffnet die volle Frage mit allen Antworten.`;
    }
    buildCheatIndex(data);
    renderCheatSheet(data, root);
    setupCategoryTabs(jump, cats, root);
    bindCheatModal(wrap);
  } catch (e) {
    if (err) {
      err.classList.remove("hidden");
      err.innerHTML =
        `Daten konnten nicht geladen werden. Server im Projektordner starten:<br><code style="font-size:0.85rem">python3 -m http.server 8765</code> → <code>http://localhost:8765/uebersicht.html</code><br><small>${String(e.message || e)}</small>`;
    }
    if (meta) meta.textContent = "Laden fehlgeschlagen";
  }
}

init();
