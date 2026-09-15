// Ported 1:1 from app/srs.py -- same SM-2-simplified spaced repetition
// logic, same thresholds, same field names, just against IndexedDB instead
// of SQLite so a "due" card here means the same thing it would on desktop.

async function getDueQuestions({ domains = null, mode = "due", limit = 20 } = {}) {
  const questions = await DB.getAllQuestions();
  const progressList = await DB.getAllProgress();
  const progressById = new Map(progressList.map((p) => [p.question_id, p]));
  const today = DB.todayISO();

  let pool = questions.map((q) => {
    const p = progressById.get(q.id) || {};
    return {
      ...q,
      times_correct: p.times_correct || 0,
      times_seen: p.times_seen || 0,
      interval_days: p.interval_days || 1,
      ease_factor: p.ease_factor || 2.5,
      due_date: p.due_date || null,
      struggle_count: p.struggle_count || 0,
    };
  });

  if (mode === "due") {
    pool = pool.filter((q) => !q.due_date || q.due_date <= today);
  } else if (mode === "weak") {
    pool = pool.filter((q) => q.struggle_count >= 2);
  }

  if (domains && domains.length) {
    pool = pool.filter((q) => domains.includes(q.domain));
  }

  // Fisher-Yates shuffle then take `limit` (mirrors "ORDER BY RANDOM() LIMIT ?")
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

async function updateProgress(questionId, quality) {
  const existing = await DB.getProgress(questionId);
  const today = new Date();
  let interval, ease, struggles;

  if (!existing) {
    interval = 1; ease = 2.5; struggles = 0;
  } else {
    interval = existing.interval_days;
    ease = existing.ease_factor;
    struggles = existing.struggle_count;
  }

  let newInterval, newEase, newStruggles;
  if (quality < 3) {
    newInterval = 1;
    newEase = Math.max(1.3, ease - 0.2);
    newStruggles = struggles + 1;
  } else {
    newInterval = Math.max(1, Math.round(interval * ease));
    newEase = Math.max(1.3, ease + (0.1 - (5 - quality) * 0.08));
    newStruggles = struggles;
  }

  const due = new Date(today);
  due.setDate(due.getDate() + newInterval);
  const correctInc = quality >= 3 ? 1 : 0;

  await DB.putProgress({
    question_id: questionId,
    times_correct: (existing?.times_correct || 0) + correctInc,
    times_seen: (existing?.times_seen || 0) + 1,
    last_seen: DB.todayISO(),
    interval_days: newInterval,
    ease_factor: newEase,
    due_date: due.toISOString().slice(0, 10),
    struggle_count: newStruggles,
  });
}

async function getStats() {
  const questions = await DB.getAllQuestions();
  const progress = await DB.getAllProgress();
  const today = DB.todayISO();
  const total = questions.length;
  const mastered = progress.filter((p) => p.interval_days >= 7).length;
  const dueToday = progress.filter((p) => p.due_date && p.due_date <= today).length;
  const struggling = progress.filter((p) => p.struggle_count >= 2).length;
  return {
    total, mastered, due_today: dueToday, struggling,
    mastery_pct: total > 0 ? Math.round((mastered / total) * 1000) / 10 : 0.0,
  };
}

async function getDomainStats() {
  const questions = await DB.getAllQuestions();
  const progress = await DB.getAllProgress();
  const progressById = new Map(progress.map((p) => [p.question_id, p]));
  const byDomain = new Map();
  for (const q of questions) {
    if (!byDomain.has(q.domain)) byDomain.set(q.domain, { domain: q.domain, total: 0, mastered: 0 });
    const entry = byDomain.get(q.domain);
    entry.total += 1;
    const p = progressById.get(q.id);
    if (p && p.interval_days >= 7) entry.mastered += 1;
  }
  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

async function getStruggled(limit = 10) {
  const progress = await DB.getAllProgress();
  const struggled = progress.filter((p) => p.struggle_count > 0)
    .sort((a, b) => b.struggle_count - a.struggle_count)
    .slice(0, limit);
  const questions = await DB.getQuestionsByIds(struggled.map((p) => p.question_id));
  const qById = new Map(questions.map((q) => [q.id, q]));
  return struggled.map((p) => {
    const q = qById.get(p.question_id);
    const accuracy = p.times_seen > 0 ? Math.round((p.times_correct * 100) / p.times_seen) : 0;
    return { question: q?.question || "", domain: q?.domain || "", struggle_count: p.struggle_count,
      times_seen: p.times_seen, accuracy };
  });
}

async function saveSession({ mode, domains, attempted, correct, weakIds }) {
  const scorePct = attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0.0;
  await DB.addSession({
    mode, domains: domains || null,
    questions_attempted: attempted, questions_correct: correct,
    score_pct: scorePct, weak_questions: weakIds || [],
  });
}

window.SRS = {
  getDueQuestions, updateProgress, getStats, getDomainStats, getStruggled, saveSession,
  getQuestionsByIds: DB.getQuestionsByIds, getAllDomains: DB.getAllDomains,
};
