// Learn tab "Master Mode": a period is a persistent campaign over a (possibly
// domain-filtered) scope of the question set. Every question needs exactly
// two correct passes to reach mastery for that period:
//
//   status 0 (not started)   -- next pass is MC, or typed if the question
//                                has no options (the 8 short_answer-only ones)
//   status 1 (first pass ok) -- next pass is always typed, fuzzy-matched
//   status 2 (mastered)      -- done for this period
//
// A wrong answer on the typed retry (status 1) regresses all the way back
// to status 0 -- it has to be answered correctly via its first-pass type
// again before it's eligible for another typed retry. A wrong first pass
// just stays at status 0 and gets tried again in a later round. This mirrors
// how SRS.updateProgress keeps running in parallel for every answer here --
// Master mode's period/mastery bookkeeping is a separate layer on top of
// the existing spaced-repetition system, not a replacement for it.

const Mastery = (() => {
  function nowISO() { return new Date().toISOString(); }

  function passTypeFor(row, question) {
    if (row.status === 1) return "typed";
    return question.options && question.options.length ? "mc" : "typed";
  }

  async function getActivePeriod() {
    const latest = await DB.getLatestPeriod();
    if (latest && !latest.completed_at) return latest;
    return null;
  }

  async function startPeriod({ domains, roundSize }) {
    const all = await DB.getAllQuestions();
    const scope = domains && domains.length ? all.filter((q) => domains.includes(q.domain)) : all;

    const period = {
      domains: domains && domains.length ? domains : null,
      round_size: roundSize,
      total: scope.length,
      created_at: nowISO(),
      completed_at: null,
    };
    const id = await DB.addPeriod(period);
    period.id = id;

    const rows = scope.map((q) => ({
      period_id: id, question_id: q.id, status: 0, updated_at: period.created_at,
    }));
    await DB.putMasteryRows(rows);
    return period;
  }

  async function getPeriodProgress(periodId) {
    const rows = await DB.getMasteryRowsByPeriod(periodId);
    let mastered = 0, pass1Done = 0, notStarted = 0;
    for (const r of rows) {
      if (r.status === 2) mastered += 1;
      else if (r.status === 1) pass1Done += 1;
      else notStarted += 1;
    }
    return { total: rows.length, mastered, pass1Done, notStarted };
  }

  async function getRoundBatch(periodId, roundSize) {
    const rows = (await DB.getMasteryRowsByPeriod(periodId)).filter((r) => r.status !== 2);
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const batch = rows.slice(0, roundSize);
    const questions = await DB.getQuestionsByIds(batch.map((r) => r.question_id));
    const qById = new Map(questions.map((q) => [q.id, q]));
    return batch
      .map((row) => ({ row, question: qById.get(row.question_id), passType: passTypeFor(row, qById.get(row.question_id)) }))
      .filter((item) => item.question);
  }

  async function recordAttempt(periodId, questionId, isCorrect) {
    const row = await DB.getMasteryRow(periodId, questionId);
    if (!row) return null;

    row.status = isCorrect
      ? (row.status === 0 ? 1 : 2)
      : (row.status === 1 ? 0 : row.status);
    row.updated_at = nowISO();
    await DB.putMasteryRows([row]);

    let periodCompleted = false;
    if (row.status === 2) {
      const progress = await getPeriodProgress(periodId);
      if (progress.mastered === progress.total) {
        const period = await DB.getPeriod(periodId);
        period.completed_at = nowISO();
        await DB.putPeriod(period);
        periodCompleted = true;
      }
    }
    return { status: row.status, periodCompleted };
  }

  return { getActivePeriod, startPeriod, getPeriodProgress, getRoundBatch, recordAttempt };
})();

window.Mastery = Mastery;
