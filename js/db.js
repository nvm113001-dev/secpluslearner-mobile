// IndexedDB layer -- mirrors the desktop app's quiz.db schema (questions /
// progress / sessions) closely enough that the SRS and fuzzy-match logic
// ported from app/srs.py and app/fuzzy.py needed no behavioral changes.

const DB_NAME = "secpluslearner";
const DB_VERSION = 2;
const QUESTIONS_JSON_URL = "./questions.json";

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("questions")) {
        const qs = db.createObjectStore("questions", { keyPath: "id" });
        qs.createIndex("domain", "domain");
        qs.createIndex("type", "type");
        qs.createIndex("source", "source");
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "question_id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      // Master-mode learning periods: each period is a campaign covering a
      // (possibly domain-filtered) scope of the question set. It stays
      // "active" (completed_at === null) until every question in scope has
      // reached mastery status 2 -- see mastery.js for the state machine.
      if (!db.objectStoreNames.contains("periods")) {
        db.createObjectStore("periods", { keyPath: "id", autoIncrement: true });
      }
      // One row per (period, question): status 0 = not started / needs its
      // first pass, 1 = first pass done (needs the typed retry), 2 = mastered.
      if (!db.objectStoreNames.contains("mastery")) {
        const ms = db.createObjectStore("mastery", { keyPath: ["period_id", "question_id"] });
        ms.createIndex("period_id", "period_id");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeNames, mode = "readonly") {
  return _db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function init() {
  _db = await openDB();
  const metaTx = tx(["meta"]);
  const seeded = await reqToPromise(metaTx.objectStore("meta").get("seeded"));
  if (!seeded) {
    await seedQuestions();
  }
}

async function seedQuestions() {
  const resp = await fetch(QUESTIONS_JSON_URL);
  const questions = await resp.json();
  const t = tx(["questions", "meta"], "readwrite");
  const qStore = t.objectStore("questions");
  for (const q of questions) {
    qStore.put(q);
  }
  t.objectStore("meta").put({ key: "seeded", value: true, count: questions.length });
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// ---------------------------------------------------------------- questions

async function getAllQuestions() {
  const t = tx(["questions"]);
  return reqToPromise(t.objectStore("questions").getAll());
}

async function getQuestion(id) {
  const t = tx(["questions"]);
  return reqToPromise(t.objectStore("questions").get(id));
}

async function getQuestionsByIds(ids) {
  const t = tx(["questions"]);
  const store = t.objectStore("questions");
  const results = await Promise.all(ids.map((id) => reqToPromise(store.get(id))));
  return results.filter(Boolean);
}

async function putQuestion(q) {
  const t = tx(["questions", "progress"], "readwrite");
  const isNew = q.id == null;
  if (isNew) {
    // emulate AUTOINCREMENT: one more than the current max id
    const all = await reqToPromise(t.objectStore("questions").getAllKeys());
    q.id = all.length ? Math.max(...all) + 1 : 1;
  }
  t.objectStore("questions").put(q);
  if (isNew) {
    t.objectStore("progress").put({ question_id: q.id, times_correct: 0, times_seen: 0,
      last_seen: null, interval_days: 1, ease_factor: 2.5, due_date: todayISO(), struggle_count: 0 });
  }
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  return q.id;
}

async function deleteQuestion(id) {
  const t = tx(["questions", "progress"], "readwrite");
  t.objectStore("questions").delete(id);
  t.objectStore("progress").delete(id);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

async function getAllDomains() {
  const qs = await getAllQuestions();
  return [...new Set(qs.map((q) => q.domain))].sort();
}

async function getAllSources() {
  const qs = await getAllQuestions();
  return [...new Set(qs.map((q) => q.source))].sort();
}

// ---------------------------------------------------------------- progress

async function getProgress(questionId) {
  const t = tx(["progress"]);
  return reqToPromise(t.objectStore("progress").get(questionId));
}

async function getAllProgress() {
  const t = tx(["progress"]);
  return reqToPromise(t.objectStore("progress").getAll());
}

async function putProgress(p) {
  const t = tx(["progress"], "readwrite");
  t.objectStore("progress").put(p);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

// ---------------------------------------------------------------- sessions

async function addSession(session) {
  const t = tx(["sessions"], "readwrite");
  t.objectStore("sessions").add({ ...session, date: new Date().toISOString() });
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

async function getRecentSessions(limit = 10) {
  const t = tx(["sessions"]);
  const all = await reqToPromise(t.objectStore("sessions").getAll());
  return all.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
}

// ---------------------------------------------------------------- periods / mastery (Learn "Master Mode")

async function addPeriod(period) {
  const t = tx(["periods"], "readwrite");
  const id = await reqToPromise(t.objectStore("periods").add(period));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  return id;
}

async function putPeriod(period) {
  const t = tx(["periods"], "readwrite");
  t.objectStore("periods").put(period);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

async function getPeriod(id) {
  const t = tx(["periods"]);
  return reqToPromise(t.objectStore("periods").get(id));
}

async function getLatestPeriod() {
  const t = tx(["periods"]);
  const all = await reqToPromise(t.objectStore("periods").getAll());
  if (!all.length) return null;
  return all.reduce((a, b) => (b.id > a.id ? b : a));
}

async function putMasteryRows(rows) {
  const t = tx(["mastery"], "readwrite");
  const store = t.objectStore("mastery");
  for (const r of rows) store.put(r);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

async function getMasteryRow(periodId, questionId) {
  const t = tx(["mastery"]);
  return reqToPromise(t.objectStore("mastery").get([periodId, questionId]));
}

async function getMasteryRowsByPeriod(periodId) {
  const t = tx(["mastery"]);
  return reqToPromise(t.objectStore("mastery").index("period_id").getAll(periodId));
}

// ---------------------------------------------------------------- helpers

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

window.DB = {
  init, getAllQuestions, getQuestion, getQuestionsByIds, putQuestion, deleteQuestion,
  getAllDomains, getAllSources, getProgress, getAllProgress, putProgress,
  addSession, getRecentSessions, todayISO,
  addPeriod, putPeriod, getPeriod, getLatestPeriod,
  putMasteryRows, getMasteryRow, getMasteryRowsByPeriod,
};
