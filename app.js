/* PWA registration */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const SLOT_COUNT = 5;

const slotsEl = document.getElementById("slots");
const poolEl = document.getElementById("pool");
const resultsEl = document.getElementById("results");
const warningEl = document.getElementById("warning");

/** State */
const slots = Array.from({ length: SLOT_COUNT }, () => ({ fixedChar: "" }));

/** Build UI for slots */
/** Build UI for slots */
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

    // תצוגה ראשונית (כולל אות סופית אם זה התא השמאלי)
    const initialDisplayChar =
      (i === SLOT_COUNT - 1 && slots[i].fixedChar)
        ? toFinalHebrewLetter(toRegularHebrewLetter(slots[i].fixedChar))
        : toRegularHebrewLetter(slots[i].fixedChar);

    input.value = initialDisplayChar;
    input.classList.toggle("filled", !!slots[i].fixedChar);

    input.addEventListener("input", () => {
      const v = (input.value || "").trim();
      slots[i].fixedChar = v ? toRegularHebrewLetter(v.slice(-1)) : "";

      // תצוגה בזמן הקלדה (כולל אות סופית אם זה התא השמאלי)
      const displayChar =
        (i === SLOT_COUNT - 1 && slots[i].fixedChar)
          ? toFinalHebrewLetter(slots[i].fixedChar)
          : slots[i].fixedChar;

      input.value = displayChar;

      input.classList.toggle("filled", !!slots[i].fixedChar);
      recompute();
    });

    input.addEventListener("keydown", (e) => {
      // ניווט בלבד עם חיצים (ויזואלי)
      if (e.key === "ArrowRight") {
        // ימינה על המסך => אינדקס קטן יותר
        e.preventDefault();
        const next = i - 1;
        if (next >= 0) inputs[next].focus();
        return;
      }

      if (e.key === "ArrowLeft") {
        // שמאלה על המסך => אינדקס גדול יותר
        e.preventDefault();
        const next = i + 1;
        if (next < SLOT_COUNT) inputs[next].focus();
        return;
      }

      // Backspace חורנית: אם התא ריק – עוברים תא אחד אחורה (לכיוון תחילת המילה, אינדקס קטן יותר) ומוחקים שם
      if (e.key === "Backspace") {
        // אם יש תוכן בתא הנוכחי – נותנים ל-Backspace הרגיל למחוק (ה-event של input יעדכן state)
        if (input.value && input.value.trim() !== "") return;

        const prev = i - 1;
        if (prev < 0) return;

        e.preventDefault();

        slots[prev].fixedChar = "";
        inputs[prev].value = "";
        inputs[prev].classList.remove("filled");
        inputs[prev].focus();

        recompute();
      }
    });

    wrap.appendChild(input);
    slotsEl.appendChild(wrap);
  }
}

/** Helpers */
function sanitizePool(s) {
  // מסירים רווחים ומגבילים ל-4 תווים (גם אם מדביקים יותר)
  return (s || "").replace(/\s+/g, "").slice(0, 4);
}

function countChars(str) {
  const m = new Map();
  for (const ch of str) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
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

/** קומבינציות: לבחור k מקומות מתוך positions */
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

/**
 * Generate all unique permutations of a multiset placed into chosenPositions
 */
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

function toFinalHebrewLetter(ch) {
  const map = {
    "כ": "ך",
    "מ": "ם",
    "נ": "ן",
    "פ": "ף",
    "צ": "ץ",
  };
  return map[ch] || ch;
}

function toRegularHebrewLetter(ch) {
  const map = {
    "ך": "כ",
    "ם": "מ",
    "ן": "נ",
    "ף": "פ",
    "ץ": "צ",
  };
  return map[ch] || ch;
}


function renderPattern(arr5) {
  const line = document.createElement("div");
  line.className = "pattern-line";

  for (let i = 0; i < SLOT_COUNT; i++) {
    const span = document.createElement("span");
    span.className = "cell" + (arr5[i] ? "" : " blank");
    let ch = arr5[i] ? arr5[i] : "_";

// רק התא שמייצג את האות האחרונה במילה (אינדקס אחרון במחרוזת)
if (i === SLOT_COUNT - 1 && ch !== "_") {
  ch = toFinalHebrewLetter(ch);
}

span.textContent = ch;
    line.appendChild(span);
  }
  return line;
}

function recompute() {
  // Normalize pool input and hard-limit to 4 chars
  const normalized = sanitizePool(poolEl.value);
  if (poolEl.value !== normalized) poolEl.value = normalized;

  const pool = normalized;
  const poolCounts = countChars(pool);

  // Base array with fixed chars
  const base = Array.from({ length: SLOT_COUNT }, () => "");
  const fixedPositions = new Set();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const ch = slots[i].fixedChar;
    if (ch) {
      base[i] = ch;
      fixedPositions.add(i);
    }
  }

  // Free positions
  const freePositions = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!fixedPositions.has(i)) freePositions.push(i);
  }

  setWarning("");
  resultsEl.innerHTML = "";

  const k = pool.length;

  // אם אין אותיות ידועות — מציגים תבנית אחת: קבועות, והשאר ריק
  if (k === 0) {
    resultsEl.appendChild(renderPattern(base.slice()));
    return;
  }

  // אם הזנת יותר אותיות ממספר החורים — שגיאה (A)
  if (k > freePositions.length) {
    setWarning(`הזנת ${k} אותיות ידועות, אבל יש רק ${freePositions.length} מקומות פנויים בתבנית.`);
    return;
  }

  // Generate:
  // 1) choose which holes to fill
  // 2) generate all unique permutations for the multiset
  const chosenSets = combinations(freePositions, k);

  const uniq = new Set();
  const frag = document.createDocumentFragment();

  for (const chosen of chosenSets) {
    const baseCopy = base.slice();
    const ms = new Map(poolCounts);

    const placements = generatePlacements(baseCopy, chosen, ms);
    for (const arr of placements) {
      const key = arr.join("\u0001");
      if (uniq.has(key)) continue;
      uniq.add(key);
      frag.appendChild(renderPattern(arr));
    }
  }

  resultsEl.appendChild(frag);
}

buildSlotsUI();
poolEl.addEventListener("input", recompute);
recompute();

