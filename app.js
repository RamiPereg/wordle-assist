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
const freeCountEl = document.getElementById("freeCount");
const resultCountEl = document.getElementById("resultCount");
const warningEl = document.getElementById("warning");
const perfEl = document.getElementById("perf");

/** State */
const slots = Array.from({ length: SLOT_COUNT }, () => ({
  fixedChar: ""
}));

/** Build UI for slots (בלי צ'קבוקסים) */
function buildSlotsUI() {
  slotsEl.innerHTML = "";
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotWrap = document.createElement("div");
    slotWrap.className = "slot";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 1;
    input.setAttribute("aria-label", `אות קבועה בתא ${i + 1}`);
    input.value = slots[i].fixedChar;

    input.addEventListener("input", () => {
      const v = (input.value || "").trim();
      slots[i].fixedChar = v ? v.slice(-1) : "";
      input.value = slots[i].fixedChar;
      recompute();
    });

    slotWrap.appendChild(input);
    slotsEl.appendChild(slotWrap);
  }
}

/** Helpers */
function sanitizePool(s) {
  // מסירים רווחים ומגבילים ל-4 תווים (גם אם מדביקים יותר)
  return (s || "").replace(/\s+/g, "").slice(0, 4);
}

function countChars(str) {
  const m = new Map();
  for (const ch of str) {
    m.set(ch, (m.get(ch) || 0) + 1);
  }
  return m;
}

function renderPattern(arr5) {
  const line = document.createElement("div");
  line.className = "pattern-line";

  for (let i = 0; i < SLOT_COUNT; i++) {
    const span = document.createElement("span");
    span.className = "cell" + (arr5[i] ? "" : " blank");
    span.textContent = arr5[i] ? arr5[i] : "_";
    line.appendChild(span);
  }
  return line;
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
 * Generate all unique permutations of a multiset (Map<char,count>)
 * placed into 'chosenPositions' (array of indices within 0..4).
 * Mutates baseArr5 during recursion, returns array of arrays length 5.
 */
function generatePlacements(baseArr5, chosenPositions, multisetCounts) {
  const results = [];
  const chars = [...multisetCounts.keys()].sort((a,b) => a.localeCompare(b));

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

function recompute() {
  const t0 = performance.now();

  // ננרמל את השדה וגם נעדכן אותו בפועל (כדי שאם הדביקו 10 אותיות, זה ייחתך ל-4)
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

  // positions to fill with known letters
  const freePositions = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!fixedPositions.has(i)) freePositions.push(i);
  }
  freeCountEl.textContent = String(freePositions.length);

  warningEl.style.display = "none";
  warningEl.textContent = "";

  resultsEl.innerHTML = "";
  resultCountEl.textContent = "0";
  perfEl.textContent = "";

  const k = pool.length;

  // אם אין אותיות ידועות — מציגים תוצאה אחת: רק הקבועות, והשאר _
  if (k === 0) {
    const only = base.slice();
    resultsEl.appendChild(renderPattern(only));
    resultCountEl.textContent = "1";
    return;
  }

  // אם הזנת יותר אותיות ממספר החורים — שגיאה (A)
  if (k > freePositions.length) {
    warningEl.textContent = `הזנת ${k} אותיות ידועות, אבל יש רק ${freePositions.length} מקומות פנויים בתבנית.`;
    warningEl.style.display = "block";
    return;
  }

  // מייצרים:
  // 1) בוחרים באילו חורים לשבץ את האותיות (קומבינציות)
  // 2) בכל בחירה, מייצרים את כל הפרמוטציות הייחודיות (לפי ספירה, כולל כפילויות)
  const chosenSets = combinations(freePositions, k);

  const uniq = new Set();
  const final = [];

  for (const chosen of chosenSets) {
    const baseCopy = base.slice();
    const ms = new Map(poolCounts);

    const placements = generatePlacements(baseCopy, chosen, ms);
    for (const arr of placements) {
      const key = arr.join("\u0001");
      if (uniq.has(key)) continue;
      uniq.add(key);
      final.push(arr);
    }
  }

  // רינדור
  const frag = document.createDocumentFragment();
  for (const arr of final) frag.appendChild(renderPattern(arr));
  resultsEl.appendChild(frag);

  resultCountEl.textContent = String(final.length);

  const t1 = performance.now();
  perfEl.textContent = `${final.length} תוצאות • ${Math.round(t1 - t0)}ms`;
}

buildSlotsUI();
poolEl.addEventListener("input", recompute);
recompute();
