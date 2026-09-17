const Dashboard = (() => {
  async function render(container) {
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Dashboard</h1>
        <p class="screen-sub">CompTIA Security+ SY0-701</p>

        <div class="stat-grid" id="stat-grid"></div>

        <div class="panel">
          <h2 class="panel-title">Quick Start</h2>
          <button class="btn btn-block" id="qs-learn">Learn</button>
          <button class="btn btn-block btn-red" id="qs-test">Practice Test</button>
        </div>

        <div class="panel">
          <h2 class="panel-title">Domain Progress</h2>
          <div id="domain-list"></div>
        </div>

        <div class="panel">
          <h2 class="panel-title">Recent Sessions</h2>
          <div id="session-list"></div>
        </div>
      </div>
    `;

    container.querySelector("#qs-learn").addEventListener("click", () => Router.show("learn"));
    container.querySelector("#qs-test").addEventListener("click", () => Router.show("test"));

    await loadStats(container);
    await loadDomains(container);
    await loadSessions(container);
  }

  async function loadStats(container) {
    const s = await SRS.getStats();
    const grid = container.querySelector("#stat-grid");
    grid.innerHTML = "";
    const cards = [
      ["Total Questions", s.total],
      ["Mastery", `${s.mastery_pct}%`],
      ["Due Today", s.due_today],
      ["Struggling", s.struggling],
    ];
    for (const [label, val] of cards) {
      grid.insertAdjacentHTML("beforeend", `
        <div class="stat-card">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${val}</div>
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
            <span>${row.domain}</span>
            <span class="muted">${row.mastered}/${row.total}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct * 100}%"></div></div>
        </div>
      `);
    }
  }

  async function loadSessions(container) {
    const sessions = await SRS.getStats ? await DB.getRecentSessions(8) : [];
    const list = container.querySelector("#session-list");
    list.innerHTML = "";
    if (!sessions.length) {
      list.innerHTML = `<p class="muted">No sessions yet.</p>`;
      return;
    }
    for (const s of sessions) {
      const scoreStr = s.score_pct != null ? `${s.score_pct.toFixed(0)}%` : "—";
      const dateStr = s.date.slice(0, 10);
      list.insertAdjacentHTML("beforeend", `
        <div class="session-row">
          <span class="muted">${dateStr}</span>
          <span>${cap(s.mode)}</span>
          <span>${s.questions_correct}/${s.questions_attempted}</span>
          <span>${scoreStr}</span>
        </div>
      `);
    }
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  return { render };
})();
