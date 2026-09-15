const Bank = (() => {
  const VALID_TYPES = ["multiple_choice", "short_answer", "pbq"];
  let rootContainer = null;
  let filters = { domain: "All", type: "All", search: "" };

  async function render(container) {
    rootContainer = container;
    const domains = ["All", ...(await DB.getAllDomains())];
    container.innerHTML = `
      <div class="screen-pad">
        <h1 class="screen-title">Question Bank</h1>
        <div class="filter-row">
          <select id="domain-filter" class="select">
            ${domains.map((d) => `<option ${d === filters.domain ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
          </select>
          <select id="type-filter" class="select">
            ${["All", ...VALID_TYPES].map((t) => `<option ${t === filters.type ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <input type="text" id="search-input" class="text-input" placeholder="Search questions…" value="${escapeAttr(filters.search)}">
        <div id="count-label" class="muted small"></div>
        <div id="bank-list" class="bank-list"></div>
      </div>
      <button class="fab" id="add-fab">+</button>
      <div id="overlay-root"></div>
    `;

    container.querySelector("#domain-filter").addEventListener("change", (e) => { filters.domain = e.target.value; loadList(); });
    container.querySelector("#type-filter").addEventListener("change", (e) => { filters.type = e.target.value; loadList(); });
    container.querySelector("#search-input").addEventListener("input", (e) => { filters.search = e.target.value; loadList(); });
    container.querySelector("#add-fab").addEventListener("click", () => openEditor(null));

    await loadList();
  }

  async function loadList() {
    let rows = await DB.getAllQuestions();
    const progress = await DB.getAllProgress();
    const progressById = new Map(progress.map((p) => [p.question_id, p]));

    if (filters.domain !== "All") rows = rows.filter((r) => r.domain === filters.domain);
    if (filters.type !== "All") rows = rows.filter((r) => r.type === filters.type);
    if (filters.search.trim()) {
      const s = filters.search.trim().toLowerCase();
      rows = rows.filter((r) => r.question.toLowerCase().includes(s));
    }
    rows.sort((a, b) => (a.domain + a.id).localeCompare(b.domain + b.id));

    rootContainer.querySelector("#count-label").textContent = `${rows.length} question(s)`;
    const list = rootContainer.querySelector("#bank-list");
    list.innerHTML = "";
    for (const row of rows) {
      const struggle = progressById.get(row.id)?.struggle_count || 0;
      const preview = row.question.length > 90 ? row.question.slice(0, 90) + "…" : row.question;
      const domainShort = row.domain.split(" ")[0];
      const item = document.createElement("div");
      item.className = "bank-item";
      item.innerHTML = `
        <div class="bank-item-top">
          <span class="badge badge-blue">${escapeHtml(domainShort)}</span>
          <span class="badge badge-type-${row.type}">${row.type.replace("_", " ")}</span>
          ${struggle >= 2 ? `<span class="badge badge-red">⚠ ${struggle}</span>` : ""}
        </div>
        <div class="bank-item-text">${escapeHtml(preview)}</div>
      `;
      item.addEventListener("click", () => showDetail(row));
      list.appendChild(item);
    }
  }

  function overlay(innerHtml) {
    const root = rootContainer.querySelector("#overlay-root");
    root.innerHTML = `<div class="modal-overlay"><div class="modal-sheet">${innerHtml}</div></div>`;
    return root.querySelector(".modal-sheet");
  }
  function closeOverlay() {
    rootContainer.querySelector("#overlay-root").innerHTML = "";
  }

  function showDetail(row) {
    const optsHtml = row.options
      ? `<h3 class="field-label">Options</h3>` + row.options.map((o) => {
          const letter = o[0]?.toUpperCase();
          const isCorrect = row.correct_answer.toUpperCase().split(",").includes(letter);
          return `<div class="${isCorrect ? "text-green" : ""}">${escapeHtml(o)}</div>`;
        }).join("")
      : "";
    const tagsHtml = row.tags?.length ? `<p class="muted small">Tags: ${row.tags.map(escapeHtml).join(", ")}</p>` : "";

    const sheet = overlay(`
      <div class="modal-header">
        <button class="btn-icon" id="close-btn">✕</button>
        <span>Question Detail</span>
      </div>
      <div class="modal-body">
        <p class="muted small">${escapeHtml(row.domain)}</p>
        <p class="muted small">Source: ${escapeHtml(row.source)} | Type: ${row.type.replace("_", " ")}</p>
        <p class="question-text">${escapeHtml(row.question)}</p>
        ${optsHtml}
        <p class="text-green" style="font-weight:600">Correct Answer: ${escapeHtml(row.correct_answer)}</p>
        ${row.explanation ? `<h3 class="field-label">Explanation</h3><p>${escapeHtml(row.explanation)}</p>` : ""}
        ${tagsHtml}
        <div class="btn-row">
          <button class="btn" id="edit-btn">Edit</button>
          <button class="btn btn-red" id="delete-btn">Delete</button>
        </div>
      </div>
    `);
    sheet.querySelector("#close-btn").addEventListener("click", closeOverlay);
    sheet.querySelector("#edit-btn").addEventListener("click", () => openEditor(row));
    sheet.querySelector("#delete-btn").addEventListener("click", () => deleteQuestion(row.id));
  }

  async function deleteQuestion(id) {
    if (!confirm("Delete this question? This cannot be undone.")) return;
    await DB.deleteQuestion(id);
    closeOverlay();
    await loadList();
  }

  async function openEditor(prefill) {
    const domains = await DB.getAllDomains();
    const opts = prefill?.options || ["", "", "", ""];
    while (opts.length < 4) opts.push("");

    const sheet = overlay(`
      <div class="modal-header">
        <button class="btn-icon" id="close-btn">✕</button>
        <span>${prefill ? "Edit Question" : "Add Question"}</span>
      </div>
      <div class="modal-body">
        <h3 class="field-label">Source</h3>
        <input class="text-input" id="f-source" value="${escapeAttr(prefill?.source || "")}" placeholder="e.g. My Notes">

        <h3 class="field-label">Domain</h3>
        <input class="text-input" id="f-domain" list="domain-datalist" value="${escapeAttr(prefill?.domain || domains[0] || "")}">
        <datalist id="domain-datalist">${domains.map((d) => `<option value="${escapeAttr(d)}">`).join("")}</datalist>

        <h3 class="field-label">Subtopic (optional)</h3>
        <input class="text-input" id="f-subtopic" value="${escapeAttr(prefill?.subtopic || "")}">

        <h3 class="field-label">Type</h3>
        <select class="select" id="f-type">
          ${VALID_TYPES.map((t) => `<option ${prefill?.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>

        <h3 class="field-label">Question</h3>
        <textarea class="textarea" id="f-question" rows="3">${escapeHtml(prefill?.question || "")}</textarea>

        <h3 class="field-label">Options (for multiple_choice)</h3>
        ${["A", "B", "C", "D"].map((L, i) => `<input class="text-input" id="f-opt-${i}" value="${escapeAttr(opts[i] || "")}" placeholder="${L}. …">`).join("")}

        <h3 class="field-label">Correct Answer</h3>
        <input class="text-input" id="f-correct" value="${escapeAttr(prefill?.correct_answer || "")}" placeholder="A/B/C/D, or A,B for multi-select, or full text for short_answer">

        <h3 class="field-label">Explanation</h3>
        <textarea class="textarea" id="f-explanation" rows="3">${escapeHtml(prefill?.explanation || "")}</textarea>

        <h3 class="field-label">Tags (comma-separated, optional)</h3>
        <input class="text-input" id="f-tags" value="${escapeAttr((prefill?.tags || []).join(", "))}">

        <button class="btn btn-block btn-primary" id="save-btn">Save Question</button>
      </div>
    `);

    sheet.querySelector("#close-btn").addEventListener("click", closeOverlay);
    sheet.querySelector("#save-btn").addEventListener("click", () => saveQuestion(prefill));
  }

  async function saveQuestion(prefill) {
    const root = rootContainer.querySelector("#overlay-root");
    const val = (id) => root.querySelector(id).value.trim();
    const opts = [0, 1, 2, 3].map((i) => val(`#f-opt-${i}`)).filter(Boolean);
    const tags = val("#f-tags").split(",").map((t) => t.trim()).filter(Boolean);

    const data = {
      source: val("#f-source"),
      domain: val("#f-domain"),
      subtopic: val("#f-subtopic") || null,
      type: val("#f-type"),
      question: val("#f-question"),
      options: opts.length ? opts : null,
      correct_answer: val("#f-correct"),
      explanation: val("#f-explanation"),
      tags: tags.length ? tags : null,
    };

    if (!data.question || !data.correct_answer || !data.source) {
      alert("Question, Correct Answer, and Source are required.");
      return;
    }

    if (prefill) {
      await DB.putQuestion({ ...prefill, ...data, id: prefill.id });
    } else {
      await DB.putQuestion(data);
    }
    closeOverlay();
    await loadList();
  }

  function escapeAttr(s) { return (s ?? "").toString().replace(/"/g, "&quot;"); }
  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { render };
})();
