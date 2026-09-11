(() => {
  "use strict";

  const REFRESH_MS = 15000;

  // Firebase Realtime Database REST API. A trailing slash is optional in
  // config.js; strip it here so URL-building below is consistent.
  const FIREBASE_URL = (window.FIREBASE_DB_URL || "").trim().replace(/\/+$/, "");
  const BLOCKS_URL = FIREBASE_URL ? `${FIREBASE_URL}/watchBlocks.json` : "";

  const activityByValue = Object.fromEntries(
    window.ACTIVITY_TYPES.map((a) => [a.value, a])
  );

  let blockCache = [];

  // ---------------------------------------------------------------
  // Setup / images
  // ---------------------------------------------------------------
  function applyImages() {
    document.getElementById("wolfie-avatar").src = window.WOLFIE_AVATAR;
    document.getElementById("favicon").href = window.WOLFIE_FAVICON_32;
    document.getElementById("apple-icon").href = window.WOLFIE_ICON_192;
  }

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
        <button type="button" class="quest-remove" data-remove-id="${block.id}">✕</button>
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

    const newBlock = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      day,
      start,
      end,
      activity,
      notes,
    };

    const form = document.getElementById("shift-form");
    const submitBtn = form.querySelector(".btn-primary");
    submitBtn.disabled = true;
    submitBtn.textContent = "SAVING…";

    try {
      blockCache = await loadBlocks();
      blockCache.push(newBlock);
      await saveBlocks(blockCache);
      renderBoard();
      form.reset();
      populateFormOptions();
    } catch (err) {
      errorEl.textContent = "Couldn't save your quest — try again in a moment.";
      errorEl.hidden = false;
      console.error(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "🎮 CLAIM QUEST";
    }
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
    } catch (err) {
      alert("Couldn't cancel that quest — try again.");
      console.error(err);
    }
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  async function init() {
    applyImages();
    populateFormOptions();
    renderMenu();

    document.getElementById("shift-form").addEventListener("submit", handleSubmit);
    document.getElementById("refresh-btn").addEventListener("click", () => refresh(true));

    if (!BLOCKS_URL) {
      setStatus("⚠️ Shared schedule isn't configured yet — set window.FIREBASE_DB_URL in config.js.");
      return;
    }

    await refresh(true);
    setInterval(() => refresh(false), REFRESH_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
