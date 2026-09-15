// Ported from app/ui/learn.py. Each question is shown once per pass:
// multiple_choice (single- or multi-select) is MCQ-only -- correct or
// wrong, you move straight to the next question. short_answer is a
// text-entry round, fuzzy-matched against the answer. A wrong answer is
// requeued behind whatever's left in the session (never as the very next
// card) so a retry doesn't feel like an immediate repeat; if it was the
// last card in the queue there's nothing to space it behind, so it isn't
// re-shown this session at all -- the SRS due date brings it back next time.

const Learn = (() => {
  let state = null;

  function freshState() {
    return {
      queue: [], current: null,
      sessionAttempted: 0, sessionCorrect: 0, weakIds: [],
      selectedDomains: null, mode: "due", total: 0,
      isMultiQ: false, selectedLetters: new Set(), optionsRaw: [],
    };
  }

  async function render(container) {
    if (!state) state = freshState();
    const preset = Router.consumeLearnStartMode();
    if (preset) {
      state = freshState();
      state.mode = preset;
      showConfig(container, preset);
    } else if (state.current) {
      // returning mid-session (e.g. tab switch) -- redraw current question
      state.current.type === "short_answer" ? showQuestionSa(container) : showQuestionMcq(container);
    } else {
      showConfig(container);
    }
  }

  // ===================================================== CONFIG

  async function showConfig(container, presetMode) {
    const domains = await SRS.getAllDomains();
    const mode = presetMode || state.mode || "due";
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Learn Mode</h1>
        <p class="screen-sub">Configure your study session</p>
        <div class="panel">
          <h3 class="field-label">Question pool</h3>
          <div class="radio-group" id="mode-group">
            ${radioRow("mode", "due", "Due today (SRS)", mode === "due")}
            ${radioRow("mode", "all", "All questions", mode === "all")}
            ${radioRow("mode", "weak", "Weak / Struggling", mode === "weak")}
          </div>
          <h3 class="field-label">Domain filter (blank = all)</h3>
          <div class="checkbox-grid" id="domain-checks">
            ${domains.map((d) => checkRow("domain", d, d)).join("")}
          </div>
          <h3 class="field-label">Questions per session</h3>
          <select id="count-select" class="select">
            ${[5, 10, 15, 20, 30, 50].map((n) => `<option value="${n}" ${n === 20 ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-block btn-primary" id="start-btn">Start Session</button>
      </div>
    `;
    container.querySelector("#start-btn").addEventListener("click", () => startSession(container));
  }

  function radioRow(name, value, label, checked) {
    return `<label class="radio-row"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  }
  function checkRow(name, value, label) {
    return `<label class="check-row"><input type="checkbox" name="${name}" value="${escapeAttr(value)}"><span>${label}</span></label>`;
  }
  function escapeAttr(s) { return s.replace(/"/g, "&quot;"); }
  function escapeHtml(s) {
    return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function startSession(container) {
    state.mode = container.querySelector('input[name="mode"]:checked').value;
    const domainChecks = [...container.querySelectorAll('input[name="domain"]:checked')].map((el) => el.value);
    state.selectedDomains = domainChecks.length ? domainChecks : null;
    const limit = parseInt(container.querySelector("#count-select").value, 10);

    const questions = await SRS.getDueQuestions({ domains: state.selectedDomains, mode: state.mode, limit });

    if (!questions.length) {
      container.innerHTML = `
        <div class="screen-pad center-pad">
          <h2>No questions found</h2>
          <p class="muted">Try changing the domain filter or question pool.</p>
          <button class="btn" id="back-btn">Back to Config</button>
        </div>`;
      container.querySelector("#back-btn").addEventListener("click", () => showConfig(container));
      return;
    }

    state.queue = questions;
    state.sessionAttempted = 0;
    state.sessionCorrect = 0;
    state.weakIds = [];
    state.total = state.queue.length;
    loadNext(container);
  }

  // ===================================================== LOAD NEXT

  function loadNext(container) {
    if (!state.queue.length) {
      showSummary(container);
      return;
    }
    state.current = state.queue.shift();
    if (state.current.type === "short_answer") {
      showQuestionSa(container);
    } else {
      showQuestionMcq(container);
    }
  }

  // ===================================================== MCQ

  function showQuestionMcq(container) {
    const q = state.current;
    state.isMultiQ = q.correct_answer.includes(",");
    state.selectedLetters = new Set();
    state.optionsRaw = q.options || [];

    container.innerHTML = `
      <div class="screen-pad">
        ${progressBar()}
        <div class="card">
          <div class="muted small">${escapeHtml(q.domain || "")}</div>
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
    container.querySelector("#submit-btn").addEventListener("click", () => submitMcq(container));
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
    const btn = container.querySelector("#submit-btn");
    btn.disabled = selectedLetters(container).length === 0;
  }

  async function submitMcq(container) {
    const q = state.current;
    const selected = new Set(selectedLetters(container));
    const correctSet = new Set(q.correct_answer.trim().toUpperCase().split(","));
    const isCorrect = setsEqual(selected, correctSet);

    state.sessionAttempted += 1;

    container.querySelectorAll("#option-list input").forEach((el) => (el.disabled = true));
    container.querySelector("#submit-btn").disabled = true;

    container.querySelectorAll(".option-row").forEach((row) => {
      const letter = row.dataset.letter;
      if (correctSet.has(letter)) row.classList.add("option-correct");
      else if (selected.has(letter) && !isCorrect) row.classList.add("option-wrong");
    });

    const fb = container.querySelector("#feedback");
    let fbLabel = "";
    if (!isCorrect) {
      const label = correctSet.size > 1 ? "answers" : "answer";
      const verb = correctSet.size > 1 ? "are" : "is";
      fbLabel = `The correct ${label} ${verb}: ${[...correctSet].sort().join(", ")}`;
    }

    fb.innerHTML = `
      <div class="feedback-card ${isCorrect ? "feedback-correct" : "feedback-wrong"}">
        <div class="feedback-title">${isCorrect ? "CORRECT" : "INCORRECT"}</div>
        ${fbLabel ? `<div class="feedback-sub">${escapeHtml(fbLabel)}</div>` : ""}
        ${q.explanation ? `<div class="feedback-explanation">${escapeHtml(q.explanation)}</div>` : ""}
      </div>
    `;

    if (isCorrect) {
      state.sessionCorrect += 1;
      await SRS.updateProgress(q.id, 3);
    } else {
      state.weakIds.push(q.id);
      await SRS.updateProgress(q.id, 1);
      // Requeue to retry later this session -- but only if there's something
      // left to space it behind (see module comment for why an empty queue
      // means skipping the retry instead of appending).
      const retryCount = (q._retries || 0) + 1;
      if (state.queue.length && retryCount <= 2) {
        q._retries = retryCount;
        state.queue.push(q);
      }
    }

    const nextText = state.queue.length ? "Next Question →" : "Finish Session";
    fb.insertAdjacentHTML("beforeend", `<button class="btn btn-block" id="next-btn">${nextText}</button>`);
    fb.querySelector("#next-btn").addEventListener("click", () => loadNext(container));
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  // ===================================================== SHORT ANSWER

  function showQuestionSa(container) {
    const q = state.current;
    container.innerHTML = `
      <div class="screen-pad">
        ${progressBar()}
        <div class="card">
          <div class="muted small">${escapeHtml(q.domain || "")}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          <input type="text" id="sa-input" class="text-input" placeholder="Type your answer here…" autocomplete="off">
        </div>
        <button class="btn btn-block btn-primary" id="sa-submit">Submit Answer</button>
        <div id="feedback"></div>
      </div>
    `;
    const input = container.querySelector("#sa-input");
    input.focus();
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitSa(container); });
    container.querySelector("#sa-submit").addEventListener("click", () => submitSa(container));
  }

  async function submitSa(container) {
    const q = state.current;
    const input = container.querySelector("#sa-input");
    const userText = input.value.trim();
    const correctText = q.correct_answer;
    const { isCorrect, ratio, feedback } = Fuzzy.checkAnswer(userText, correctText);

    state.sessionAttempted += 1;
    input.disabled = true;
    container.querySelector("#sa-submit").disabled = true;

    let quality, fbClass, fbTitle;
    if (isCorrect) {
      state.sessionCorrect += 1;
      quality = ratio >= 0.9 ? 5 : 4;
      fbClass = "feedback-correct"; fbTitle = "CORRECT";
    } else {
      quality = ratio >= 0.5 ? 2 : 0;
      if (!state.weakIds.includes(q.id)) state.weakIds.push(q.id);
      const retryCount = (q._saRetries || 0) + 1;
      if (state.queue.length && retryCount <= 1) {
        q._saRetries = retryCount;
        state.queue.push(q);
      }
      fbClass = ratio < 0.5 ? "feedback-wrong" : "feedback-almost";
      fbTitle = ratio < 0.5 ? "INCORRECT" : "ALMOST";
    }
    await SRS.updateProgress(q.id, quality);

    const fb = container.querySelector("#feedback");
    fb.innerHTML = `
      <div class="feedback-card ${fbClass}">
        <div class="feedback-title">${fbTitle}</div>
        <div class="feedback-sub">${escapeHtml(feedback)}</div>
        ${!isCorrect ? `<div class="feedback-answer">Answer: ${escapeHtml(correctText)}</div>` : ""}
        ${q.explanation ? `<div class="feedback-explanation">${escapeHtml(q.explanation)}</div>` : ""}
      </div>
      <button class="btn btn-block" id="next-btn">${state.queue.length ? "Next Question →" : "Finish Session"}</button>
    `;
    fb.querySelector("#next-btn").addEventListener("click", () => loadNext(container));
  }

  // ===================================================== PROGRESS / SUMMARY

  function progressBar() {
    const done = state.total - state.queue.length;
    const pct = state.total > 0 ? (done / state.total) * 100 : 0;
    return `
      <div class="progress-top">
        <span>Question ${done} of ${state.total}</span>
        <span class="muted">Correct: ${state.sessionCorrect}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;
  }

  async function showSummary(container) {
    await SRS.saveSession({
      mode: "learn", domains: state.selectedDomains,
      attempted: state.sessionAttempted, correct: state.sessionCorrect, weakIds: state.weakIds,
    });

    const pct = state.sessionAttempted ? Math.round((state.sessionCorrect / state.sessionAttempted) * 100) : 0;
    const colorClass = pct >= 75 ? "text-green" : pct >= 50 ? "text-amber" : "text-red";

    container.innerHTML = `
      <div class="screen-pad center-pad">
        <h1>Session Complete!</h1>
        <p class="${colorClass} big">${state.sessionCorrect} / ${state.sessionAttempted} correct (${pct}%)</p>
        ${state.weakIds.length ? `<p class="muted">${state.weakIds.length} question(s) need more review</p>` : ""}
        <div class="btn-row">
          <button class="btn" id="again-btn">Study Again</button>
          ${state.weakIds.length ? `<button class="btn btn-red" id="weak-btn">Review Weak</button>` : ""}
          <button class="btn btn-ghost" id="dash-btn">Dashboard</button>
        </div>
      </div>
    `;
    container.querySelector("#again-btn").addEventListener("click", () => { state = freshState(); showConfig(container); });
    container.querySelector("#dash-btn").addEventListener("click", () => { state = freshState(); Router.show("dashboard"); });
    const weakBtn = container.querySelector("#weak-btn");
    if (weakBtn) weakBtn.addEventListener("click", () => retakeWeak(container));
  }

  async function retakeWeak(container) {
    const weakQuestions = await SRS.getQuestionsByIds(state.weakIds);
    state = freshState();
    state.queue = weakQuestions;
    state.total = state.queue.length;
    if (state.queue.length) loadNext(container);
    else showConfig(container);
  }

  return { render };
})();
