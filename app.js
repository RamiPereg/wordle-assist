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

/** ===== State ===== */
const slots = Array.from({ length: SLOT_COUNT }, () => ({ fixedChar: "" }));

// Session-only (מתאפס בריפרש)
const hiddenPatterns = new Set(); // key של שורה שהועפה בסווייפ
const bannedPositions = new Set(); // `${letter}|${visualIndex}`  (ויזואלי: 0=ימני ביותר)

/** ===== Minimal injected styles (for menu + swipe feel) ===== */
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

/** ===== Helpers ===== */
function startKnownNoteFade() {
  if (!knownNoteEl || knownNoteTimerStarted) return;
  knownNoteTimerStarted = true;
  setTimeout(() => {
    knownNoteEl.classList.add("hidden");
  }, 3000);
}

function sanitizePool(s, maxLen) {
  // מסירים רווחים ומגבילים לאורך מקסימלי (גם אם מדביקים יותר)
  const lim = typeof maxLen === "number" ? Math.max(0, maxLen) : 5;
  return (s || "").replace(/\s+/g, "").slice(0, lim);
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

function toFinalHebrewLetter(ch) {
  const map = { כ: "ך", מ: "ם", נ: "ן", פ: "ף", צ: "ץ" };
  return map[ch] || ch;
}

function toRegularHebrewLetter(ch) {
  const map = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
  return map[ch] || ch;
}

// מפתח יציב (לא עושה התנגשויות כשהמערך כולל "")
function makeKey(arr5) {
  return arr5.join("\u0001");
}

// מיקום "ויזואלי" לפי התאים כפי שהם מופיעים על המסך.
// במבנה הנוכחי (dir=rtl + grid), התא הראשון שנוצר (i=0) הוא הימני ביותר.
// לכן visualIndex = logicalIndex.
function visualIndexFromLogical(logicalIndex) {
  return logicalIndex;
}

/** ===== Build UI for slots ===== */
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
      (i === SLOT_COUNT - 1 && slots[i].fixedChar)
        ? toFinalHebrewLetter(toRegularHebrewLetter(slots[i].fixedChar))
        : toRegularHebrewLetter(slots[i].fixedChar);

    input.value = initialDisplayChar;
    input.classList.toggle("filled", !!slots[i].fixedChar);

    // נגיעה על תא ירוק: מוחקת מיד את האות ומאפשרת הקלדה חדשה
    input.addEventListener("pointerdown", (e) => {
      if (!slots[i].fixedChar) return;
      // מנקים לפני שהמקלדת נפתחת
      e.preventDefault();
      slots[i].fixedChar = "";
      input.value = "";
      input.classList.remove("filled");
      startKnownNoteFade();
      recompute();
      // מחזירים פוקוס כדי לאפשר הקלדה מיידית
      setTimeout(() => input.focus(), 0);
    });

    input.addEventListener("input", () => {
      const v = (input.value || "").trim();
      slots[i].fixedChar = v ? toRegularHebrewLetter(v.slice(-1)) : "";

      const displayChar =
        (i === SLOT_COUNT - 1 && slots[i].fixedChar)
          ? toFinalHebrewLetter(slots[i].fixedChar)
          : slots[i].fixedChar;

      input.value = displayChar;
      input.classList.toggle("filled", !!slots[i].fixedChar);

      startKnownNoteFade();
      recompute();
    });

    input.addEventListener("keydown", (e) => {
      // ניווט ויזואלי
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

        recompute();
      }
    });

    wrap.appendChild(input);
    slotsEl.appendChild(wrap);
  }
}

/** ===== Long-press menu ===== */
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

  // מיקום: קצת מעל/מתחת לפי מקום במסך
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
  // סגירה בלחיצה מחוץ לתפריט
  if (activeMenuEl && !activeMenuEl.contains(e.target)) closeMenu();
});
window.addEventListener("scroll", closeMenu, { passive: true });
window.addEventListener("resize", closeMenu);

/** ===== Swipe to delete ===== */
function attachSwipeToLine(lineEl, patternKey) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let startTime = 0;
  let tracking = false;

  // לא לפגוע בגלילה אנכית רגילה
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
    // אם יש תפריט פתוח, סגור
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

    // אם זו תנועה אנכית מובהקת — לא מתערבים
    if (Math.abs(dy) > Math.abs(dx) * 1.2) {
      resetPosition(false);
      return;
    }

    // רק שמאלה
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

    // סטנדרט: מרחק סף או flick מהיר
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

/** ===== Render result line ===== */
function renderPattern(arr5) {
  const patternKey = makeKey(arr5);
  if (hiddenPatterns.has(patternKey)) return null;

  // סינון לפי bannedPositions
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
    // רק התא שמייצג את האות האחרונה במילה (אינדקס אחרון במערך)
    if (i === SLOT_COUNT - 1 && raw !== "_") {
      raw = toFinalHebrewLetter(raw);
    }
    span.textContent = raw;

    // long press רק אם יש אות אמיתית
    if (arr5[i]) {
      let timer = null;
      let downX = 0;
      let downY = 0;
      let canceled = false;

      span.addEventListener("pointerdown", (e) => {
        canceled = false;
        downX = e.clientX;
        downY = e.clientY;

        timer = setTimeout(() => {
          if (canceled) return;

          const letter = arr5[i]; // אות רגילה ב-state
          const visualIndex = visualIndexFromLogical(i);

          openMenuAt(e.clientX, e.clientY, () => {
            bannedPositions.add(`${letter}|${visualIndex}`);
            recompute();
          });
        }, 450);
      });

      span.addEventListener("pointermove", (e) => {
        // אם המשתמש מתחיל לגרור (סווייפ) — מבטלים long press
        const mx = Math.abs(e.clientX - downX);
        const my = Math.abs(e.clientY - downY);
        if (mx > 10 || my > 10) {
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

/** ===== Main compute ===== */
function recompute() {
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

  // Normalize pool input (אחרי שיודעים כמה ירוקות יש): סה"כ 5 אותיות בין ירוקות+צהובות
  const fixedCount = fixedPositions.size;
  const maxPoolLen = SLOT_COUNT - fixedCount; // כמה "צהובות" מותר לכל היותר
  const normalized = sanitizePool(poolEl.value, maxPoolLen);
  if (poolEl.value !== normalized) poolEl.value = normalized;

  const pool = normalized;
  const poolCounts = countChars(pool);

  // Free positions
  const freePositions = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!fixedPositions.has(i)) freePositions.push(i);
  }

  setWarning("");
  resultsEl.innerHTML = "";
  closeMenu();

  const k = pool.length;

  // אם אין אותיות ידועות — מציגים תבנית אחת: קבועות, והשאר ריק
  if (k === 0) {
    const line = renderPattern(base.slice());
    if (line) resultsEl.appendChild(line);
    return;
  }

  // אם הזנת יותר אותיות ממספר החורים — שגיאה
  if (k > freePositions.length) {
    setWarning(
      `הזנת ${k} אותיות ידועות, אבל יש רק ${freePositions.length} מקומות פנויים בתבנית.`
    );
    return;
  }

  const chosenSets = combinations(freePositions, k);

  const uniq = new Set();
  const frag = document.createDocumentFragment();

  for (const chosen of chosenSets) {
    const baseCopy = base.slice();
    const ms = new Map(poolCounts);

    const placements = generatePlacements(baseCopy, chosen, ms);
    for (const arr of placements) {
      const key = makeKey(arr);
      if (uniq.has(key)) continue;
      uniq.add(key);

      const line = renderPattern(arr);
      if (line) frag.appendChild(line);
    }
  }

  resultsEl.appendChild(frag);
}

/** ===== Init ===== */
buildSlotsUI();

poolEl.addEventListener("input", () => {
  if (poolFakePlaceholder) {
    poolFakePlaceholder.classList.toggle("hidden", poolEl.value.length > 0);
  }
  recompute();
});

recompute();
