(() => {
  "use strict";

  const REFRESH_MS = 15000;

  const BOOT_ICON =
    '<svg class="icon-inline" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M46 2 L68 2 C74 2 77 6 77 12 L77 46 C77 53 82 57 89 61 C96 65 98 70 98 77 L98 85 C98 90 94 94 89 94 L23 94 C16 94 8 92 3 87 C-1 83 1 77 7 75 L20 71 C30 68 38 63 41 55 L42 12 C42 6 43 2 46 2 Z"/></svg>';
  const SADDLE_ICON =
    '<svg class="icon-inline" viewBox="0 0 100 70" fill="currentColor" aria-hidden="true"><rect x="10" y="42" width="80" height="16" rx="8"/><circle cx="22" cy="26" r="11"/><rect x="17" y="30" width="10" height="16" rx="4"/><rect x="66" y="24" width="20" height="24" rx="8"/></svg>';

  // Firebase Realtime Database REST API. A trailing slash is optional in
  // config.js; strip it here so URL-building below is consistent.
  const FIREBASE_URL = (window.FIREBASE_DB_URL || "").trim().replace(/\/+$/, "");
  const BLOCKS_URL = FIREBASE_URL ? `${FIREBASE_URL}/watchBlocks.json` : "";

  const activityByValue = Object.fromEntries(
    window.ACTIVITY_TYPES.map((a) => [a.value, a])
  );

  let blockCache = [];
  let editingId = null;

  // ---------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------
  async function loadBlocks() {
    const res = await fetch(BLOCKS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load the schedule.");
    const data = await res.json();
    // Firebase returns null for a path with no data yet (fresh database).
    return Array.isArray(data) ? data : [];
  }

  async function saveBlocks(blocks) {
    const res = await fetch(BLOCKS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blocks),
    });
    if (!res.ok) throw new Error("Could not save the schedule.");
  }

  function setStatus(msg) {
    document.getElementById("board-status").textContent = msg;
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function populateFormOptions() {
    const daySelect = document.getElementById("f-day");
    daySelect.innerHTML = window.TRIP_DAYS
      .map((d) => `<option value="${d.date}">${d.label} · ${d.sub}</option>`)
      .join("");

    const activitySelect = document.getElementById("f-activity");
    activitySelect.innerHTML = window.ACTIVITY_TYPES
      .map((a) => `<option value="${a.value}">${a.icon} ${a.label}</option>`)
      .join("");
  }

  function renderMenu() {
    const list = document.getElementById("menu-list");
    list.innerHTML = window.MEAL_MENU
      .map(
        (m) => `
      <div class="menu-item">
        <div class="menu-icon">${m.icon}</div>
        <div>
          <div class="menu-course">${escapeHtml(m.course)}</div>
          <div class="menu-time">${escapeHtml(m.time)}</div>
          <ul>${m.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
      </div>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function formatTime(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }

  function renderBoard() {
    const board = document.getElementById("board");
    board.innerHTML = window.TRIP_DAYS
      .map((day, index) => {
        const dayBlocks = blockCache
          .filter((b) => b.day === day.date)
          .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

        const cards = dayBlocks.length
          ? dayBlocks.map(renderQuestCard).join("")
          : `<button type="button" class="day-empty" data-claim-day="${day.date}">NEEDS A DEPUTY</button>`;

        return `
        <div class="day-column">
          <div class="day-column-header">
            <span class="level-badge">${index + 1}</span>
            <span class="day-label">${day.label}</span>
            <span class="day-sub">${day.sub}</span>
          </div>
          ${cards}
        </div>`;
      })
      .join("");

    board.querySelectorAll("[data-remove-id]").forEach((btn) => {
      btn.addEventListener("click", () => handleRemove(btn.dataset.removeId));
    });
    board.querySelectorAll("[data-edit-id]").forEach((btn) => {
      btn.addEventListener("click", () => handleEdit(btn.dataset.editId));
    });
    board.querySelectorAll("[data-claim-day]").forEach((btn) => {
      btn.addEventListener("click", () => handleClaimDay(btn.dataset.claimDay));
    });

    renderChart();
  }

  function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const PERSON_COLORS = [
    "#c1712f", // copper
    "#3d6b96", // steel blue
    "#4a7c59", // sage green
    "#a13d63", // berry
    "#b8860b", // goldenrod
    "#6b4c9a", // purple
    "#c1440e", // burnt orange
    "#2f6b6b", // teal
  ];

  function colorForPerson(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return PERSON_COLORS[hash % PERSON_COLORS.length];
  }

  function renderChart() {
    const axisEl = document.getElementById("week-chart-axis");
    const rowsEl = document.getElementById("week-chart-rows");
    const legendEl = document.getElementById("week-chart-legend");
    if (!axisEl || !rowsEl) return;

    let minMin = 6 * 60;
    let maxMin = 22 * 60;
    blockCache.forEach((b) => {
      if (!b.start || !b.end) return;
      minMin = Math.min(minMin, Math.floor(timeToMinutes(b.start) / 60) * 60);
      maxMin = Math.max(maxMin, Math.ceil(timeToMinutes(b.end) / 60) * 60);
    });
    const span = maxMin - minMin;

    // Fixed, evenly-spaced landmarks rather than clock-proportional
    // positions — keeps NOON dead center and MORNING/NIGHT predictable
    // regardless of how lopsided the actual claimed times are.
    axisEl.innerHTML = [
      { left: 15, label: "MORNING" },
      { left: 50, label: "NOON" },
      { left: 85, label: "NIGHT" },
    ]
      .map((lm) => `<span class="week-axis-label" style="left:${lm.left}%">${lm.label}</span>`)
      .join("");

    rowsEl.innerHTML = window.TRIP_DAYS
      .map((day) => {
        const dayBlocks = blockCache.filter((b) => b.day === day.date);
        const segments = dayBlocks
          .map((b) => {
            const activity = activityByValue[b.activity] || { icon: "⭐", label: "Quest" };
            const s = timeToMinutes(b.start);
            const e = timeToMinutes(b.end);
            const left = ((s - minMin) / span) * 100;
            const width = Math.max(((e - s) / span) * 100, 4);
            const title = `${b.name} — ${activity.label} (${formatTime(b.start)}–${formatTime(b.end)})`;
            const color = colorForPerson(b.name);
            return `<div class="week-row-segment" style="left:${left}%;width:${width}%;background:${color}" title="${escapeHtml(title)}"><span>${activity.icon}</span><span>${escapeHtml(b.name)}</span></div>`;
          })
          .join("");
        return `
        <div class="week-chart-row">
          <div class="week-row-label">${day.label}<span class="sub">${day.sub}</span></div>
          <div class="week-row-track">${segments}</div>
        </div>`;
      })
      .join("");

    if (legendEl) {
      const names = [...new Set(blockCache.map((b) => b.name).filter(Boolean))].sort();
      legendEl.innerHTML = names
        .map(
          (name) =>
            `<span class="week-legend-chip"><span class="week-legend-dot" style="background:${colorForPerson(name)}"></span>${escapeHtml(name)}</span>`
        )
        .join("");
      legendEl.hidden = names.length === 0;
    }
  }

  function handleClaimDay(date) {
    if (editingId) handleCancelEdit();
    document.getElementById("f-day").value = date;
    document.getElementById("claim-quest").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("f-name").focus();
  }

  function renderQuestCard(block) {
    const activity = activityByValue[block.activity] || {
      icon: "⭐",
      label: "Quest",
    };
    return `
      <div class="quest-card">
        <div class="quest-icon">${activity.icon}</div>
        <div class="quest-body">
          <div class="quest-time">${formatTime(block.start)} – ${formatTime(block.end)}</div>
          <div class="quest-name">${escapeHtml(block.name)}</div>
          <div class="quest-activity">${escapeHtml(activity.label)}</div>
          ${block.notes ? `<div class="quest-notes">"${escapeHtml(block.notes)}"</div>` : ""}
        </div>
        <div class="quest-actions">
          <button type="button" class="quest-edit" data-edit-id="${block.id}" title="Edit">✎</button>
          <button type="button" class="quest-remove" data-remove-id="${block.id}" title="Cancel">✕</button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  async function refresh(showStatus) {
    try {
      if (showStatus) setStatus("Loading schedule…");
      blockCache = await loadBlocks();
      renderBoard();
      if (showStatus) setStatus("");
    } catch (err) {
      setStatus("⚠️ Couldn't load the schedule. Check your connection and hit refresh.");
      console.error(err);
    }
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    const errorEl = document.getElementById("form-error");
    errorEl.hidden = true;

    const name = document.getElementById("f-name").value.trim();
    const day = document.getElementById("f-day").value;
    const start = document.getElementById("f-start").value;
    const end = document.getElementById("f-end").value;
    const activity = document.getElementById("f-activity").value;
    const notes = document.getElementById("f-notes").value.trim();

    if (!name || !day || !start || !end || !activity) {
      errorEl.textContent = "Fill out your name, day, and times to claim a quest!";
      errorEl.hidden = false;
      return;
    }
    if (end <= start) {
      errorEl.textContent = "End time needs to be after start time.";
      errorEl.hidden = false;
      return;
    }

    const form = document.getElementById("shift-form");
    const submitBtn = form.querySelector(".btn-primary");
    submitBtn.disabled = true;
    submitBtn.textContent = "SAVING…";

    try {
      blockCache = await loadBlocks();
      if (editingId) {
        const idx = blockCache.findIndex((b) => b.id === editingId);
        const updated = { id: editingId, name, day, start, end, activity, notes };
        if (idx === -1) {
          blockCache.push(updated);
        } else {
          blockCache[idx] = updated;
        }
      } else {
        blockCache.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          day,
          start,
          end,
          activity,
          notes,
        });
      }
      await saveBlocks(blockCache);
      renderBoard();
      form.reset();
      populateFormOptions();
      editingId = null;
      setEditModeUI(false);
    } catch (err) {
      errorEl.textContent = editingId
        ? "Couldn't save your changes — try again in a moment."
        : "Couldn't save your quest — try again in a moment.";
      errorEl.hidden = false;
      console.error(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = editingId ? "💾 SAVE CHANGES" : `${SADDLE_ICON} SADDLE UP`;
    }
  }

  function setEditModeUI(isEditing) {
    const heading = document.getElementById("claim-quest-heading");
    const submitBtn = document.querySelector("#shift-form .btn-primary");
    const cancelBtn = document.getElementById("cancel-edit-btn");
    heading.innerHTML = isEditing ? "✎ Editing Quest" : `${BOOT_ICON} Sign Up, Deputy`;
    submitBtn.innerHTML = isEditing ? "💾 SAVE CHANGES" : `${SADDLE_ICON} SADDLE UP`;
    cancelBtn.hidden = !isEditing;
  }

  function handleEdit(id) {
    const block = blockCache.find((b) => b.id === id);
    if (!block) return;
    const typed = prompt(
      `Editing "${block.name}"'s quest. Type their name to confirm:`
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== block.name.trim().toLowerCase()) {
      alert("Name didn't match — quest not opened for editing.");
      return;
    }

    editingId = id;
    document.getElementById("f-name").value = block.name;
    document.getElementById("f-day").value = block.day;
    document.getElementById("f-start").value = block.start;
    document.getElementById("f-end").value = block.end;
    document.getElementById("f-activity").value = block.activity;
    document.getElementById("f-notes").value = block.notes || "";
    setEditModeUI(true);
    document.getElementById("claim-quest").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleCancelEdit() {
    editingId = null;
    document.getElementById("shift-form").reset();
    populateFormOptions();
    document.getElementById("form-error").hidden = true;
    setEditModeUI(false);
  }

  async function handleRemove(id) {
    const block = blockCache.find((b) => b.id === id);
    if (!block) return;
    const typed = prompt(
      `Cancelling "${block.name}"'s quest. Type their name to confirm:`
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== block.name.trim().toLowerCase()) {
      alert("Name didn't match — quest not cancelled.");
      return;
    }
    try {
      blockCache = blockCache.filter((b) => b.id !== id);
      await saveBlocks(blockCache);
      renderBoard();
      if (editingId === id) handleCancelEdit();
    } catch (err) {
      alert("Couldn't cancel that quest — try again.");
      console.error(err);
    }
  }

  // ---------------------------------------------------------------
  // Treats (mini social feed)
  // ---------------------------------------------------------------
  const TREATS_URL = FIREBASE_URL ? `${FIREBASE_URL}/treats.json` : "";
  const MY_NAME_KEY = "wolfiesWatchMyName";
  const TREATS_SEEN_KEY = "wolfiesWatchTreatsLastSeen";
  const TREAT_MAX_LEN = 100;
  const COMMENT_MAX_LEN = 140;

  let treatCache = [];

  function getMyName() {
    try {
      return localStorage.getItem(MY_NAME_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function setMyName(name) {
    try {
      localStorage.setItem(MY_NAME_KEY, name);
    } catch (err) {
      // ignore — nothing to persist to
    }
  }

  function promptForName() {
    const typed = prompt("What's your name?");
    if (!typed || !typed.trim()) return "";
    const name = typed.trim();
    setMyName(name);
    return name;
  }

  async function loadTreats() {
    const res = await fetch(TREATS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load treats.");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function saveTreats(treats) {
    const res = await fetch(TREATS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(treats),
    });
    if (!res.ok) throw new Error("Could not save treats.");
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function latestTreatsActivity() {
    let latest = 0;
    treatCache.forEach((t) => {
      latest = Math.max(latest, t.createdAt || 0);
      (t.comments || []).forEach((c) => {
        latest = Math.max(latest, c.createdAt || 0);
      });
    });
    return latest;
  }

  function updateTreatsBadge() {
    const badge = document.getElementById("treats-unread-badge");
    if (!badge) return;
    let lastSeen = 0;
    try {
      lastSeen = Number(localStorage.getItem(TREATS_SEEN_KEY)) || 0;
    } catch (err) {
      // ignore
    }
    badge.hidden = latestTreatsActivity() <= lastSeen;
  }

  function markTreatsSeen() {
    try {
      localStorage.setItem(TREATS_SEEN_KEY, String(Date.now()));
    } catch (err) {
      // ignore
    }
    updateTreatsBadge();
  }

  function renderTreatCard(treat) {
    const myName = getMyName();
    const likes = treat.likes || {};
    const liked = Boolean(myName && likes[myName]);
    const likeCount = Object.keys(likes).length;
    const comments = treat.comments || [];

    const commentsHtml = comments
      .map(
        (c) =>
          `<div class="treat-comment"><strong>${escapeHtml(c.author)}:</strong> ${escapeHtml(c.text)}</div>`
      )
      .join("");

    return `
      <div class="treat-card">
        <div class="treat-head">
          <span class="treat-author">${escapeHtml(treat.author)}</span>
          <span class="treat-head-right">
            <span class="treat-time">${timeAgo(treat.createdAt)}</span>
            <button type="button" class="treat-delete" data-delete-id="${treat.id}" title="Delete">✕</button>
          </span>
        </div>
        <p class="treat-text">${escapeHtml(treat.text)}</p>
        <div class="treat-actions">
          <button type="button" class="treat-like-btn${liked ? " active" : ""}" data-like-id="${treat.id}">🦴 ${likeCount}</button>
          <button type="button" class="treat-comment-toggle" data-comment-toggle="${treat.id}">💬 ${comments.length}</button>
        </div>
        <div class="treat-comments" id="treat-comments-${treat.id}" hidden>
          ${comments.length ? `<div class="treat-comment-list">${commentsHtml}</div>` : ""}
          <form class="treat-comment-form" data-comment-form="${treat.id}" autocomplete="off">
            <input type="text" maxlength="${COMMENT_MAX_LEN}" placeholder="Add a comment..." required />
            <button type="submit" class="btn-secondary">Reply</button>
          </form>
        </div>
      </div>`;
  }

  function renderTreats() {
    const list = document.getElementById("treats-list");
    if (!list) return;

    const sorted = [...treatCache].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = sorted.length
      ? sorted.map(renderTreatCard).join("")
      : `<p class="treats-empty">No treats yet — say howdy!</p>`;

    list.querySelectorAll("[data-like-id]").forEach((btn) => {
      btn.addEventListener("click", () => handleLikeTreat(btn.dataset.likeId));
    });
    list.querySelectorAll("[data-comment-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = document.getElementById(`treat-comments-${btn.dataset.commentToggle}`);
        if (panel) panel.hidden = !panel.hidden;
      });
    });
    list.querySelectorAll("[data-comment-form]").forEach((form) => {
      form.addEventListener("submit", (evt) => handleCommentSubmit(evt, form.dataset.commentForm));
    });
    list.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", () => handleDeleteTreat(btn.dataset.deleteId));
    });

    updateTreatsBadge();
  }

  async function handleDeleteTreat(id) {
    const treat = treatCache.find((t) => t.id === id);
    if (!treat) return;
    const typed = prompt(`Deleting "${treat.author}"'s treat. Type their name to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== treat.author.trim().toLowerCase()) {
      alert("Name didn't match — treat not deleted.");
      return;
    }
    try {
      treatCache = await loadTreats();
      treatCache = treatCache.filter((t) => t.id !== id);
      await saveTreats(treatCache);
      renderTreats();
    } catch (err) {
      alert("Couldn't delete that treat — try again.");
      console.error(err);
    }
  }

  async function handleLikeTreat(id) {
    let myName = getMyName();
    if (!myName) {
      myName = promptForName();
      if (!myName) return;
    }
    try {
      treatCache = await loadTreats();
      const treat = treatCache.find((t) => t.id === id);
      if (!treat) return;
      treat.likes = treat.likes || {};
      if (treat.likes[myName]) {
        delete treat.likes[myName];
      } else {
        treat.likes[myName] = true;
      }
      await saveTreats(treatCache);
      renderTreats();
    } catch (err) {
      alert("Couldn't update that like — try again.");
      console.error(err);
    }
  }

  async function handleCommentSubmit(evt, treatId) {
    evt.preventDefault();
    const input = evt.target.querySelector("input");
    const text = input.value.trim();
    if (!text) return;

    let myName = getMyName();
    if (!myName) {
      myName = promptForName();
      if (!myName) return;
    }

    const submitBtn = evt.target.querySelector("button");
    submitBtn.disabled = true;

    try {
      treatCache = await loadTreats();
      const treat = treatCache.find((t) => t.id === treatId);
      if (!treat) return;
      treat.comments = treat.comments || [];
      treat.comments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: myName,
        text,
        createdAt: Date.now(),
      });
      await saveTreats(treatCache);
      renderTreats();
      const panel = document.getElementById(`treat-comments-${treatId}`);
      if (panel) panel.hidden = false;
    } catch (err) {
      alert("Couldn't post that comment — try again.");
      console.error(err);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function updateTreatCharCount() {
    const textInput = document.getElementById("treat-text");
    const counter = document.getElementById("treat-char-count");
    if (!textInput || !counter) return;
    counter.textContent = `${textInput.value.length}/${TREAT_MAX_LEN}`;
  }

  async function handleTreatSubmit(evt) {
    evt.preventDefault();
    const errorEl = document.getElementById("treat-form-error");
    errorEl.hidden = true;

    const nameInput = document.getElementById("treat-name");
    const textInput = document.getElementById("treat-text");
    const name = nameInput.value.trim();
    const text = textInput.value.trim();

    if (!name || !text) {
      errorEl.textContent = "Fill in your name and a treat to post!";
      errorEl.hidden = false;
      return;
    }

    const form = document.getElementById("treat-form");
    const submitBtn = form.querySelector(".btn-primary");
    submitBtn.disabled = true;
    submitBtn.textContent = "POSTING…";

    try {
      setMyName(name);
      treatCache = await loadTreats();
      treatCache.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: name,
        text: text.slice(0, TREAT_MAX_LEN),
        createdAt: Date.now(),
        likes: {},
        comments: [],
      });
      await saveTreats(treatCache);
      renderTreats();
      textInput.value = "";
      updateTreatCharCount();
      markTreatsSeen();
    } catch (err) {
      errorEl.textContent = "Couldn't post your treat — try again in a moment.";
      errorEl.hidden = false;
      console.error(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Treat";
    }
  }

  async function refreshTreats() {
    if (!TREATS_URL) return;
    try {
      treatCache = await loadTreats();
      renderTreats();
    } catch (err) {
      console.error(err);
    }
  }

  function initTreatsSection() {
    const section = document.getElementById("treats-section");
    if (!section) return;

    const savedName = getMyName();
    if (savedName) document.getElementById("treat-name").value = savedName;

    document.getElementById("treat-form").addEventListener("submit", handleTreatSubmit);
    document.getElementById("treat-text").addEventListener("input", updateTreatCharCount);
    updateTreatCharCount();

    const navBtn = document.getElementById("treats-nav-btn");
    if (navBtn) {
      navBtn.addEventListener("click", () => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        markTreatsSeen();
      });
    }

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) markTreatsSeen();
          });
        },
        { threshold: 0.4 }
      );
      observer.observe(section);
    }
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  async function init() {
    initTreatsSection();
    populateFormOptions();
    renderMenu();

    document.getElementById("shift-form").addEventListener("submit", handleSubmit);
    document.getElementById("refresh-btn").addEventListener("click", () => refresh(true));
    document.getElementById("cancel-edit-btn").addEventListener("click", handleCancelEdit);

    document.getElementById("app-refresh-btn").addEventListener("click", () => location.reload());
    document.getElementById("app-close-btn").addEventListener("click", () => {
      window.close();
      // Browsers block a page from closing a tab/window it didn't itself
      // open (which is the case for a bookmark or home-screen launch), so
      // window.close() silently no-ops here in most browsers. If we're
      // still around a moment later, say so instead of leaving a dead button.
      setTimeout(() => {
        alert("Your browser won't let a page close itself here — use your phone's back gesture, the Home button, or swipe the app away to exit.");
      }, 300);
    });

    if (!BLOCKS_URL) {
      setStatus("⚠️ Shared schedule isn't configured yet — set window.FIREBASE_DB_URL in config.js.");
      return;
    }

    await refresh(true);
    await refreshTreats();
    setInterval(() => {
      refresh(false);
      refreshTreats();
    }, REFRESH_MS);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.error(err));
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
