/* PWA registration */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const SLOT_COUNT = 5;
const MAX_YELLOW = 4;

const slotsEl = document.getElementById("slots");
const poolEl = document.getElementById("pool");
const poolFakePlaceholder = document.getElementById("pool-fake-placeholder");
const duplicateToggleEl = document.getElementById("duplicate-toggle");
const yellowDuplicateToggleEl = document.getElementById("yellow-duplicate-toggle");
const resultsEl = document.getElementById("results");
const warningEl = document.getElementById("warning");
const knownNoteEl = document.getElementById("known-note");
const selectedGridEl = document.getElementById("selected-grid");
const imageUploadEl = document.getElementById("image-upload");
const imageNoteWrapEl = document.getElementById("image-note-wrap");
const imageNoteEmptyEl = document.getElementById("image-note-empty");
const imageNoteHintEl = document.getElementById("image-note-hint");
const imagePasteTargetEl = document.getElementById("image-paste-target");
const imageNoteImgEl = document.getElementById("image-note-img");
const imageNoteCloseEl = document.getElementById("image-note-close");
const imageNoteShowEl = document.getElementById("image-note-show");

let knownNoteTimerStarted = false;

const slots = Array.from({ length: SLOT_COUNT }, () => ({ fixedChar: "" }));

const hiddenPatterns = new Set();
const bannedPositions = new Set();

let imageSelectedLettersUIOnly = [];
let passiveImageDataUrl = "";
let imageContainerHidden = false;

(function injectStyles() {
  const css = `
  .pattern-line { position: relative; user-select: none; -webkit-user-select: none; }
  .pattern-line.swipe-anim { transition: transform 0.18s ease; }
  .wa-menu {
    position: fixed;
    z-index: 9999;
    background: #111;
    color: #fff;
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.25);
    font-size: 13px;
    min-width: 190px;
  }
  .wa-menu button {
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 10px 10px;
    text-align: right;
    border-radius: 10px;
    cursor: pointer;
  }
  .wa-menu button:active { background: rgba(255,255,255,0.12); }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

function startKnownNoteFade() {
  if (!knownNoteEl || knownNoteTimerStarted) return;
  knownNoteTimerStarted = true;
  setTimeout(() => knownNoteEl.classList.add("hidden"), 3000);
}

function setWarning(msg) {
  if (!warningEl) return;
  if (!msg) {
    warningEl.style.display = "none";
    warningEl.textContent = "";
    return;
  }
  warningEl.style.display = "block";
  warningEl.textContent = msg;
}

function toFinalHebrewLetter(ch) {
  const map = { כ: "ך", מ: "ם", נ: "ן", פ: "ף", צ: "ץ" };
  return map[ch] || ch;
}

function toRegularHebrewLetter(ch) {
  const map = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
  return map[ch] || ch;
}

function normalizeHebrewLetter(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const candidate = toRegularHebrewLetter(trimmed[0]);
  return /^[א-ת]$/.test(candidate) ? candidate : "";
}

function getMaxPoolLen() {
  const fixedCount = slots.filter((slot) => slot.fixedChar).length;
  return Math.max(0, SLOT_COUNT - fixedCount);
}

function sanitizePool(s, maxLen) {
  const lim = typeof maxLen === "number" ? Math.max(0, maxLen) : 5;
  const normalized = (s || "")
    .replace(/\s+/g, "")
    .split("")
    .map((ch) => normalizeHebrewLetter(ch))
    .filter(Boolean)
    .join("");
  return normalized.slice(0, lim);
}

function syncPoolPlaceholder() {
  if (poolFakePlaceholder) {
    poolFakePlaceholder.classList.toggle("hidden", poolEl.value.length > 0);
  }
}

function renderSelectedChips() {
  if (!selectedGridEl) return;
  selectedGridEl.innerHTML = "";
  imageSelectedLettersUIOnly.forEach((letter) => {
    const chip = document.createElement("div");
    chip.className = "yellow-chip";
    chip.textContent = letter;
    selectedGridEl.appendChild(chip);
  });
}

function countChars(str) {
  const m = new Map();
  for (const ch of str) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}

function countCharsArray(arr) {
  const m = new Map();
  for (const ch of arr) {
    if (!ch) continue;
    m.set(ch, (m.get(ch) || 0) + 1);
  }
  return m;
}

function combinations(positions, k) {
  const out = [];
  const n = positions.length;
  function rec(start, pick, acc) {
    if (pick === 0) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= n - pick; i++) {
      acc.push(positions[i]);
      rec(i + 1, pick - 1, acc);
      acc.pop();
    }
  }
  rec(0, k, []);
  return out;
}

function generatePlacements(baseArr5, chosenPositions, multisetCounts) {
  const results = [];
  const chars = [...multisetCounts.keys()].sort((a, b) => a.localeCompare(b));
  function backtrack(posIdx) {
    if (posIdx === chosenPositions.length) {
      results.push(baseArr5.slice());
      return;
    }
    const slotIndex = chosenPositions[posIdx];
    for (const ch of chars) {
      const remaining = multisetCounts.get(ch) || 0;
      if (remaining <= 0) continue;
      multisetCounts.set(ch, remaining - 1);
      baseArr5[slotIndex] = ch;
      backtrack(posIdx + 1);
      baseArr5[slotIndex] = "";
      multisetCounts.set(ch, remaining);
    }
  }
  backtrack(0);
  return results;
}

function generateCompletionVariants(baseArr5, completionAlphabet, maxAddedPerLetter) {
  const emptyPositions = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!baseArr5[i]) emptyPositions.push(i);
  }

  if (emptyPositions.length === 0 || completionAlphabet.length === 0) return [];

  const results = [];
  const addedCounts = new Map();

  function backtrack(posIdx, addedAny) {
    if (posIdx === emptyPositions.length) {
      if (addedAny) results.push(baseArr5.slice());
      return;
    }

    const slotIndex = emptyPositions[posIdx];

    backtrack(posIdx + 1, addedAny);

    for (const ch of completionAlphabet) {
      const current = addedCounts.get(ch) || 0;
      if (current >= maxAddedPerLetter) continue;
      addedCounts.set(ch, current + 1);
      baseArr5[slotIndex] = ch;
      backtrack(posIdx + 1, true);
      baseArr5[slotIndex] = "";
      addedCounts.set(ch, current);
    }
  }

  backtrack(0, false);
  return results;
}

function makeKey(arr5) {
  return arr5.join("\u0001");
}

function visualIndexFromLogical(logicalIndex) {
  return logicalIndex;
}

function buildSlotsUI() {
  slotsEl.innerHTML = "";
  const inputs = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const wrap = document.createElement("div");
    wrap.className = "slot";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 1;
    input.setAttribute("aria-label", `אות קבועה בתא ${i + 1}`);
    inputs[i] = input;

    const initialDisplayChar =
      i === SLOT_COUNT - 1 && slots[i].fixedChar
        ? toFinalHebrewLetter(toRegularHebrewLetter(slots[i].fixedChar))
        : toRegularHebrewLetter(slots[i].fixedChar);

    input.value = initialDisplayChar;
    input.classList.toggle("filled", !!slots[i].fixedChar);

    input.addEventListener("pointerdown", (e) => {
      if (!slots[i].fixedChar) return;
      e.preventDefault();
      slots[i].fixedChar = "";
      input.value = "";
      input.classList.remove("filled");
      startKnownNoteFade();
      renderSelectedChips();
      syncPoolPlaceholder();
      recompute();
      setTimeout(() => input.focus(), 0);
    });

    input.addEventListener("input", () => {
      const v = (input.value || "").trim();
      slots[i].fixedChar = v ? normalizeHebrewLetter(v.slice(-1)) : "";
      const displayChar =
        i === SLOT_COUNT - 1 && slots[i].fixedChar
          ? toFinalHebrewLetter(slots[i].fixedChar)
          : slots[i].fixedChar;
      input.value = displayChar;
      input.classList.toggle("filled", !!slots[i].fixedChar);
      startKnownNoteFade();
      renderSelectedChips();
      syncPoolPlaceholder();
      recompute();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = i - 1;
        if (next >= 0) inputs[next].focus();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = i + 1;
        if (next < SLOT_COUNT) inputs[next].focus();
        return;
      }
      if (e.key === "Backspace") {
        if (input.value && input.value.trim() !== "") return;
        const prev = i - 1;
        if (prev < 0) return;
        e.preventDefault();
        slots[prev].fixedChar = "";
        inputs[prev].value = "";
        inputs[prev].classList.remove("filled");
        inputs[prev].focus();
        renderSelectedChips();
        syncPoolPlaceholder();
        recompute();
      }
    });

    wrap.appendChild(input);
    slotsEl.appendChild(wrap);
  }
}

let activeMenuEl = null;

function closeMenu() {
  if (activeMenuEl) {
    activeMenuEl.remove();
    activeMenuEl = null;
  }
}

function openMenuAt(x, y, onBan) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "wa-menu";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "האות לא יכולה להיות במיקום הזה";
  btn.addEventListener("click", () => {
    closeMenu();
    onBan();
  });
  menu.appendChild(btn);
  document.body.appendChild(menu);
  const pad = 10;
  const rect = menu.getBoundingClientRect();
  let left = x - rect.width / 2;
  let top = y + 12;
  left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  activeMenuEl = menu;
}

document.addEventListener("pointerdown", (e) => {
  if (activeMenuEl && !activeMenuEl.contains(e.target)) closeMenu();
});
window.addEventListener("scroll", closeMenu, { passive: true });
window.addEventListener("resize", closeMenu);

function attachSwipeToLine(lineEl, patternKey) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let startTime = 0;
  let tracking = false;

  lineEl.style.touchAction = "pan-y";

  function resetPosition(animated) {
    if (animated) lineEl.classList.add("swipe-anim");
    lineEl.style.transform = "";
    lineEl.style.background = "";
    if (animated) {
      setTimeout(() => lineEl.classList.remove("swipe-anim"), 220);
    } else {
      lineEl.classList.remove("swipe-anim");
    }
  }

  lineEl.addEventListener("pointerdown", (e) => {
    closeMenu();
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dy = 0;
    startTime = Date.now();
    lineEl.setPointerCapture(e.pointerId);
    lineEl.classList.remove("swipe-anim");
  });

  lineEl.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) {
      resetPosition(false);
      return;
    }
    if (dx < 0) {
      lineEl.style.transform = `translateX(${dx}px)`;
      lineEl.style.background = "#ffe3e3";
    } else {
      resetPosition(false);
    }
  });

  lineEl.addEventListener("pointerup", () => {
    if (!tracking) return;
    tracking = false;
    const dt = Date.now() - startTime;
    const farEnough = dx < -lineEl.offsetWidth * 0.35;
    const fastFlick = dt < 220 && dx < -45;
    if (farEnough || fastFlick) {
      hiddenPatterns.add(patternKey);
      recompute();
      return;
    }
    resetPosition(true);
  });

  lineEl.addEventListener("pointercancel", () => {
    tracking = false;
    resetPosition(true);
  });
}

function renderPattern(arr5) {
  const patternKey = makeKey(arr5);
  if (hiddenPatterns.has(patternKey)) return null;

  for (let logicalIndex = 0; logicalIndex < SLOT_COUNT; logicalIndex++) {
    const ch = arr5[logicalIndex];
    if (!ch) continue;
    const vIdx = visualIndexFromLogical(logicalIndex);
    if (bannedPositions.has(`${ch}|${vIdx}`)) return null;
  }

  const line = document.createElement("div");
  line.className = "pattern-line";

  for (let i = 0; i < SLOT_COUNT; i++) {
    const span = document.createElement("span");
    span.className = "cell" + (arr5[i] ? "" : " blank");

    let raw = arr5[i] ? arr5[i] : "_";
    if (i === SLOT_COUNT - 1 && raw !== "_") raw = toFinalHebrewLetter(raw);
    span.textContent = raw;

    if (arr5[i]) {
      let timer = null;
      let downX = 0;
      let downY = 0;
      let downAt = 0;
      let canceled = false;

      span.addEventListener("pointerdown", (e) => {
        canceled = false;
        downX = e.clientX;
        downY = e.clientY;
        downAt = Date.now();
        timer = setTimeout(() => {
          if (canceled) return;
          const letter = arr5[i];
          const visualIndex = visualIndexFromLogical(i);
          openMenuAt(e.clientX, e.clientY, () => {
            bannedPositions.add(`${letter}|${visualIndex}`);
            recompute();
          });
        }, 450);
      });

      span.addEventListener("pointermove", (e) => {
        const elapsed = Date.now() - downAt;
        const mx = Math.abs(e.clientX - downX);
        const my = Math.abs(e.clientY - downY);
        const threshold = elapsed < 350 ? 16 : 10;
        if (mx > threshold || my > threshold) {
          canceled = true;
          if (timer) clearTimeout(timer);
          timer = null;
        }
      });

      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => {
        span.addEventListener(ev, () => {
          if (timer) clearTimeout(timer);
          timer = null;
        });
      });
    }

    line.appendChild(span);
  }

  attachSwipeToLine(line, patternKey);
  return line;
}

function renderPassiveImage() {
  if (!imageNoteWrapEl || !imageNoteShowEl || !imageNoteImgEl || !imageNoteEmptyEl) return;

  if (imageContainerHidden) {
    imageNoteWrapEl.classList.add("hidden");
    imageNoteShowEl.classList.remove("hidden");
    return;
  }

  imageNoteWrapEl.classList.remove("hidden");
  imageNoteShowEl.classList.add("hidden");

  if (passiveImageDataUrl) {
    imageNoteImgEl.src = passiveImageDataUrl;
    imageNoteImgEl.classList.remove("hidden");
    imageNoteEmptyEl.classList.add("hidden");
    imageNoteHintEl?.classList.add("hidden");
  } else {
    imageNoteImgEl.src = "";
    imageNoteImgEl.classList.add("hidden");
    imageNoteEmptyEl.classList.remove("hidden");
    imageNoteHintEl?.classList.remove("hidden");
  }
}

function setPassiveImage(dataUrl) {
  passiveImageDataUrl = dataUrl || "";
  imageContainerHidden = false;
  renderPassiveImage();
}

function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      setPassiveImage(reader.result);
    }
  };
  reader.readAsDataURL(file);
}

if (imageUploadEl) {
  imageUploadEl.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    handleImageFile(file);
  });
}

if (imageNoteWrapEl) {
  imageNoteWrapEl.addEventListener("pointerdown", (e) => {
    if (e.target === imageNoteCloseEl || e.target === imageNoteShowEl) return;
    if (!passiveImageDataUrl) {
      imagePasteTargetEl?.focus();
    }
  });

  imageNoteWrapEl.addEventListener("click", () => {
    imageUploadEl?.click();
  });
}

if (imageNoteCloseEl) {
  imageNoteCloseEl.addEventListener("click", (e) => {
    e.stopPropagation();
    imageContainerHidden = true;
    renderPassiveImage();
  });
}

if (imageNoteShowEl) {
  imageNoteShowEl.addEventListener("click", () => {
    imageContainerHidden = false;
    renderPassiveImage();
  });
}

document.addEventListener("paste", (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target !== imagePasteTargetEl) return;
  }

  const inImageArea = imageNoteWrapEl?.contains(target) || target === imagePasteTargetEl;
  if (!inImageArea) return;

  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        handleImageFile(file);
        if (imagePasteTargetEl) imagePasteTargetEl.value = "";
        break;
      }
    }
  }
});

function recompute() {
  const base = Array.from({ length: SLOT_COUNT }, () => "");
  const fixedPositions = new Set();

  for (let i = 0; i < SLOT_COUNT; i++) {
    const ch = slots[i].fixedChar;
    if (ch) {
      base[i] = ch;
      fixedPositions.add(i);
    }
  }

  const maxPoolLen = Math.min(SLOT_COUNT - fixedPositions.size, MAX_YELLOW);
  const normalizedManual = sanitizePool(poolEl.value, maxPoolLen);
  if (poolEl.value !== normalizedManual) poolEl.value = normalizedManual;

  renderSelectedChips();
  syncPoolPlaceholder();

  const pool = normalizedManual;
  const poolCounts = countChars(pool);

  const freePositions = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!fixedPositions.has(i)) freePositions.push(i);
  }

  setWarning("");
  resultsEl.innerHTML = "";
  closeMenu();

  const greenDupEnabled = !!duplicateToggleEl?.checked;
  const yellowDupEnabled = !!yellowDuplicateToggleEl?.checked;
  const k = pool.length;

  if (k > freePositions.length) {
    setWarning(`הזנת ${k} אותיות ידועות, אבל יש רק ${freePositions.length} מקומות פנויים בתבנית.`);
    return;
  }

  const chosenSets = combinations(freePositions, k);
  const basePlacements = [];

  for (const chosen of chosenSets) {
    const baseCopy = base.slice();
    const ms = new Map(poolCounts);
    const placements = generatePlacements(baseCopy, chosen, ms);
    basePlacements.push(...placements);
  }

  const uniq = new Set();
  const frag = document.createDocumentFragment();
  const orderedBasePlacements = [];

  for (const arr of basePlacements) {
    const key = makeKey(arr);
    if (uniq.has(key)) continue;
    uniq.add(key);
    orderedBasePlacements.push(arr.slice());
    const line = renderPattern(arr);
    if (line) frag.appendChild(line);
  }

  const completionAlphabetSet = new Set();
  if (greenDupEnabled) {
    for (const slot of slots) {
      if (slot.fixedChar) completionAlphabetSet.add(slot.fixedChar);
    }
  }
  if (yellowDupEnabled) {
    for (const ch of pool) completionAlphabetSet.add(ch);
  }
  const completionAlphabet = [...completionAlphabetSet];

  if (completionAlphabet.length > 0) {
    for (const baseArr of orderedBasePlacements) {
      const variants = generateCompletionVariants(baseArr.slice(), completionAlphabet, 2);
      for (const arr of variants) {
        const key = makeKey(arr);
        if (uniq.has(key)) continue;
        uniq.add(key);
        const line = renderPattern(arr);
        if (line) frag.appendChild(line);
      }
    }
  }

  resultsEl.appendChild(frag);
}

buildSlotsUI();
renderSelectedChips();
syncPoolPlaceholder();
renderPassiveImage();

poolEl.addEventListener("input", () => {
  const maxLen = Math.min(getMaxPoolLen(), MAX_YELLOW);
  const normalized = sanitizePool(poolEl.value, maxLen);
  if (poolEl.value !== normalized) poolEl.value = normalized;
  syncPoolPlaceholder();
  recompute();
});

duplicateToggleEl?.addEventListener("change", () => {
  recompute();
});

yellowDuplicateToggleEl?.addEventListener("change", () => {
  recompute();
});

recompute();
