const TestMode = (() => {
  const PASS_THRESHOLD = 0.75;
  const DEFAULT_TIME_MINUTES = 90;

  let state = null;
  let timerHandle = null;
  let rootContainer = null;

  function freshState() {
    return { questions: [], answers: {}, currentIdx: 0, timeRemaining: 0, timerRunning: false, selectedDomains: [] };
  }

  async function render(container) {
    rootContainer = container;
    if (!state) state = freshState();
    if (state.timerRunning) {
      showQuestion();
    } else {
      await showConfig();
    }
  }

  async function showConfig() {
    stopTimer();
    const domains = await SRS.getAllDomains();
    rootContainer.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Practice Test</h1>
        <p class="screen-sub">Timed exam simulation — no feedback until you submit</p>
        <div class="panel">
          <h3 class="field-label">Domain filter (blank = all)</h3>
          <div class="checkbox-grid" id="domain-checks">
            ${domains.map((d) => `<label class="check-row"><input type="checkbox" value="${escapeAttr(d)}"><span>${escapeHtml(d)}</span></label>`).join("")}
          </div>
          <h3 class="field-label">Questions</h3>
          <select id="count-select" class="select">
            ${[10, 25, 50, 90].map((n) => `<option ${n === 25 ? "selected" : ""}>${n}</option>`).join("")}
          </select>
          <h3 class="field-label">Time (minutes)</h3>
          <select id="time-select" class="select">
            ${[10, 20, 30, 45, 60, 90].map((n) => `<option ${n === DEFAULT_TIME_MINUTES ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-block btn-red" id="start-btn">Start Timed Exam</button>
      </div>
    `;
    rootContainer.querySelector("#start-btn").addEventListener("click", startExam);
  }

  async function startExam() {
    const selectedDomains = [...rootContainer.querySelectorAll("#domain-checks input:checked")].map((el) => el.value);
    const limit = parseInt(rootContainer.querySelector("#count-select").value, 10);
    const minutes = parseInt(rootContainer.querySelector("#time-select").value, 10);

    let questions = await SRS.getDueQuestions({ domains: selectedDomains.length ? selectedDomains : null, mode: "all", limit });
    questions = questions.filter((q) => q.type === "multiple_choice");

    if (!questions.length) {
      rootContainer.innerHTML = `
        <div class="screen-pad center-pad">
          <h2>No multiple choice questions found.</h2>
          <button class="btn" id="back-btn">Back</button>
        </div>`;
      rootContainer.querySelector("#back-btn").addEventListener("click", showConfig);
      return;
    }

    state = freshState();
    state.questions = questions;
    state.selectedDomains = selectedDomains;
    state.timeRemaining = minutes * 60;
    state.timerRunning = true;
    showQuestion();
  }

  function showQuestion() {
    const q = state.questions[state.currentIdx];
    const total = state.questions.length;
    const answered = Object.keys(state.answers).length;

    rootContainer.innerHTML = `
      <div class="screen-pad">
        <div class="progress-top">
          <span>Q ${state.currentIdx + 1}/${total}</span>
          <span id="timer-label" class="timer-label">${formatTime(state.timeRemaining)}</span>
          <span class="muted">Answered: ${answered}/${total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${(answered / total) * 100}%"></div></div>

        <div class="card">
          <div class="muted small">${escapeHtml(q.domain || "")}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          <div class="option-list" id="option-list">
            ${(q.options || []).map((opt) => {
              const letter = opt[0]?.toUpperCase();
              const checked = state.answers[q.id] === letter ? "checked" : "";
              return `<label class="option-row"><input type="radio" name="test-opt" value="${letter}" ${checked}><span>${escapeHtml(opt)}</span></label>`;
            }).join("")}
          </div>
        </div>

        <div class="btn-row">
          ${state.currentIdx > 0 ? `<button class="btn btn-ghost" id="prev-btn">← Previous</button>` : "<span></span>"}
          ${state.currentIdx < total - 1
            ? `<button class="btn" id="next-btn">Next →</button>`
            : `<button class="btn btn-red" id="submit-btn">Submit Exam</button>`}
        </div>

        <div class="jumper" id="jumper">
          ${state.questions.map((qq, i) => `<button class="jump-btn ${state.answers[qq.id] ? "jump-answered" : ""}" data-idx="${i}">${i + 1}</button>`).join("")}
        </div>
      </div>
    `;

    rootContainer.querySelectorAll('input[name="test-opt"]').forEach((el) => {
      el.addEventListener("change", () => { state.answers[q.id] = el.value; });
    });
    const prevBtn = rootContainer.querySelector("#prev-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => go(-1));
    const nextBtn = rootContainer.querySelector("#next-btn");
    if (nextBtn) nextBtn.addEventListener("click", () => go(1));
    const submitBtn = rootContainer.querySelector("#submit-btn");
    if (submitBtn) submitBtn.addEventListener("click", submitExam);
    rootContainer.querySelectorAll(".jump-btn").forEach((btn) => {
      btn.addEventListener("click", () => { state.currentIdx = parseInt(btn.dataset.idx, 10); showQuestion(); });
    });

    startTimer();
  }

  function go(delta) {
    state.currentIdx += delta;
    showQuestion();
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      if (!state.timerRunning) return stopTimer();
      if (state.timeRemaining <= 0) {
        stopTimer();
        submitExam();
        return;
      }
      state.timeRemaining -= 1;
      const label = rootContainer.querySelector("#timer-label");
      if (label) {
        label.textContent = formatTime(state.timeRemaining);
        label.className = "timer-label " + (state.timeRemaining <= 300 ? "text-red" : state.timeRemaining <= 600 ? "text-amber" : "text-green");
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function formatTime(seconds) {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  async function submitExam() {
    stopTimer();
    state.timerRunning = false;

    let correct = 0;
    const weakIds = [];
    const domainResults = {};

    for (const q of state.questions) {
      const given = state.answers[q.id] || "";
      const expected = q.correct_answer.trim().toUpperCase();
      const isCorrect = given === expected;
      if (isCorrect) { correct += 1; await SRS.updateProgress(q.id, 3); }
      else { weakIds.push(q.id); await SRS.updateProgress(q.id, 0); }

      if (!domainResults[q.domain]) domainResults[q.domain] = { total: 0, correct: 0 };
      domainResults[q.domain].total += 1;
      if (isCorrect) domainResults[q.domain].correct += 1;
    }

    const total = state.questions.length;
    const pct = total ? Math.round((correct / total) * 1000) / 10 : 0;
    const passed = pct >= PASS_THRESHOLD * 100;

    await SRS.saveSession({ mode: "test", domains: state.selectedDomains, attempted: total, correct, weakIds });
    showResults(correct, total, pct, passed, domainResults, weakIds);
  }

  function showResults(correct, total, pct, passed, domainResults, weakIds) {
    rootContainer.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Exam Results</h1>
        <div class="card">
          <div class="result-row">
            <span class="result-badge ${passed ? "text-green" : "text-red"}">${passed ? "PASS" : "FAIL"}</span>
            <span class="big">${correct}/${total} (${pct}%)</span>
          </div>
          <p class="muted small">Threshold: ${Math.round(PASS_THRESHOLD * 100)}%</p>
          <h3 class="field-label">By Domain</h3>
          ${Object.entries(domainResults).sort(([a], [b]) => a.localeCompare(b)).map(([domain, res]) => {
            const dPct = res.total ? res.correct / res.total : 0;
            return `
              <div class="domain-row">
                <div class="domain-row-top">
                  <span>${escapeHtml(domain)}</span>
                  <span class="${dPct >= PASS_THRESHOLD ? "text-green" : "text-red"}">${res.correct}/${res.total} (${Math.round(dPct * 100)}%)</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${dPct * 100}%"></div></div>
              </div>`;
          }).join("")}
        </div>
        <div class="btn-row">
          <button class="btn" id="new-test-btn">New Test</button>
          ${weakIds.length ? `<button class="btn btn-red" id="study-btn">Study Missed</button>` : ""}
          <button class="btn btn-ghost" id="dash-btn">Dashboard</button>
        </div>
      </div>
    `;
    rootContainer.querySelector("#new-test-btn").addEventListener("click", () => { state = freshState(); showConfig(); });
    rootContainer.querySelector("#dash-btn").addEventListener("click", () => { state = freshState(); Router.show("dashboard"); });
    const studyBtn = rootContainer.querySelector("#study-btn");
    if (studyBtn) studyBtn.addEventListener("click", () => {
      state = freshState();
      Router.setLearnStartMode("weak");
      Router.show("learn");
    });
  }

  function escapeAttr(s) { return (s ?? "").toString().replace(/"/g, "&quot;"); }
  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { render };
})();
