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
          : `<p class="day-empty">NEEDS A DEPUTY</p>`;

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
  // Init
  // ---------------------------------------------------------------
  async function init() {
    populateFormOptions();
    renderMenu();

    document.getElementById("shift-form").addEventListener("submit", handleSubmit);
    document.getElementById("refresh-btn").addEventListener("click", () => refresh(true));
    document.getElementById("cancel-edit-btn").addEventListener("click", handleCancelEdit);

    if (!BLOCKS_URL) {
      setStatus("⚠️ Shared schedule isn't configured yet — set window.FIREBASE_DB_URL in config.js.");
      return;
    }

    await refresh(true);
    setInterval(() => refresh(false), REFRESH_MS);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.error(err));
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
