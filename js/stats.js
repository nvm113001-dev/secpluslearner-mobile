const Stats = (() => {
  async function render(container) {
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Stats & Reports</h1>
        <div class="stat-grid" id="stat-grid"></div>
        <div class="panel">
          <h2 class="panel-title">Domain Breakdown</h2>
          <div id="domain-list"></div>
        </div>
        <div class="panel">
          <h2 class="panel-title">Session History</h2>
          <div id="session-list"></div>
        </div>
        <div class="panel">
          <h2 class="panel-title">Most Struggled Questions</h2>
          <div id="struggle-list"></div>
        </div>
      </div>
    `;
    await loadStats(container);
    await loadDomains(container);
    await loadSessions(container);
    await loadStruggled(container);
  }

  async function loadStats(container) {
    const s = await SRS.getStats();
    const grid = container.querySelector("#stat-grid");
    grid.innerHTML = "";
    const cards = [
      ["Total Questions", s.total],
      ["Mastered", `${s.mastered}`, `(${s.mastery_pct}%)`],
      ["Due Today", s.due_today],
      ["Struggling", s.struggling],
    ];
    for (const [label, val, sub] of cards) {
      grid.insertAdjacentHTML("beforeend", `
        <div class="stat-card">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${val}</div>
          ${sub ? `<div class="muted small">${sub}</div>` : ""}
        </div>
      `);
    }
  }

  async function loadDomains(container) {
    const rows = await SRS.getDomainStats();
    const list = container.querySelector("#domain-list");
    list.innerHTML = "";
    for (const row of rows) {
      const pct = row.total > 0 ? row.mastered / row.total : 0;
      list.insertAdjacentHTML("beforeend", `
        <div class="domain-row">
          <div class="domain-row-top">
            <span>${escapeHtml(row.domain)}</span>
            <span class="muted">${Math.round(pct * 100)}% (${row.mastered}/${row.total})</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct * 100}%"></div></div>
        </div>
      `);
    }
  }

  async function loadSessions(container) {
    const sessions = await DB.getRecentSessions(15);
    const list = container.querySelector("#session-list");
    list.innerHTML = "";
    if (!sessions.length) {
      list.innerHTML = `<p class="muted">No sessions yet.</p>`;
      return;
    }
    for (const s of sessions) {
      const pct = s.score_pct;
      const scoreStr = pct != null ? `${s.questions_correct}/${s.questions_attempted} (${pct.toFixed(0)}%)` : "—";
      const passed = (pct || 0) >= 75;
      list.insertAdjacentHTML("beforeend", `
        <div class="session-row">
          <span class="muted">${s.date.slice(0, 10)}</span>
          <span>${cap(s.mode)}</span>
          <span>${scoreStr}</span>
          <span class="${passed ? "text-green" : "text-red"}">${passed ? "Pass" : "Fail"}</span>
        </div>
      `);
    }
  }

  async function loadStruggled(container) {
    const rows = await SRS.getStruggled(10);
    const list = container.querySelector("#struggle-list");
    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<p class="muted">No struggles yet — keep studying!</p>`;
      return;
    }
    for (const r of rows) {
      const preview = r.question.length > 100 ? r.question.slice(0, 100) + "…" : r.question;
      list.insertAdjacentHTML("beforeend", `
        <div class="struggle-card">
          <div class="struggle-top">
            <span class="text-red small">⚠ ${r.struggle_count} struggles (${r.accuracy}% accuracy)</span>
            <span class="muted small">${escapeHtml(r.domain.split(" ")[0])}</span>
          </div>
          <div class="small">${escapeHtml(preview)}</div>
        </div>
      `);
    }
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { render };
})();
