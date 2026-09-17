// Learn tab -- "Master Mode". A period is a persistent campaign over the
// full question set (or a domain-filtered subset): every question needs two
// correct passes to be mastered for that period -- first via multiple choice
// (or typed, for the handful of questions with no options), then a second
// time later in the period, typed from memory with no options shown. A wrong
// typed retry regresses the question back to needing its first pass again.
// See mastery.js for the actual state machine; this file is UI only.
//
// A period is chunked into rounds of a size you set on the period-home
// screen. Each round pulls a random batch of whatever's currently eligible
// (not-yet-started questions needing their first pass, first-pass-done
// questions needing the typed retry) -- so a question's retry shows up in
// some later round, not deterministically N questions later.
//
// SRS.updateProgress keeps running in parallel on every answer here (same
// as it always has), feeding the Dashboard's separate long-term stats --
// that bookkeeping is untouched by any of this.

const Learn = (() => {
  let state = null;

  function freshState() {
    return {
      period: null, queue: [], current: null,
      roundTotal: 0, roundAttempted: 0, roundCorrect: 0, roundNewlyMastered: 0,
      periodJustCompleted: false,
      isMultiQ: false, optionsRaw: [],
      pendingResult: null,
    };
  }

  async function render(container) {
    if (!state) state = freshState();
    if (state.current) {
      // returning mid-question (e.g. tab switch) -- redraw current card
      state.current.passType === "mc" ? showQuestionMc(container) : showQuestionTyped(container);
      return;
    }
    const active = await Mastery.getActivePeriod();
    if (active) {
      state.period = active;
      showPeriodHome(container);
    } else {
      showConfig(container);
    }
  }

  // ===================================================== HELPERS

  function escapeAttr(s) { return s.replace(/"/g, "&quot;"); }
  function escapeHtml(s) {
    return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function optionLetter(opt) { return opt[0]?.toUpperCase() || ""; }

  // For the typed retry (and for the 8 no-option questions' first typed
  // pass), the expected answer is the correct option's own text -- not its
  // letter, which means nothing once the options are hidden. Multi-select
  // questions ("A,E,G") join all correct option texts together.
  function typedAnswerText(q) {
    if (!q.options || !q.options.length) return q.correct_answer;
    const letters = q.correct_answer.trim().toUpperCase().split(",");
    return q.options
      .filter((opt) => letters.includes(optionLetter(opt)))
      .map((opt) => opt.slice(opt.indexOf(".") + 1).trim())
      .join(", ");
  }

  function radioRow(name, value, label, checked) {
    return `<label class="radio-row"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  }
  function checkRow(name, value, label) {
    return `<label class="check-row"><input type="checkbox" name="${name}" value="${escapeAttr(value)}"><span>${label}</span></label>`;
  }

  function masteryBar(progress) {
    const { total, mastered, pass1Done, notStarted } = progress;
    const pct = (n) => (total > 0 ? (n / total) * 100 : 0);
    return `
      <div class="mastery-bar">
        <div class="mastery-seg mastery-seg-mastered" style="width:${pct(mastered)}%"></div>
        <div class="mastery-seg mastery-seg-pass1" style="width:${pct(pass1Done)}%"></div>
      </div>
      <div class="mastery-stats-row">
        <span class="mastery-stat"><span class="dot dot-mastered"></span>${mastered} mastered</span>
        <span class="mastery-stat"><span class="dot dot-pass1"></span>${pass1Done} awaiting typed retry</span>
        <span class="mastery-stat"><span class="dot dot-notstarted"></span>${notStarted} not started</span>
      </div>
    `;
  }

  // ===================================================== CONFIG (new period)

  async function showConfig(container) {
    const domains = await SRS.getAllDomains();
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Learn Mode</h1>
        <p class="screen-sub">Master Mode: two correct passes -- multiple choice, then typed from memory -- masters a question for this period.</p>
        <div class="panel">
          <h3 class="field-label">Domain filter (blank = all)</h3>
          <div class="checkbox-grid" id="domain-checks">
            ${domains.map((d) => checkRow("domain", d, d)).join("")}
          </div>
          <h3 class="field-label">Questions per round</h3>
          <input type="number" id="round-size-input" class="text-input" min="1" max="200" value="20">
        </div>
        <button class="btn btn-block btn-primary" id="start-btn">Begin Period</button>
      </div>
    `;
    container.querySelector("#start-btn").addEventListener("click", () => beginPeriod(container));
  }

  async function beginPeriod(container) {
    const domainChecks = [...container.querySelectorAll('input[name="domain"]:checked')].map((el) => el.value);
    const roundSize = Math.max(1, parseInt(container.querySelector("#round-size-input").value, 10) || 20);

    const period = await Mastery.startPeriod({ domains: domainChecks.length ? domainChecks : null, roundSize });
    if (!period.total) {
      container.innerHTML = `
        <div class="screen-pad center-pad">
          <h2>No questions found</h2>
          <p class="muted">Try changing the domain filter.</p>
          <button class="btn" id="back-btn">Back</button>
        </div>`;
      container.querySelector("#back-btn").addEventListener("click", () => showConfig(container));
      return;
    }

    state.period = period;
    showPeriodHome(container);
  }

  // ===================================================== PERIOD HOME

  async function showPeriodHome(container) {
    const progress = await Mastery.getPeriodProgress(state.period.id);
    const remaining = progress.total - progress.mastered;
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Learn Mode</h1>
        <p class="screen-sub">${state.period.domains ? state.period.domains.join(", ") : "All domains"} &middot; ${progress.total} questions this period</p>
        <div class="panel">
          ${masteryBar(progress)}
        </div>
        <div class="panel">
          <h3 class="field-label">Questions per round</h3>
          <input type="number" id="round-size-input" class="text-input" min="1" max="${Math.max(1, remaining)}" value="${state.period.round_size || 20}">
        </div>
        <button class="btn btn-block btn-primary" id="round-btn">Start Round</button>
      </div>
    `;
    container.querySelector("#round-btn").addEventListener("click", () => startRound(container));
  }

  async function startRound(container) {
    const roundSize = Math.max(1, parseInt(container.querySelector("#round-size-input").value, 10) || 20);
    state.period.round_size = roundSize;
    await DB.putPeriod(state.period);

    const batch = await Mastery.getRoundBatch(state.period.id, roundSize);
    if (!batch.length) {
      showPeriodHome(container);
      return;
    }

    state.queue = batch;
    state.roundTotal = batch.length;
    state.roundAttempted = 0;
    state.roundCorrect = 0;
    state.roundNewlyMastered = 0;
    state.periodJustCompleted = false;
    loadNext(container);
  }

  // ===================================================== LOAD NEXT

  function loadNext(container) {
    if (!state.queue.length) {
      showRoundSummary(container);
      return;
    }
    state.current = state.queue.shift();
    state.current.passType === "mc" ? showQuestionMc(container) : showQuestionTyped(container);
  }

  function progressBar() {
    const done = state.roundTotal - state.queue.length;
    const pct = state.roundTotal > 0 ? (done / state.roundTotal) * 100 : 0;
    return `
      <div class="progress-top">
        <span>Question ${done} of ${state.roundTotal}</span>
        <span class="muted">Correct: ${state.roundCorrect}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;
  }

  function passBadge(passType) {
    return passType === "mc"
      ? `<span class="pass-badge pass-badge-mc">Multiple Choice</span>`
      : `<span class="pass-badge pass-badge-typed">Typed Recall</span>`;
  }

  // ===================================================== MC PASS

  function showQuestionMc(container) {
    const { question: q } = state.current;
    state.isMultiQ = q.correct_answer.includes(",");
    state.optionsRaw = q.options || [];

    container.innerHTML = `
      <div class="screen-pad">
        ${progressBar()}
        <div class="card">
          <div class="muted small">${escapeHtml(q.domain || "")} ${passBadge("mc")}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          ${state.isMultiQ ? `<div class="hint-amber">Select all that apply, then submit.</div>` : ""}
          <div id="option-list" class="option-list">
            ${state.optionsRaw.map((opt, i) => optionRow(opt, i, state.isMultiQ)).join("")}
          </div>
        </div>
        <button class="btn btn-block btn-primary" id="submit-btn" disabled>Submit Answer</button>
        <div id="feedback"></div>
      </div>
    `;

    const inputs = container.querySelectorAll("#option-list input");
    inputs.forEach((inp) => inp.addEventListener("change", () => updateSubmitState(container)));
    container.querySelector("#submit-btn").addEventListener("click", () => submitMc(container));
  }

  function optionRow(opt, i, isMulti) {
    const letter = opt[0]?.toUpperCase() || "";
    const type = isMulti ? "checkbox" : "radio";
    return `
      <label class="option-row" data-letter="${letter}">
        <input type="${type}" name="mcq-opt" value="${letter}">
        <span>${escapeHtml(opt)}</span>
      </label>`;
  }

  function selectedLetters(container) {
    return [...container.querySelectorAll("#option-list input:checked")].map((el) => el.value);
  }

  function updateSubmitState(container) {
    container.querySelector("#submit-btn").disabled = selectedLetters(container).length === 0;
  }

  async function submitMc(container) {
    const { question: q } = state.current;
    const selected = new Set(selectedLetters(container));
    const correctSet = new Set(q.correct_answer.trim().toUpperCase().split(","));
    const isCorrect = setsEqual(selected, correctSet);

    state.roundAttempted += 1;

    container.querySelectorAll("#option-list input").forEach((el) => (el.disabled = true));
    container.querySelector("#submit-btn").disabled = true;

    container.querySelectorAll(".option-row").forEach((row) => {
      const letter = row.dataset.letter;
      if (correctSet.has(letter)) row.classList.add("option-correct");
      else if (selected.has(letter) && !isCorrect) row.classList.add("option-wrong");
    });

    let fbLabel = "";
    if (!isCorrect) {
      const label = correctSet.size > 1 ? "answers" : "answer";
      const verb = correctSet.size > 1 ? "are" : "is";
      fbLabel = `The correct ${label} ${verb}: ${[...correctSet].sort().join(", ")}`;
    }

    await SRS.updateProgress(q.id, isCorrect ? 3 : 1);
    const result = await Mastery.recordAttempt(state.period.id, q.id, isCorrect);

    if (isCorrect) state.roundCorrect += 1;
    if (result.periodCompleted) state.periodJustCompleted = true;

    const fb = container.querySelector("#feedback");
    fb.innerHTML = `
      <div class="feedback-card ${isCorrect ? "feedback-correct" : "feedback-wrong"}">
        <div class="feedback-title">${isCorrect ? "CORRECT" : "INCORRECT"}</div>
        ${fbLabel ? `<div class="feedback-sub">${escapeHtml(fbLabel)}</div>` : ""}
        ${!isCorrect ? `<div class="feedback-sub">This question stays in the pool -- it'll come back around for another multiple-choice attempt.</div>` : `<div class="feedback-sub">First pass done -- it'll come back later, typed from memory, to finish mastering it.</div>`}
        ${q.explanation ? `<div class="feedback-explanation">${escapeHtml(q.explanation)}</div>` : ""}
      </div>
      <button class="btn btn-block" id="next-btn">${state.queue.length ? "Next Question →" : "Finish Round"}</button>
    `;
    fb.querySelector("#next-btn").addEventListener("click", () => loadNext(container));
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  // ===================================================== TYPED PASS

  function showQuestionTyped(container) {
    const { question: q } = state.current;
    container.innerHTML = `
      <div class="screen-pad">
        ${progressBar()}
        <div class="card">
          <div class="muted small">${escapeHtml(q.domain || "")} ${passBadge("typed")}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          <input type="text" id="ty-input" class="text-input" placeholder="Type your answer here…" autocomplete="off">
        </div>
        <button class="btn btn-block btn-primary" id="ty-submit">Submit Answer</button>
        <div id="feedback"></div>
      </div>
    `;
    const input = container.querySelector("#ty-input");
    input.focus();
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitTyped(container); });
    container.querySelector("#ty-submit").addEventListener("click", () => submitTyped(container));
  }

  async function submitTyped(container) {
    const { question: q } = state.current;
    const input = container.querySelector("#ty-input");
    const userText = input.value.trim();
    const correctText = typedAnswerText(q);
    const { isCorrect, ratio, feedback } = Fuzzy.checkAnswer(userText, correctText);

    state.roundAttempted += 1;
    input.disabled = true;
    container.querySelector("#ty-submit").disabled = true;

    const quality = isCorrect ? (ratio >= 0.9 ? 5 : 4) : (ratio >= 0.5 ? 2 : 0);
    state.pendingResult = { isCorrect, ratio, feedback, quality, correctText, overridden: false };

    renderTypedFeedback(container);
  }

  function renderTypedFeedback(container) {
    const { question: q } = state.current;
    const r = state.pendingResult;
    const fbClass = r.isCorrect ? "feedback-correct" : (r.ratio >= 0.5 ? "feedback-almost" : "feedback-wrong");
    const fbTitle = r.overridden ? "MARKED CORRECT" : (r.isCorrect ? "CORRECT" : (r.ratio >= 0.5 ? "ALMOST" : "INCORRECT"));

    const fb = container.querySelector("#feedback");
    fb.innerHTML = `
      <div class="feedback-card ${fbClass}">
        <div class="feedback-title">${fbTitle}</div>
        <div class="feedback-sub">${escapeHtml(r.overridden ? "Self-graded correct." : r.feedback)}</div>
        ${!r.isCorrect ? `<div class="feedback-answer">Answer: ${escapeHtml(r.correctText)}</div>` : ""}
        ${q.explanation ? `<div class="feedback-explanation">${escapeHtml(q.explanation)}</div>` : ""}
      </div>
      <div id="ty-actions"></div>
    `;

    const actions = fb.querySelector("#ty-actions");
    if (!r.isCorrect) {
      actions.insertAdjacentHTML("beforeend", `<button class="btn btn-block btn-outline" id="override-btn">I got this right → mark correct</button>`);
      actions.querySelector("#override-btn").addEventListener("click", () => {
        state.pendingResult.isCorrect = true;
        state.pendingResult.overridden = true;
        state.pendingResult.quality = 4;
        renderTypedFeedback(container);
      });
    }
    actions.insertAdjacentHTML("beforeend", `<button class="btn btn-block" id="next-btn">${state.queue.length ? "Next Question →" : "Finish Round"}</button>`);
    actions.querySelector("#next-btn").addEventListener("click", () => finalizeTyped(container));
  }

  async function finalizeTyped(container) {
    const { question: q } = state.current;
    const r = state.pendingResult;

    await SRS.updateProgress(q.id, r.quality);
    const result = await Mastery.recordAttempt(state.period.id, q.id, r.isCorrect);

    if (r.isCorrect) state.roundCorrect += 1;
    if (result.status === 2) state.roundNewlyMastered += 1;
    if (result.periodCompleted) state.periodJustCompleted = true;

    state.pendingResult = null;
    loadNext(container);
  }

  // ===================================================== ROUND SUMMARY

  async function showRoundSummary(container) {
    await SRS.saveSession({
      mode: "learn", domains: state.period.domains,
      attempted: state.roundAttempted, correct: state.roundCorrect, weakIds: [],
    });

    if (state.periodJustCompleted) {
      showPeriodComplete(container);
      return;
    }

    const progress = await Mastery.getPeriodProgress(state.period.id);
    const pct = state.roundAttempted ? Math.round((state.roundCorrect / state.roundAttempted) * 100) : 0;
    const colorClass = pct >= 75 ? "text-green" : pct >= 50 ? "text-amber" : "text-red";

    container.innerHTML = `
      <div class="screen-pad center-pad">
        <h1>Round Complete!</h1>
        <p class="${colorClass} big">${state.roundCorrect} / ${state.roundAttempted} correct (${pct}%)</p>
        ${state.roundNewlyMastered ? `<p class="muted">${state.roundNewlyMastered} question(s) newly mastered this round</p>` : ""}
        <div class="panel" style="text-align:left; width:100%; max-width:400px;">${masteryBar(progress)}</div>
        <div class="btn-row">
          <button class="btn btn-primary" id="continue-btn">Continue Period</button>
          <button class="btn btn-ghost" id="dash-btn">Dashboard</button>
        </div>
      </div>
    `;
    state.current = null;
    container.querySelector("#continue-btn").addEventListener("click", () => showPeriodHome(container));
    container.querySelector("#dash-btn").addEventListener("click", () => { Router.show("dashboard"); });
  }

  async function showPeriodComplete(container) {
    const progress = await Mastery.getPeriodProgress(state.period.id);
    container.innerHTML = `
      <div class="screen-pad center-pad">
        <h1>Period Complete! 🎉</h1>
        <p class="big text-green">${progress.mastered} / ${progress.total} questions mastered</p>
        <p class="muted">Every question in this period has been answered correctly via multiple choice and then again from memory. Start a new period to go through the set again.</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="new-period-btn">Start New Period</button>
          <button class="btn btn-ghost" id="dash-btn">Dashboard</button>
        </div>
      </div>
    `;
    state = freshState();
    container.querySelector("#new-period-btn").addEventListener("click", () => showConfig(container));
    container.querySelector("#dash-btn").addEventListener("click", () => { Router.show("dashboard"); });
  }

  return { render };
})();
