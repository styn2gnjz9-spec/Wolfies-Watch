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
      const s = timeToMinutes(b.start);
      // Overnight quests (end time earlier than start) run past midnight —
      // for the day's axis span, treat them as extending to end of day.
      const e = timeToMinutes(b.end) <= s ? 24 * 60 : timeToMinutes(b.end);
      minMin = Math.min(minMin, Math.floor(s / 60) * 60);
      maxMin = Math.max(maxMin, Math.ceil(e / 60) * 60);
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
            // Clip overnight bars to the end of this day's row rather than
            // wrapping to a negative width.
            const e = timeToMinutes(b.end) <= s ? 24 * 60 : timeToMinutes(b.end);
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
    if (end === start) {
      errorEl.textContent = "End time needs to be different from start time.";
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
    // renderTreats() rebuilds the whole list's HTML, which would reset
    // every open comment panel closed and wipe out anything typed into
    // a reply box mid-keystroke. Skip this background refresh cycle
    // while the user is actively focused in there; it'll pick up
    // whatever changed on the next poll instead.
    const list = document.getElementById("treats-list");
    const active = document.activeElement;
    if (
      list &&
      active &&
      list.contains(active) &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    ) {
      return;
    }
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
  // Sheriff Wolfie's Trail (mini game) — endless side-scrolling runner
  // ---------------------------------------------------------------
  const TRAIL_GOAL_MILES = 2000;
  const PX_PER_MILE = 8;
  const WIN_DISTANCE = TRAIL_GOAL_MILES * PX_PER_MILE;

  const LOGICAL_W = 640;
  const LOGICAL_H = 400;
  const GROUND_Y = 310;
  const PLAYER_X = 70;
  const PLAYER_SIZE = 58;
  const TRIGGER_X = PLAYER_X + PLAYER_SIZE / 2;

  const GRAVITY = 0.78;
  const JUMP_VELOCITY = -14;
  const HIDE_MS = 650;
  // How far (in px) before/after the trigger line an obstacle still counts
  // its avoidance -- being in the right state anywhere in that window clears
  // it, instead of needing to be in that state at one exact instant.
  const OBSTACLE_HIT_HALF_WIDTH = 26;
  const BASE_SPEED = 2.1;
  const MAX_SPEED = 3.8;

  const JUMP_OK_MSGS = ["Wolfie hops clean over it! 🐾", "Nice leap, Sheriff! 🤸", "Cleared it with room to spare! ✨"];
  const JUMP_FAIL_MSGS = ["Ouch — right into it! 😖", "Didn't clear that one. 🤕", "Should've jumped! 😵"];
  const HIDE_OK_MSGS = ["Ducked out of sight just in time! 🙈", "Smooth dodge, Sheriff! 😎", "Never even saw him go under. 🌵"];
  const HIDE_FAIL_MSGS = ["Whoosh — that one got him! 😵", "Should've ducked! 😬", "Right in the noggin'. 🤕"];
  const MARCO_DODGE_MSGS = ["Marco snarls but Wolfie's already gone! 😏", "Wolfie gives ol' Marco the slip again. 💨", "Not today, Marco! 🐺"];
  const MARCO_HIT_MSGS = ["Marco barrels right into Wolfie! Old rivalries die hard. 🐕‍🦺💥", "Marco snaps at Wolfie's tail! 😤", "Dog park drama strikes again! 🥊"];

  let trail = null;

  // ---------------------------------------------------------------
  // Boss fight: Marco blocks the road into LA with a showdown of cards
  // ---------------------------------------------------------------
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RED_SUITS = ["♥", "♦"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const HAND_NAMES = [
    "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush",
  ];
  const POKER_START_STACK = 200;
  const POKER_SMALL_BLIND = 10;
  const POKER_BIG_BLIND = 20;
  const POKER_RAISE_AMOUNT = 40;
  const POKER_MAX_RAISES_PER_STREET = 3;
  const POKER_HAND_TARGET_WINS = 2;

  let poker = null;

  const WOLFIE_PALETTE = {
    coat: "#c9944f",
    dark: "#221d1a",
    light: "#faf3e4",
    hat: "#7a4f24",
    hatBand: "#d8b25c",
    bandana: "#2b2f38",
    hasHat: true,
  };

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickRandom(list) {
    return list[randInt(0, list.length - 1)];
  }

  function drawTrailLeg(ctx, x, swingPx, color, w, h) {
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(x, 6);
    ctx.rotate(swingPx * 0.02);
    ctx.fillRect(-w / 2, 0, w, h);
    ctx.fillStyle = "#160e08";
    ctx.beginPath();
    ctx.ellipse(0, h, w / 2 + 1, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hand-drawn side-profile running dog, facing right by default (flip via
  // ctx.scale(-1, 1) before calling to face left). Origin is the dog's
  // center; drawn inside a 64x64 reference box, scaled to `size` px tall.
  function drawTrailDog(ctx, size, palette, runPhase, pose) {
    const s = size / 64;
    ctx.save();
    ctx.scale(s, s);

    if (pose === "hide") {
      // squash toward the ground-contact line (y=21) so ducking reads as
      // a real crouch, not just a shift.
      ctx.translate(0, 21);
      ctx.scale(1, 0.55);
      ctx.translate(0, -21);
    }

    const swing = pose === "run" ? Math.sin(runPhase) * 10 : 0;
    const bodyStretch = pose === "jump" ? -4 : 0;

    // back ear peeking out behind the head
    ctx.fillStyle = palette.dark;
    ctx.beginPath();
    ctx.moveTo(7, -19 + bodyStretch);
    ctx.quadraticCurveTo(3, -28 + bodyStretch, 9, -32 + bodyStretch);
    ctx.quadraticCurveTo(13, -26 + bodyStretch, 10, -17 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // legs (behind body)
    drawTrailLeg(ctx, -12, -swing, palette.dark, 8, 15);
    drawTrailLeg(ctx, 9, swing, palette.dark, 8, 15);

    // tail, curled with a lighter fluffy tip
    ctx.fillStyle = palette.coat;
    ctx.beginPath();
    ctx.moveTo(-19, -2 + bodyStretch);
    ctx.quadraticCurveTo(-31, -6 + bodyStretch, -31, -18 + bodyStretch);
    ctx.quadraticCurveTo(-29, -27 + bodyStretch, -20, -24 + bodyStretch);
    ctx.quadraticCurveTo(-24, -15 + bodyStretch, -15, -5 + bodyStretch);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.ellipse(-27, -21 + bodyStretch, 4.5, 3.6, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = palette.coat;
    ctx.beginPath();
    ctx.ellipse(-5, -2 + bodyStretch, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // chest/belly lighter patch
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.ellipse(-1, 6 + bodyStretch, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // dark saddle patch on back
    ctx.fillStyle = palette.dark;
    ctx.beginPath();
    ctx.ellipse(-7, -9 + bodyStretch, 16, 6.5, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // skull
    ctx.fillStyle = palette.dark;
    ctx.beginPath();
    ctx.ellipse(18, -10 + bodyStretch, 12, 11, -0.08, 0, Math.PI * 2);
    ctx.fill();

    // muzzle -- tapered snout instead of a round blob
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.moveTo(23, -15 + bodyStretch);
    ctx.quadraticCurveTo(34, -11 + bodyStretch, 36, -2 + bodyStretch);
    ctx.quadraticCurveTo(34, 5 + bodyStretch, 23, 4 + bodyStretch);
    ctx.quadraticCurveTo(19, -5 + bodyStretch, 23, -15 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // brow / stop shading
    ctx.fillStyle = palette.dark;
    ctx.beginPath();
    ctx.ellipse(21, -15 + bodyStretch, 4, 2.6, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // nose with a hint of a nostril
    ctx.fillStyle = "#160e08";
    ctx.beginPath();
    ctx.ellipse(35, -3 + bodyStretch, 3, 2.3, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a281c";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(34, -2.6 + bodyStretch, 0.9, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // mouth line
    ctx.strokeStyle = "#160e08";
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(31, 1 + bodyStretch);
    ctx.quadraticCurveTo(27, 4 + bodyStretch, 22, 2 + bodyStretch);
    ctx.stroke();

    // front ear
    ctx.fillStyle = palette.dark;
    ctx.beginPath();
    ctx.moveTo(13, -18 + bodyStretch);
    ctx.quadraticCurveTo(8, -30 + bodyStretch, 17, -34 + bodyStretch);
    ctx.quadraticCurveTo(24, -27 + bodyStretch, 19, -15 + bodyStretch);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.coat;
    ctx.beginPath();
    ctx.moveTo(15, -19 + bodyStretch);
    ctx.quadraticCurveTo(13, -27 + bodyStretch, 17, -30 + bodyStretch);
    ctx.quadraticCurveTo(20, -25 + bodyStretch, 18, -17 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // bandana
    ctx.fillStyle = palette.bandana;
    ctx.beginPath();
    ctx.moveTo(12, -2 + bodyStretch);
    ctx.lineTo(22, -2 + bodyStretch);
    ctx.lineTo(16, 8 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // eye with a tiny highlight
    ctx.fillStyle = "#160e08";
    ctx.beginPath();
    ctx.arc(22, -11 + bodyStretch, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(22.8, -11.8 + bodyStretch, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // whiskers
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 0.6;
    for (const wy of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(30, wy + bodyStretch);
      ctx.lineTo(40, wy - 2 + bodyStretch);
      ctx.stroke();
    }

    // sheriff hat (Wolfie only)
    if (palette.hasHat) {
      ctx.fillStyle = palette.hat;
      ctx.beginPath();
      ctx.ellipse(16, -30 + bodyStretch, 12.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(9, -31 + bodyStretch);
      ctx.quadraticCurveTo(12, -42 + bodyStretch, 20, -42 + bodyStretch);
      ctx.quadraticCurveTo(26, -38 + bodyStretch, 22, -31 + bodyStretch);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.hatBand;
      ctx.fillRect(10, -33 + bodyStretch, 12, 2.4);
    }

    ctx.restore();
  }

  // Marco: a stockier bulldog-type rival with floppy ears, an underbite,
  // and a spiked collar — a different silhouette from Wolfie, not just a
  // recolor. Same 64x64 reference box, facing right by default.
  function drawMarcoDog(ctx, size, runPhase, pose) {
    const s = size / 64;
    const coat = "#5b5854";
    const coatDark = "#38352f";
    const light = "#c9c2b4";
    const collar = "#8a1f1f";
    const spike = "#d8d3c8";

    ctx.save();
    ctx.scale(s, s);

    if (pose === "hide") {
      ctx.translate(0, 21);
      ctx.scale(1, 0.55);
      ctx.translate(0, -21);
    }

    const swing = pose === "run" ? Math.sin(runPhase) * 8 : 0;
    const bodyStretch = pose === "jump" ? -4 : 0;

    // stubby, thicker legs
    drawTrailLeg(ctx, -10, -swing, coatDark, 10, 11);
    drawTrailLeg(ctx, 8, swing, coatDark, 10, 11);

    // short tail stub
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(-21, -5 + bodyStretch, 5, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // wide, stocky body
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(-4, -2 + bodyStretch, 20, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // lighter belly
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(-2, 7 + bodyStretch, 13, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // brindle patch
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(-8, -9 + bodyStretch, 13, 6, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // big square head
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(20, -6 + bodyStretch, 14, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // flat wide muzzle, tapered
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(26, -9 + bodyStretch);
    ctx.quadraticCurveTo(37, -4 + bodyStretch, 38, 2 + bodyStretch);
    ctx.quadraticCurveTo(36, 8 + bodyStretch, 25, 6 + bodyStretch);
    ctx.quadraticCurveTo(22, -2 + bodyStretch, 26, -9 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // forehead wrinkle (grumpy)
    ctx.strokeStyle = coatDark;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(14, -15 + bodyStretch);
    ctx.quadraticCurveTo(19, -18 + bodyStretch, 24, -15 + bodyStretch);
    ctx.stroke();

    // underbite tooth
    ctx.fillStyle = "#f2ede2";
    ctx.beginPath();
    ctx.moveTo(32, 5 + bodyStretch);
    ctx.lineTo(35, 5 + bodyStretch);
    ctx.lineTo(33.4, 9 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // nose
    ctx.fillStyle = "#160e08";
    ctx.beginPath();
    ctx.ellipse(37, -1 + bodyStretch, 3, 2.4, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // floppy hanging ear (instead of Wolfie's pointy erect ear)
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.moveTo(12, -14 + bodyStretch);
    ctx.quadraticCurveTo(7, -6 + bodyStretch, 12, 3 + bodyStretch);
    ctx.quadraticCurveTo(19, 1 + bodyStretch, 17, -12 + bodyStretch);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#241512";
    ctx.beginPath();
    ctx.moveTo(13, -12 + bodyStretch);
    ctx.quadraticCurveTo(10, -6 + bodyStretch, 13, 0 + bodyStretch);
    ctx.quadraticCurveTo(16, -3 + bodyStretch, 15, -11 + bodyStretch);
    ctx.closePath();
    ctx.fill();

    // angry brow
    ctx.strokeStyle = "#160e08";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(17, -14 + bodyStretch);
    ctx.lineTo(25, -11 + bodyStretch);
    ctx.stroke();

    // eye with a tiny highlight
    ctx.fillStyle = "#160e08";
    ctx.beginPath();
    ctx.arc(24, -7 + bodyStretch, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(24.7, -7.7 + bodyStretch, 0.5, 0, Math.PI * 2);
    ctx.fill();

    // spiked collar (sits at the neck, behind the jaw/muzzle)
    ctx.fillStyle = collar;
    ctx.fillRect(1, -1 + bodyStretch, 13, 6);
    ctx.fillStyle = spike;
    for (const sx of [2, 6.5, 11]) {
      ctx.beginPath();
      ctx.moveTo(sx, -1 + bodyStretch);
      ctx.lineTo(sx + 2, -4.5 + bodyStretch);
      ctx.lineTo(sx + 4, -1 + bodyStretch);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function showTrailStatus(msg) {
    const el = document.getElementById("trail-status");
    if (!el) return;
    el.textContent = msg;
    if (trail) {
      clearTimeout(trail.statusTimer);
      if (msg) trail.statusTimer = setTimeout(() => { el.textContent = ""; }, 2200);
    }
  }

  function renderTrailHud() {
    if (!trail) return;
    document.getElementById("trail-health-bar").style.width = `${trail.health}%`;
    const milesShown = Math.min(TRAIL_GOAL_MILES, Math.floor(trail.distance / PX_PER_MILE));
    document.getElementById("trail-miles-bar").style.width = `${(milesShown / TRAIL_GOAL_MILES) * 100}%`;
    document.getElementById("trail-treats").textContent = trail.treats;
  }

  function trailStart() {
    hideTrailWinCelebration();
    document.getElementById("poker-lose").hidden = true;
    document.getElementById("poker-play").hidden = true;
    poker = null;

    const canvas = document.getElementById("trail-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (trail && trail.rafId) cancelAnimationFrame(trail.rafId);

    trail = {
      ctx,
      health: 100,
      distance: 0,
      treats: 0,
      ended: false,
      boost: false,
      lastTs: 0,
      statusTimer: null,
      nextSpawnAt: 280,
      nextMarcoAt: randInt(2800, 4400),
      obstacles: [],
      treatItems: [],
      player: { state: "run", y: 0, vy: 0, hideUntil: 0 },
    };

    document.getElementById("trail-intro").hidden = true;
    document.getElementById("trail-end").hidden = true;
    document.getElementById("trail-play").hidden = false;
    showTrailStatus("");
    renderTrailHud();

    trail.rafId = requestAnimationFrame(trailLoop);
  }

  function trailEnd(won) {
    if (!trail) return;
    trail.ended = true;
    if (trail.rafId) cancelAnimationFrame(trail.rafId);
    document.getElementById("trail-play").hidden = true;
    document.getElementById("poker-play").hidden = true;
    const endEl = document.getElementById("trail-end");
    const milesShown = Math.min(TRAIL_GOAL_MILES, Math.floor(trail.distance / PX_PER_MILE));
    document.getElementById("trail-end-message").textContent = won
      ? `🎉 Sheriff Wolfie beat Marco at the poker table and made it into LA with ${trail.treats} treats in his belly! What a good boy.`
      : `😴 Sheriff Wolfie's plum tuckered out after ${milesShown.toLocaleString()} miles and needs a nap back home. Try again?`;
    endEl.hidden = false;

    if (won) showTrailWinCelebration();
  }

  const CONFETTI_COLORS = ["#c1712f", "#3d6b96", "#4a7c59", "#a13d63", "#d8b25c", "#6b4c9a", "#c1440e"];
  let trailWinDismissTimer = null;

  function launchConfetti() {
    const layer = document.getElementById("confetti-layer");
    if (!layer) return;
    layer.innerHTML = "";
    const count = 70;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      const left = Math.random() * 100;
      const drift = (Math.random() * 160 - 80) + "px";
      const duration = 2.2 + Math.random() * 1.6;
      const delay = Math.random() * 0.6;
      const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.left = `${left}%`;
      piece.style.setProperty("--drift", drift);
      piece.style.animationDuration = `${duration}s`;
      piece.style.animationDelay = `${delay}s`;
      piece.style.background = color;
      if (Math.random() < 0.4) piece.style.borderRadius = "50%";
      layer.appendChild(piece);
    }
  }

  function showTrailWinCelebration() {
    const overlay = document.getElementById("trail-win-overlay");
    if (!overlay) return;
    overlay.hidden = false;
    launchConfetti();
    clearTimeout(trailWinDismissTimer);
    trailWinDismissTimer = setTimeout(hideTrailWinCelebration, 5000);
  }

  function hideTrailWinCelebration() {
    clearTimeout(trailWinDismissTimer);
    const overlay = document.getElementById("trail-win-overlay");
    if (overlay) overlay.hidden = true;
  }

  function checkTrailEnd() {
    if (!trail) return;
    if (trail.health <= 0) trailEnd(false);
  }

  function combinations(arr, k) {
    const results = [];
    function helper(start, combo) {
      if (combo.length === k) {
        results.push(combo.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    }
    helper(0, []);
    return results;
  }

  function buildPokerDeck() {
    const deck = [];
    for (const suit of SUITS) {
      RANKS.forEach((rank, i) => deck.push({ rank, suit, value: i + 2 }));
    }
    return deck;
  }

  function shufflePokerDeck(deck) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function evaluate5(cards) {
    const values = cards.map((c) => c.value).sort((a, b) => b - a);
    const suits = cards.map((c) => c.suit);
    const isFlush = suits.every((s) => s === suits[0]);

    const counts = {};
    for (const v of values) counts[v] = (counts[v] || 0) + 1;
    const groups = Object.entries(counts)
      .map(([v, c]) => ({ v: Number(v), c }))
      .sort((a, b) => b.c - a.c || b.v - a.v);

    const uniqueDesc = [...new Set(values)];
    let isStraight = false;
    let straightHigh = 0;
    if (uniqueDesc.length === 5) {
      if (uniqueDesc[0] - uniqueDesc[4] === 4) {
        isStraight = true;
        straightHigh = uniqueDesc[0];
      } else if (uniqueDesc.join(",") === "14,5,4,3,2") {
        isStraight = true;
        straightHigh = 5; // wheel: 5-4-3-2-A
      }
    }

    if (isStraight && isFlush) return [8, straightHigh];
    if (groups[0].c === 4) return [7, groups[0].v, groups[1].v];
    if (groups[0].c === 3 && groups[1] && groups[1].c === 2) return [6, groups[0].v, groups[1].v];
    if (isFlush) return [5, ...values];
    if (isStraight) return [4, straightHigh];
    if (groups[0].c === 3) return [3, groups[0].v, ...groups.slice(1).map((g) => g.v)];
    if (groups[0].c === 2 && groups[1] && groups[1].c === 2) {
      const pairs = [groups[0].v, groups[1].v].sort((a, b) => b - a);
      return [2, ...pairs, groups[2].v];
    }
    if (groups[0].c === 2) return [1, groups[0].v, ...groups.slice(1).map((g) => g.v)];
    return [0, ...values];
  }

  function compareHandValues(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function bestHandFrom(cards) {
    if (cards.length <= 5) return evaluate5(cards);
    let best = null;
    for (const combo of combinations(cards, 5)) {
      const val = evaluate5(combo);
      if (!best || compareHandValues(val, best) > 0) best = val;
    }
    return best;
  }

  function pokerHandName(val) {
    return HAND_NAMES[val[0]] || "High Card";
  }

  function setPokerStatus(msg) {
    const el = document.getElementById("poker-status");
    if (el) el.textContent = msg;
  }

  function enterPokerShowdown() {
    if (!trail) return;
    trail.ended = true;
    if (trail.rafId) cancelAnimationFrame(trail.rafId);

    document.getElementById("trail-play").hidden = true;
    document.getElementById("poker-play").hidden = false;
    document.getElementById("poker-lose").hidden = true;
    document.getElementById("poker-hand-result").hidden = true;

    newPokerMatch();
  }

  function newPokerMatch() {
    poker = { wolfieWins: 0, marcoWins: 0, handNum: 0 };
    document.getElementById("poker-hand-result").hidden = true;
    document.getElementById("poker-actions").hidden = false;
    startPokerHand();
  }

  function startPokerHand() {
    poker.handNum += 1;
    document.getElementById("poker-hand-num").textContent = poker.handNum;
    document.getElementById("poker-wolfie-wins").textContent = poker.wolfieWins;
    document.getElementById("poker-marco-wins").textContent = poker.marcoWins;

    poker.deck = shufflePokerDeck(buildPokerDeck());
    poker.wolfieHole = [poker.deck.pop(), poker.deck.pop()];
    poker.marcoHole = [poker.deck.pop(), poker.deck.pop()];
    poker.community = [];
    poker.street = "preflop";
    poker.wolfieStack = POKER_START_STACK;
    poker.marcoStack = POKER_START_STACK;
    poker.pot = 0;
    poker.wolfieFolded = false;
    poker.marcoFolded = false;
    poker.handOver = false;
    poker.marcoRevealed = false;

    document.getElementById("poker-hand-result").hidden = true;
    document.getElementById("poker-actions").hidden = false;
    renderPokerCards();
    renderPokerStacks();

    const sb = Math.min(POKER_SMALL_BLIND, poker.wolfieStack);
    const bb = Math.min(POKER_BIG_BLIND, poker.marcoStack);
    poker.wolfieStack -= sb;
    poker.marcoStack -= bb;
    poker.pot = sb + bb;
    renderPokerStacks();

    setPokerStatus("New hand — blinds posted. Your move, Sheriff!");
    beginPokerBettingRound(sb, bb);
  }

  function pokerStackOf(p) {
    return p === "wolfie" ? poker.wolfieStack : poker.marcoStack;
  }

  function beginPokerBettingRound(wolfieStart, marcoStart) {
    poker.committedWolfie = wolfieStart || 0;
    poker.committedMarco = marcoStart || 0;
    poker.betToMatch = Math.max(poker.committedWolfie, poker.committedMarco);
    poker.raiseCount = 0;
    poker.actor = "wolfie";
    promptPokerActor();
  }

  function pokerIsAllIn(p) {
    return pokerStackOf(p) === 0;
  }

  function promptPokerActor() {
    if (!poker || poker.handOver) return;
    const actionsEl = document.getElementById("poker-actions");
    if (poker.actor === "wolfie") {
      if (pokerIsAllIn("wolfie")) {
        endPokerStreet();
        return;
      }
      renderPokerActionButtons();
      actionsEl.hidden = false;
    } else {
      actionsEl.hidden = true;
      if (pokerIsAllIn("marco")) {
        endPokerStreet();
        return;
      }
      setTimeout(marcoPokerAct, 750 + Math.random() * 400);
    }
  }

  function renderPokerActionButtons() {
    const toCall = poker.betToMatch - poker.committedWolfie;
    document.getElementById("poker-check-label").textContent = toCall > 0 ? `Call ${toCall}` : "Check";
    document.getElementById("poker-check-btn").dataset.pokerAction = toCall > 0 ? "call" : "check";
    const raiseTo = poker.betToMatch + POKER_RAISE_AMOUNT;
    const canRaise = poker.raiseCount < POKER_MAX_RAISES_PER_STREET && poker.wolfieStack > toCall;
    document.getElementById("poker-raise-btn").hidden = !canRaise;
    document.getElementById("poker-raise-label").textContent =
      `Raise to ${Math.min(raiseTo, poker.committedWolfie + poker.wolfieStack)}`;
    document.getElementById("poker-allin-btn").hidden = poker.wolfieStack <= 0;
  }

  function pokerCommit(player, amount) {
    if (amount <= 0) return;
    if (player === "wolfie") {
      poker.wolfieStack -= amount;
      poker.committedWolfie += amount;
    } else {
      poker.marcoStack -= amount;
      poker.committedMarco += amount;
    }
    poker.pot += amount;
    renderPokerStacks();
  }

  function pokerRefundUncalled(player, amount) {
    if (amount <= 0) return;
    if (player === "wolfie") {
      poker.wolfieStack += amount;
      poker.committedWolfie -= amount;
    } else {
      poker.marcoStack += amount;
      poker.committedMarco -= amount;
    }
    poker.pot -= amount;
    renderPokerStacks();
  }

  function pokerDoCall(player) {
    const owed = poker.betToMatch - (player === "wolfie" ? poker.committedWolfie : poker.committedMarco);
    const stack = pokerStackOf(player);
    const actual = Math.min(owed, stack);
    pokerCommit(player, actual);
    if (actual < owed) {
      // capped by a short stack -- refund the opponent's uncalled excess
      const opponent = player === "wolfie" ? "marco" : "wolfie";
      pokerRefundUncalled(opponent, owed - actual);
    }
  }

  function pokerDoRaiseTo(player, targetTotal) {
    const committed = player === "wolfie" ? poker.committedWolfie : poker.committedMarco;
    const stack = pokerStackOf(player);
    const desired = targetTotal - committed;
    const actual = Math.min(desired, stack);
    pokerCommit(player, actual);
    poker.betToMatch = Math.max(poker.betToMatch, committed + actual);
    poker.raiseCount += 1;
  }

  function pokerDoAllIn(player) {
    const stack = pokerStackOf(player);
    pokerCommit(player, stack);
    const committed = player === "wolfie" ? poker.committedWolfie : poker.committedMarco;
    if (committed > poker.betToMatch) {
      poker.betToMatch = committed;
      poker.raiseCount += 1;
    } else {
      // all-in for less than the bet -- treat as a capped call, refund the excess
      const opponent = player === "wolfie" ? "marco" : "wolfie";
      const opponentCommitted = opponent === "wolfie" ? poker.committedWolfie : poker.committedMarco;
      if (opponentCommitted > committed) {
        pokerRefundUncalled(opponent, opponentCommitted - committed);
        poker.betToMatch = committed;
      }
    }
  }

  function switchPokerActor() {
    poker.actor = poker.actor === "wolfie" ? "marco" : "wolfie";
  }

  function foldPokerHand(folder) {
    if (folder === "wolfie") poker.wolfieFolded = true;
    else poker.marcoFolded = true;
    poker.handOver = true;
    const winner = folder === "wolfie" ? "marco" : "wolfie";
    if (winner === "wolfie") poker.wolfieStack += poker.pot;
    else poker.marcoStack += poker.pot;
    poker.pot = 0;
    renderPokerStacks();
    setPokerStatus(`${folder === "wolfie" ? "Wolfie" : "Marco"} folds.`);
    concludePokerHand(winner, null, null, true);
  }

  function pokerWolfieAction(action) {
    if (!poker || poker.handOver || poker.actor !== "wolfie") return;
    if (action === "fold") {
      foldPokerHand("wolfie");
      return;
    }
    if (action === "check" || action === "call") {
      pokerDoCall("wolfie");
      setPokerStatus(action === "check" ? "Wolfie checks." : "Wolfie calls.");
    } else if (action === "raise") {
      pokerDoRaiseTo("wolfie", poker.betToMatch + POKER_RAISE_AMOUNT);
      setPokerStatus(`Wolfie raises to ${poker.committedWolfie}!`);
    } else if (action === "allin") {
      pokerDoAllIn("wolfie");
      setPokerStatus("Wolfie goes ALL IN! 🔥");
    }
    switchPokerActor();
    afterPokerActionContinue();
  }

  function afterPokerActionContinue() {
    if (poker.handOver) return;
    if (poker.committedWolfie === poker.committedMarco) {
      endPokerStreet();
      return;
    }
    promptPokerActor();
  }

  function pokerHandStrength(hole, community) {
    if (community.length === 0) {
      const [a, b] = hole;
      let score = (a.value + b.value) / 28;
      if (a.value === b.value) score += 0.35;
      if (a.suit === b.suit) score += 0.05;
      if (Math.abs(a.value - b.value) === 1) score += 0.05;
      return Math.min(1, score);
    }
    const val = bestHandFrom(hole.concat(community));
    return 0.15 + (val[0] / 8) * 0.85;
  }

  function marcoPokerAct() {
    if (!poker || poker.handOver) return;
    const strength = pokerHandStrength(poker.marcoHole, poker.community);
    const bluff = Math.random() < 0.12;
    const eff = bluff ? Math.max(strength, 0.72) : strength;
    const owed = poker.betToMatch - poker.committedMarco;
    const canRaise = poker.raiseCount < POKER_MAX_RAISES_PER_STREET && poker.marcoStack > owed;

    let action;
    if (owed > 0) {
      if (eff < 0.22 && Math.random() < 0.65 && owed > POKER_BIG_BLIND) action = "fold";
      else if (eff > 0.93 && Math.random() < 0.3) action = "allin";
      else if (eff > 0.7 && canRaise && Math.random() < 0.5) action = "raise";
      else action = "call";
    } else {
      if (eff > 0.93 && Math.random() < 0.2) action = "allin";
      else if (eff > 0.58 && canRaise && Math.random() < 0.5) action = "raise";
      else action = "check";
    }

    if (action === "fold") {
      foldPokerHand("marco");
      return;
    }
    if (action === "check" || action === "call") {
      pokerDoCall("marco");
      setPokerStatus(action === "check" ? "Marco checks." : "Marco calls.");
    } else if (action === "raise") {
      pokerDoRaiseTo("marco", poker.betToMatch + POKER_RAISE_AMOUNT);
      setPokerStatus(`Marco raises to ${poker.committedMarco}!`);
    } else if (action === "allin") {
      pokerDoAllIn("marco");
      setPokerStatus("Marco shoves ALL IN! 😤");
    }
    switchPokerActor();
    afterPokerActionContinue();
  }

  function endPokerStreet() {
    if (!poker || poker.handOver) return;
    if (poker.street === "preflop") {
      poker.community.push(poker.deck.pop(), poker.deck.pop(), poker.deck.pop());
      poker.street = "flop";
    } else if (poker.street === "flop") {
      poker.community.push(poker.deck.pop());
      poker.street = "turn";
    } else if (poker.street === "turn") {
      poker.community.push(poker.deck.pop());
      poker.street = "river";
    } else {
      renderPokerCards();
      setTimeout(goToPokerShowdown, 500);
      return;
    }
    renderPokerCards();

    if (pokerIsAllIn("wolfie") || pokerIsAllIn("marco")) {
      // no more betting possible -- run it out
      setTimeout(endPokerStreet, 650);
      return;
    }
    setTimeout(() => beginPokerBettingRound(0, 0), 500);
  }

  function goToPokerShowdown() {
    poker.street = "showdown";
    revealMarcoPokerCards();
    const wolfieVal = bestHandFrom(poker.wolfieHole.concat(poker.community));
    const marcoVal = bestHandFrom(poker.marcoHole.concat(poker.community));
    const cmp = compareHandValues(wolfieVal, marcoVal);
    let winner;
    if (cmp > 0) winner = "wolfie";
    else if (cmp < 0) winner = "marco";
    else winner = "tie";

    if (winner === "tie") {
      const half = Math.floor(poker.pot / 2);
      poker.wolfieStack += half;
      poker.marcoStack += poker.pot - half;
      poker.pot = 0;
      renderPokerStacks();
      setPokerStatus("Split pot — identical hands!");
      setTimeout(() => startPokerHand(), 1600); // ties don't count -- replay
      return;
    }

    if (winner === "wolfie") poker.wolfieStack += poker.pot;
    else poker.marcoStack += poker.pot;
    poker.pot = 0;
    renderPokerStacks();
    concludePokerHand(winner, pokerHandName(wolfieVal), pokerHandName(marcoVal), false);
  }

  function concludePokerHand(winner, wolfieHandName, marcoHandName, wasFold) {
    poker.handOver = true;
    document.getElementById("poker-actions").hidden = true;
    if (winner === "wolfie") poker.wolfieWins += 1;
    else poker.marcoWins += 1;
    document.getElementById("poker-wolfie-wins").textContent = poker.wolfieWins;
    document.getElementById("poker-marco-wins").textContent = poker.marcoWins;

    let msg;
    if (wasFold) {
      msg = winner === "wolfie" ? "🎉 Marco folds — Wolfie takes the hand!" : "😬 Wolfie folds — Marco takes the hand.";
    } else {
      msg =
        winner === "wolfie"
          ? `🎉 Wolfie wins with ${wolfieHandName} (Marco had ${marcoHandName})`
          : `😬 Marco wins with ${marcoHandName} (Wolfie had ${wolfieHandName})`;
    }
    document.getElementById("poker-hand-result-message").textContent = msg;

    if (poker.wolfieWins >= POKER_HAND_TARGET_WINS || poker.marcoWins >= POKER_HAND_TARGET_WINS) {
      setTimeout(() => showPokerMatchEnd(poker.wolfieWins >= POKER_HAND_TARGET_WINS), 900);
      return;
    }

    document.getElementById("poker-hand-result").hidden = false;
  }

  function showPokerMatchEnd(wolfieWonMatch) {
    if (wolfieWonMatch) {
      trailEnd(true);
      return;
    }
    document.getElementById("poker-play").hidden = true;
    document.getElementById("poker-lose-message").textContent =
      `😵 Marco wins the showdown, ${poker.marcoWins} hands to ${poker.wolfieWins}. Give the showdown another go?`;
    document.getElementById("poker-lose").hidden = false;
  }

  function pokerCardEl(card, hidden) {
    const div = document.createElement("div");
    if (hidden) {
      div.className = "poker-card back";
      return div;
    }
    div.className = "poker-card " + (RED_SUITS.includes(card.suit) ? "red" : "black");
    div.innerHTML = `<span>${card.rank}</span><span>${card.suit}</span>`;
    return div;
  }

  function renderPokerCards() {
    const wolfieEl = document.getElementById("poker-wolfie-cards");
    const marcoEl = document.getElementById("poker-marco-cards");
    const communityEl = document.getElementById("poker-community-cards");
    wolfieEl.innerHTML = "";
    marcoEl.innerHTML = "";
    communityEl.innerHTML = "";

    poker.wolfieHole.forEach((c) => wolfieEl.appendChild(pokerCardEl(c, false)));
    const showMarco = poker.street === "showdown" || poker.marcoRevealed;
    poker.marcoHole.forEach((c) => marcoEl.appendChild(pokerCardEl(c, !showMarco)));
    poker.community.forEach((c) => communityEl.appendChild(pokerCardEl(c, false)));
  }

  function revealMarcoPokerCards() {
    poker.marcoRevealed = true;
    renderPokerCards();
  }

  function renderPokerStacks() {
    document.getElementById("poker-wolfie-stack").textContent = poker.wolfieStack;
    document.getElementById("poker-marco-stack").textContent = poker.marcoStack;
    document.getElementById("poker-pot-amount").textContent = poker.pot;
  }

  function trailJump() {
    if (!trail || trail.ended) return;
    const p = trail.player;
    if (p.state !== "run") return;
    p.state = "jump";
    p.vy = JUMP_VELOCITY;
  }

  function trailHide() {
    if (!trail || trail.ended) return;
    const p = trail.player;
    if (p.state !== "run") return;
    p.state = "hide";
    p.hideUntil = performance.now() + HIDE_MS;
  }

  function trailEat() {
    if (!trail || trail.ended) return;
    const px = PLAYER_X + PLAYER_SIZE / 2;
    let target = null;
    let bestDist = Infinity;
    for (const t of trail.treatItems) {
      if (t.eaten) continue;
      if (t.x <= px + 60 && t.x >= px - 20) {
        const d = Math.abs(t.x - px);
        if (d < bestDist) {
          bestDist = d;
          target = t;
        }
      }
    }
    if (target) {
      target.eaten = true;
      trail.treats += 1;
      trail.health = Math.min(100, trail.health + 4);
      renderTrailHud();
      showTrailStatus("Snarf! Wolfie gobbles a treat. 🦴");
    }
  }

  function setTrailBoost(on) {
    if (!trail) return;
    trail.boost = on;
  }

  function pickObstacleKind() {
    const roll = Math.random();
    if (roll < 0.32) return "cactus";
    if (roll < 0.56) return "rock";
    if (roll < 0.72) return "bird";
    if (roll < 0.88) return "tumbleweed";
    return "dust";
  }

  function spawnTrailObstacle(kind) {
    let ob;
    if (kind === "cactus") {
      ob = { kind, avoid: "jump", x: LOGICAL_W + 20, h: 52, cy: GROUND_Y - 26, emoji: "🌵" };
    } else if (kind === "rock") {
      ob = { kind, avoid: "jump", x: LOGICAL_W + 20, h: 40, cy: GROUND_Y - 20, emoji: "🪨" };
    } else if (kind === "bird") {
      ob = { kind, avoid: "hide", x: LOGICAL_W + 20, h: 36, cy: GROUND_Y - 84, emoji: "🐦" };
    } else if (kind === "tumbleweed") {
      ob = { kind, avoid: "jump", x: LOGICAL_W + 20, h: 34, cy: GROUND_Y - 17, spin: 0 };
    } else if (kind === "dust") {
      ob = { kind, avoid: "hide", x: LOGICAL_W + 20, h: 56, cy: GROUND_Y - 28, emoji: "🌪️" };
    } else {
      ob = { kind, avoid: "either", x: LOGICAL_W + 20, h: 58, cy: GROUND_Y - 29 };
    }
    ob.resolved = false;
    trail.obstacles.push(ob);
  }

  function spawnTrailTreat() {
    trail.treatItems.push({ x: LOGICAL_W + 20, eaten: false });
  }

  // Only one thing spawns per gap so obstacles/treats never land on top of
  // each other and force conflicting actions (e.g. a bone right at a cactus).
  function maybeSpawnTrail() {
    if (trail.distance < trail.nextSpawnAt) return;

    if (trail.distance >= trail.nextMarcoAt) {
      spawnTrailObstacle("marco");
      trail.nextMarcoAt = trail.distance + randInt(3600, 6500);
      trail.nextSpawnAt = trail.distance + randInt(340, 480);
      return;
    }

    if (Math.random() < 0.3) {
      spawnTrailTreat();
    } else {
      spawnTrailObstacle(pickObstacleKind());
    }
    trail.nextSpawnAt = trail.distance + randInt(300, 460);
  }

  function resolveTrailObstacle(ob) {
    ob.resolved = true;
    const cleared = Boolean(ob.cleared);

    if (ob.kind === "marco") {
      if (cleared) {
        showTrailStatus(pickRandom(MARCO_DODGE_MSGS));
      } else {
        trail.health = Math.max(0, trail.health - 22);
        showTrailStatus(pickRandom(MARCO_HIT_MSGS));
      }
    } else if (ob.avoid === "jump") {
      if (cleared) {
        showTrailStatus(pickRandom(JUMP_OK_MSGS));
      } else {
        trail.health = Math.max(0, trail.health - 12);
        showTrailStatus(pickRandom(JUMP_FAIL_MSGS));
      }
    } else if (ob.avoid === "hide") {
      if (cleared) {
        showTrailStatus(pickRandom(HIDE_OK_MSGS));
      } else {
        trail.health = Math.max(0, trail.health - 12);
        showTrailStatus(pickRandom(HIDE_FAIL_MSGS));
      }
    }

    renderTrailHud();
    checkTrailEnd();
  }

  function updateTrail(ts, step) {
    const p = trail.player;

    if (p.state === "jump") {
      p.vy += GRAVITY * step;
      p.y += p.vy * step;
      if (p.y >= 0) {
        p.y = 0;
        p.vy = 0;
        p.state = "run";
      }
    } else if (p.state === "hide" && ts >= p.hideUntil) {
      p.state = "run";
    }

    const rampSpeed = Math.min(MAX_SPEED, BASE_SPEED + trail.distance / 4000);
    const speed = rampSpeed * (trail.boost ? 1.6 : 1) * step;
    trail.distance += speed;

    maybeSpawnTrail();

    for (const ob of trail.obstacles) {
      ob.x -= speed;
      if (ob.kind === "tumbleweed") ob.spin += speed * 0.08;
      if (!ob.resolved) {
        if (ob.x <= TRIGGER_X + OBSTACLE_HIT_HALF_WIDTH) {
          const needed = ob.kind === "marco" ? p.state === "jump" || p.state === "hide" : p.state === ob.avoid;
          if (needed) ob.cleared = true;
        }
        if (ob.x <= TRIGGER_X - OBSTACLE_HIT_HALF_WIDTH) {
          resolveTrailObstacle(ob);
        }
      }
    }
    trail.obstacles = trail.obstacles.filter((ob) => ob.x > -60);

    for (const t of trail.treatItems) {
      t.x -= speed;
    }
    trail.treatItems = trail.treatItems.filter((t) => t.x > -40 && !t.eaten);

    if (trail.distance >= WIN_DISTANCE) {
      enterPokerShowdown();
      return;
    }

    renderTrailHud();
  }

  function drawTrailPlayer() {
    const ctx = trail.ctx;
    const p = trail.player;
    const cx = PLAYER_X + PLAYER_SIZE / 2;
    const cy = GROUND_Y - PLAYER_SIZE / 2 + p.y;
    const bob = p.state === "run" ? Math.sin(trail.distance / 10) * 3 : 0;
    const runPhase = trail.distance / 8;

    ctx.save();
    ctx.translate(cx, cy + bob);
    drawTrailDog(ctx, PLAYER_SIZE, WOLFIE_PALETTE, runPhase, p.state);
    ctx.restore();
  }

  function drawTrailMarco(ob) {
    const ctx = trail.ctx;
    const runPhase = trail.distance / 6;
    ctx.save();
    ctx.translate(ob.x, ob.cy);
    ctx.scale(-1, 1);
    drawMarcoDog(ctx, ob.h, runPhase, "run");
    ctx.restore();
  }

  function drawTrailTumbleweed(ob) {
    const ctx = trail.ctx;
    const r = ob.h / 2;
    ctx.save();
    ctx.translate(ob.x, ob.cy);
    ctx.rotate(ob.spin);
    ctx.strokeStyle = "#8a6a3a";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.5, a, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  const MOUNTAIN_TILE_W = 260;

  function drawTrailMountains(ctx, offsetX, baseY, color, heightScale) {
    const tilesNeeded = Math.ceil(LOGICAL_W / MOUNTAIN_TILE_W) + 2;
    ctx.fillStyle = color;
    for (let i = -1; i < tilesNeeded; i++) {
      const tx = offsetX + i * MOUNTAIN_TILE_W;
      ctx.beginPath();
      ctx.moveTo(tx, baseY);
      ctx.lineTo(tx, baseY - 55 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W * 0.18, baseY - 95 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W * 0.35, baseY - 62 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W * 0.5, baseY - 110 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W * 0.68, baseY - 68 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W * 0.85, baseY - 90 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W, baseY - 55 * heightScale);
      ctx.lineTo(tx + MOUNTAIN_TILE_W, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawTrail() {
    const ctx = trail.ctx;
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // two parallax mountain layers, both rooted at the ground line so they
    // don't float -- far (slow, short, hazy) and near (faster, taller, richer)
    drawTrailMountains(ctx, -(trail.distance * 0.05) % MOUNTAIN_TILE_W, GROUND_Y, "rgba(150, 118, 98, 0.38)", 0.62);
    drawTrailMountains(ctx, -(trail.distance * 0.1) % MOUNTAIN_TILE_W - 90, GROUND_Y, "rgba(120, 90, 72, 0.55)", 1);

    ctx.font = "26px sans-serif";
    ctx.fillText("☀️", 580, 38);

    ctx.fillStyle = "#935420";
    ctx.fillRect(0, GROUND_Y, LOGICAL_W, LOGICAL_H - GROUND_Y);
    ctx.strokeStyle = "#2a1c12";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(LOGICAL_W, GROUND_Y);
    ctx.stroke();

    ctx.strokeStyle = "#7a4318";
    ctx.lineWidth = 3;
    const dashOffset = -(trail.distance % 32);
    for (let x = dashOffset; x < LOGICAL_W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 11);
      ctx.lineTo(x + 16, GROUND_Y + 11);
      ctx.stroke();
    }

    ctx.font = "28px sans-serif";
    for (const t of trail.treatItems) {
      if (t.eaten) continue;
      ctx.fillText("🦴", t.x, GROUND_Y - 16);
    }

    for (const ob of trail.obstacles) {
      if (ob.kind === "marco") {
        drawTrailMarco(ob);
        continue;
      }
      if (ob.kind === "tumbleweed") {
        drawTrailTumbleweed(ob);
        continue;
      }
      ctx.font = `${ob.h}px sans-serif`;
      ctx.fillText(ob.emoji, ob.x, ob.cy);
    }

    drawTrailPlayer();
  }

  function trailLoop(ts) {
    if (!trail || trail.ended) return;
    if (!trail.lastTs) trail.lastTs = ts;
    const dt = Math.min(48, ts - trail.lastTs);
    trail.lastTs = ts;
    const step = dt / 16.6667;

    updateTrail(ts, step);
    if (trail && !trail.ended) {
      drawTrail();
      trail.rafId = requestAnimationFrame(trailLoop);
    }
  }

  function initTrailGame() {
    const section = document.getElementById("trail-game");
    if (!section) return;

    document.getElementById("trail-start-btn").addEventListener("click", trailStart);
    document.getElementById("trail-restart-btn").addEventListener("click", trailStart);

    const winOverlay = document.getElementById("trail-win-overlay");
    document.getElementById("trail-win-close-btn").addEventListener("click", hideTrailWinCelebration);
    winOverlay.addEventListener("click", (e) => {
      if (e.target === winOverlay) hideTrailWinCelebration();
    });

    section.querySelectorAll("[data-trail-ctrl]").forEach((btn) => {
      const ctrl = btn.dataset.trailCtrl;
      if (ctrl === "run") {
        const start = (e) => {
          e.preventDefault();
          setTrailBoost(true);
          btn.classList.add("is-active");
        };
        const stop = () => {
          setTrailBoost(false);
          btn.classList.remove("is-active");
        };
        btn.addEventListener("pointerdown", start);
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointerleave", stop);
        btn.addEventListener("pointercancel", stop);
      } else {
        btn.addEventListener("click", () => {
          if (ctrl === "jump") trailJump();
          else if (ctrl === "hide") trailHide();
          else if (ctrl === "eat") trailEat();
        });
      }
    });

    document.getElementById("poker-retry-btn").addEventListener("click", () => {
      document.getElementById("poker-lose").hidden = true;
      document.getElementById("poker-play").hidden = false;
      newPokerMatch();
    });

    document.getElementById("poker-next-hand-btn").addEventListener("click", () => {
      document.getElementById("poker-hand-result").hidden = true;
      startPokerHand();
    });

    document.getElementById("poker-actions").querySelectorAll("[data-poker-action]").forEach((btn) => {
      btn.addEventListener("click", () => pokerWolfieAction(btn.dataset.pokerAction));
    });

    const canvas = document.getElementById("trail-canvas");
    canvas.addEventListener("pointerdown", () => {
      trailJump();
    });

    document.addEventListener("keydown", (e) => {
      if (!trail || trail.ended) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (!e.repeat) trailJump();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        if (!e.repeat) trailHide();
      } else if (e.code === "KeyE") {
        if (!e.repeat) trailEat();
      } else if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "ArrowRight") {
        setTrailBoost(true);
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "ArrowRight") setTrailBoost(false);
    });
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  async function init() {
    initTrailGame();
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
