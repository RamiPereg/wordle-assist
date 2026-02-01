/* PWA registration */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const SLOT_COUNT = 5;

const slotsEl = document.getElementById("slots");
const poolEl = document.getElementById("pool");
const poolFakePlaceholder = document.getElementById("pool-fake-placeholder");
const resultsEl = document.getElementById("results");
const warningEl = document.getElementById("warning");
const knownNoteEl = document.getElementById("known-note");
let knownNoteTimerStarted = false;

/* ====== STATE ====== */
const slots = Array.from({ length: SLOT_COUNT }, () => ({ fixedChar: "" }));
const hiddenWords = new Set();               // מילים שהועפו בסווייפ
const bannedPositions = new Set();           // `${letter}|${visualIndex}`

/* ====== UI HELPERS ====== */
function startKnownNoteFade() {
  if (!knownNoteEl || knownNoteTimerStarted) return;
  knownNoteTimerStarted = true;
  setTimeout(() => knownNoteEl.classList.add("hidden"), 3000);
}

function toFinalHebrewLetter(ch) {
  const map = { כ:"ך", מ:"ם", נ:"ן", פ:"ף", צ:"ץ" };
  return map[ch] || ch;
}

function toRegularHebrewLetter(ch) {
  const map = { ך:"כ", ם:"מ", ן:"נ", ף:"פ", ץ:"צ" };
  return map[ch] || ch;
}

function sanitizePool(s) {
  return (s || "").replace(/\s+/g, "").slice(0, 4);
}

function countChars(str) {
  const m = new Map();
  for (const ch of str) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}

function setWarning(msg) {
  if (!warningEl) return;
  warningEl.style.display = msg ? "block" : "none";
  warningEl.textContent = msg || "";
}

/* ====== BUILD SLOTS ====== */
function buildSlotsUI() {
  slotsEl.innerHTML = "";
  const inputs = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const wrap = document.createElement("div");
    wrap.className = "slot";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 1;
    inputs[i] = input;

    input.value =
      (i === SLOT_COUNT - 1 && slots[i].fixedChar)
        ? toFinalHebrewLetter(slots[i].fixedChar)
        : slots[i].fixedChar;

    input.classList.toggle("filled", !!slots[i].fixedChar);

    input.addEventListener("input", () => {
      const v = (input.value || "").trim();
      slots[i].fixedChar = v ? toRegularHebrewLetter(v.slice(-1)) : "";
      input.value =
        (i === SLOT_COUNT - 1 && slots[i].fixedChar)
          ? toFinalHebrewLetter(slots[i].fixedChar)
          : slots[i].fixedChar;
      input.classList.toggle("filled", !!slots[i].fixedChar);
      startKnownNoteFade();
      recompute();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (i > 0) inputs[i - 1].focus();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (i < SLOT_COUNT - 1) inputs[i + 1].focus();
      }
      if (e.key === "Backspace" && !input.value) {
        e.preventDefault();
        if (i > 0) {
          slots[i - 1].fixedChar = "";
          inputs[i - 1].value = "";
          inputs[i - 1].classList.remove("filled");
          inputs[i - 1].focus();
          recompute();
        }
      }
    });

    wrap.appendChild(input);
    slotsEl.appendChild(wrap);
  }
}

/* ====== COMBINATORICS ====== */
function combinations(arr, k) {
  const out = [];
  function rec(start, acc) {
    if (acc.length === k) return out.push(acc.slice());
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  }
  rec(0, []);
  return out;
}

function generatePlacements(base, chosen, counts) {
  const results = [];
  const chars = [...counts.keys()];

  function backtrack(idx) {
    if (idx === chosen.length) {
      results.push(base.slice());
      return;
    }
    const pos = chosen[idx];
    for (const ch of chars) {
      if (!counts.get(ch)) continue;
      counts.set(ch, counts.get(ch) - 1);
      base[pos] = ch;
      backtrack(idx + 1);
      base[pos] = "";
      counts.set(ch, counts.get(ch) + 1);
    }
  }

  backtrack(0);
  return results;
}

/* ====== RENDER LINE ====== */
function renderPattern(arr5) {
  const line = document.createElement("div");
  line.className = "pattern-line";

  const wordKey = arr5.join("");
  if (hiddenWords.has(wordKey)) return null;

  arr5.forEach((rawCh, logicalIndex) => {
    const cell = document.createElement("span");
    cell.className = "cell" + (rawCh ? "" : " blank");

    let ch = rawCh || "_";
    if (logicalIndex === SLOT_COUNT - 1 && ch !== "_") {
      ch = toFinalHebrewLetter(ch);
    }

    cell.textContent = ch;

    // long press
    let pressTimer = null;
    cell.addEventListener("pointerdown", () => {
      if (!rawCh) return;
      pressTimer = setTimeout(() => {
        const visualIndex = SLOT_COUNT - 1 - logicalIndex;
        bannedPositions.add(`${rawCh}|${visualIndex}`);
        recompute();
      }, 450);
    });
    ["pointerup", "pointerleave", "pointercancel"]
      .forEach(ev => cell.addEventListener(ev, () => clearTimeout(pressTimer)));

    line.appendChild(cell);
  });

  enableSwipeToDelete(line, wordKey);
  return line;
}

/* ====== SWIPE DELETE ====== */
function enableSwipeToDelete(el, wordKey) {
  let startX = 0, currentX = 0, startTime = 0;
  el.style.touchAction = "pan-y";

  el.addEventListener("pointerdown", e => {
    startX = e.clientX;
    startTime = Date.now();
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", e => {
    currentX = e.clientX - startX;
    if (currentX < 0) {
      el.style.transform = `translateX(${currentX}px)`;
      el.style.background = "#ffdddd";
    }
  });

  el.addEventListener("pointerup", () => {
    const dt = Date.now() - startTime;
    const fast = dt < 200 && currentX < -40;
    const far = currentX < -el.offsetWidth * 0.35;

    if (fast || far) {
      hiddenWords.add(wordKey);
      recompute();
    } else {
      el.style.transform = "";
      el.style.background = "";
    }
  });
}

/* ====== RECOMPUTE ====== */
function recompute() {
  const normalized = sanitizePool(poolEl.value);
  poolEl.value = normalized;

  const poolCounts = countChars(normalized);
  const base = Array(SLOT_COUNT).fill("");
  const fixed = new Set();

  slots.forEach((s, i) => {
    if (s.fixedChar) {
      base[i] = s.fixedChar;
      fixed.add(i);
    }
  });

  const free = [...Array(SLOT_COUNT).keys()].filter(i => !fixed.has(i));
  resultsEl.innerHTML = "";
  setWarning("");

  if (normalized.length > free.length) {
    setWarning("יותר אותיות ידועות ממקומות פנויים");
    return;
  }

  if (!normalized.length) {
    const line = renderPattern(base.slice());
    if (line) resultsEl.appendChild(line);
    return;
  }

  const chosenSets = combinations(free, normalized.length);
  const uniq = new Set();

  for (const chosen of chosenSets) {
    const placements = generatePlacements(base.slice(), chosen, new Map(poolCounts));
    for (const arr of placements) {
      const key = arr.join("");
      if (uniq.has(key)) continue;
      uniq.add(key);

      // בדיקת bannedPositions
      let blocked = false;
      arr.forEach((ch, logicalIndex) => {
        if (!ch) return;
        const visualIndex = SLOT_COUNT - 1 - logicalIndex;
        if (bannedPositions.has(`${ch}|${visualIndex}`)) blocked = true;
      });
      if (blocked) continue;

      const line = renderPattern(arr);
      if (line) resultsEl.appendChild(line);
    }
  }
}

/* ====== INIT ====== */
buildSlotsUI();
poolEl.addEventListener("input", () => {
  poolFakePlaceholder?.classList.toggle("hidden", poolEl.value.length > 0);
  recompute();
});
recompute();
