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
const resultsEl = document.getElementById("results");
const warningEl = document.getElementById("warning");
const knownNoteEl = document.getElementById("known-note");
const selectedGridEl = document.getElementById("selected-grid");
const imageInputWrapEl = document.getElementById("image-input");
const imageUploadEl = document.getElementById("image-upload");
const imageDropEl = document.getElementById("image-drop");
const imagePreviewEl = document.getElementById("image-preview");
const imagePreviewImg = document.getElementById("image-preview-img");
const imagePreviewCanvas = document.getElementById("image-preview-canvas");
const imageDoneBtn = document.getElementById("image-done");
const keyboardStatusEl = document.getElementById("keyboard-status");
const modalBackdrop = document.getElementById("letter-modal-backdrop");
const modalInput = document.getElementById("letter-modal-input");
const modalConfirm = document.getElementById("letter-modal-confirm");
const modalCancel = document.getElementById("letter-modal-cancel");

let knownNoteTimerStarted = false;

const slots = Array.from({ length: SLOT_COUNT }, () => ({ fixedChar: "" }));

const hiddenPatterns = new Set();
const bannedPositions = new Set();

let previewImage = null;
let imageSelectionActive = false;
let imageSelectionCompleted = false;
let markers = [];
let imageSelectedLettersUIOnly = [];
let ocrBusy = false;

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

class HebrewOCRHelper {
  // OCR only a small area around tap for better speed/accuracy vs scanning full screenshot.
  static async recognizeAtPoint(sourceImage, x, y) {
    if (!sourceImage || !window.Tesseract) return { success: false };

    const roi = this.buildProcessedROI(sourceImage, x, y);
    if (!roi) return { success: false };

    try {
      const result = await window.Tesseract.recognize(roi, "heb", {
        tessedit_pageseg_mode: "10",
        tessedit_char_whitelist: "אבגדהוזחטיכלמנסעפצקרשתךםןףץ",
      });

      const symbols = result.data?.symbols || [];
      let best = null;

      symbols.forEach((symbol) => {
        const normalized = normalizeHebrewLetter(symbol.text);
        if (!normalized) return;
        if (!best || symbol.confidence > best.confidence) {
          best = { letter: normalized, confidence: symbol.confidence };
        }
      });

      if (!best || best.confidence < 55) return { success: false };

      // Normalize final-form letters to regular forms for internal consistency.
      return { success: true, letter: best.letter, confidence: best.confidence };
    } catch {
      return { success: false };
    }
  }

  static buildProcessedROI(sourceImage, x, y) {
    const cropRadius = 46;
    const sx = Math.max(0, Math.round(x - cropRadius));
    const sy = Math.max(0, Math.round(y - cropRadius));
    const sw = Math.min(sourceImage.width - sx, cropRadius * 2);
    const sh = Math.min(sourceImage.height - sy, cropRadius * 2);
    if (sw <= 0 || sh <= 0) return null;

    const upscale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = sw * upscale;
    canvas.height = sh * upscale;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // Grayscale + threshold raise contrast to separate glyph from key background.
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      const bw = gray > 155 ? 255 : 0;
      data[i] = bw;
      data[i + 1] = bw;
      data[i + 2] = bw;
      data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas;
  }
}

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

function clearSelectedYellowLetters() {
  imageSelectedLettersUIOnly = [];
  markers = [];
  renderSelectedChips();
}

function setPoolLocked(locked) {
  poolEl.disabled = !!locked;
}

function countChars(str) {
  const m = new Map();
  for (const ch of str) m.set(ch, (m.get(ch) || 0) + 1);
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
      let canceled = false;

      span.addEventListener("pointerdown", (e) => {
        canceled = false;
        downX = e.clientX;
        downY = e.clientY;
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

function setKeyboardStatus(message, isError = false) {
  if (!keyboardStatusEl) return;
  keyboardStatusEl.textContent = message || "";
  keyboardStatusEl.style.color = isError ? "#7a1a1a" : "#555";
}

function clearYellowSelection() {
  clearSelectedYellowLetters();
  poolEl.value = "";
  syncPoolPlaceholder();
}

function beginImageSelection(dataUrl) {
  clearYellowSelection();
  imageSelectionActive = true;
  imageSelectionCompleted = false;
  setPoolLocked(true);
  if (imageInputWrapEl) imageInputWrapEl.classList.remove("hidden");
  if (imagePreviewEl) imagePreviewEl.classList.remove("hidden");
  previewImage = new Image();
  previewImage.onload = () => {
    imagePreviewImg.src = dataUrl;
    redrawPreviewCanvas();
    setKeyboardStatus("לחצי על מקשים בתמונה כדי לבחור אותיות צהובות.");
  };
  previewImage.onerror = () => {
    setWarning("לא הצלחתי להציג את התמונה. נסי שוב עם קובץ אחר.");
    endImageSelection(false);
  };
  previewImage.src = dataUrl;
}

function endImageSelection(finalize) {
  if (finalize) {
    imageSelectionCompleted = true;
  }
  imageSelectionActive = false;
  previewImage = null;
  if (imagePreviewEl) imagePreviewEl.classList.add("hidden");
  if (imagePreviewImg) imagePreviewImg.src = "";
  if (imagePreviewCanvas) {
    const ctx = imagePreviewCanvas.getContext("2d");
    ctx.clearRect(0, 0, imagePreviewCanvas.width, imagePreviewCanvas.height);
  }
  if (imageUploadEl) imageUploadEl.value = "";
  setKeyboardStatus("");
  if (finalize && imageInputWrapEl) imageInputWrapEl.classList.add("hidden");
  setPoolLocked(false);
  syncPoolPlaceholder();
  recompute();
}

function redrawPreviewCanvas() {
  if (!imagePreviewCanvas || !previewImage) return;
  const ctx = imagePreviewCanvas.getContext("2d");
  imagePreviewCanvas.width = previewImage.width;
  imagePreviewCanvas.height = previewImage.height;
  ctx.clearRect(0, 0, imagePreviewCanvas.width, imagePreviewCanvas.height);
  ctx.drawImage(previewImage, 0, 0);

  markers.forEach((marker) => {
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 19, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(241, 196, 15, 0.35)";
    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
  });
}

function markerAtPoint(x, y) {
  const threshold = 26;
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= threshold) return i;
  }
  return -1;
}

function removeLetterAndMarkerByIndex(index) {
  const marker = markers[index];
  if (!marker) return;
  markers.splice(index, 1);
  imageSelectedLettersUIOnly = imageSelectedLettersUIOnly.filter((ch) => ch !== marker.letter);
  renderSelectedChips();
  redrawPreviewCanvas();
}

function addLetterAndMarker(letter, x, y) {
  const normalized = normalizeHebrewLetter(letter);
  if (!normalized) return false;
  const maxLen = Math.min(getMaxPoolLen(), MAX_YELLOW);

  if (imageSelectedLettersUIOnly.includes(normalized)) {
    setKeyboardStatus("האות כבר נוספה.");
    return false;
  }
  if (imageSelectedLettersUIOnly.length >= maxLen) {
    setKeyboardStatus(`אפשר לבחור עד ${maxLen} אותיות צהובות.`, true);
    return false;
  }

  imageSelectedLettersUIOnly.push(normalized);
  markers.push({ x, y, letter: normalized });
  renderSelectedChips();
  syncPoolPlaceholder();
  redrawPreviewCanvas();
  return true;
}

function openManualLetterModal() {
  return new Promise((resolve) => {
    if (!modalBackdrop || !modalInput || !modalConfirm || !modalCancel) {
      resolve("");
      return;
    }

    modalInput.value = "";
    modalBackdrop.classList.remove("hidden");
    setTimeout(() => modalInput.focus(), 0);

    const close = (value) => {
      modalBackdrop.classList.add("hidden");
      modalConfirm.removeEventListener("click", onConfirm);
      modalCancel.removeEventListener("click", onCancel);
      modalInput.removeEventListener("keydown", onKeyDown);
      modalBackdrop.removeEventListener("click", onBackdrop);
      resolve(value);
    };

    const onConfirm = () => close(normalizeHebrewLetter(modalInput.value));
    const onCancel = () => close("");
    const onKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    const onBackdrop = (e) => {
      if (e.target === modalBackdrop) onCancel();
    };

    modalConfirm.addEventListener("click", onConfirm);
    modalCancel.addEventListener("click", onCancel);
    modalInput.addEventListener("keydown", onKeyDown);
    modalBackdrop.addEventListener("click", onBackdrop);
  });
}

async function recognizeLetterAtPoint(x, y) {
  if (!previewImage) return "";
  const ocrResult = await HebrewOCRHelper.recognizeAtPoint(previewImage, x, y);
  return ocrResult.success ? ocrResult.letter : "";
}

async function handleCanvasTap(event) {
  if (!imageSelectionActive || !previewImage || !imagePreviewCanvas || ocrBusy) return;
  const rect = imagePreviewCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const point = event.touches && event.touches[0] ? event.touches[0] : event;
  const scaleX = imagePreviewCanvas.width / rect.width;
  const scaleY = imagePreviewCanvas.height / rect.height;
  const x = (point.clientX - rect.left) * scaleX;
  const y = (point.clientY - rect.top) * scaleY;

  const existingMarkerIndex = markerAtPoint(x, y);
  if (existingMarkerIndex >= 0) {
    const removed = markers[existingMarkerIndex]?.letter || "";
    removeLetterAndMarkerByIndex(existingMarkerIndex);
    setKeyboardStatus(removed ? `הוסרה האות: ${removed}` : "הסימון הוסר.");
    return;
  }

  ocrBusy = true;
  setKeyboardStatus("מזהה את האות שנבחרה…");
  let letter = await recognizeLetterAtPoint(x, y);
  if (!letter) {
    setKeyboardStatus("לא זוהתה אות. הזיני ידנית.", true);
    letter = await openManualLetterModal();
  }

  if (!letter) {
    setKeyboardStatus("לא נבחרה אות תקינה.", true);
    ocrBusy = false;
    return;
  }

  const added = addLetterAndMarker(letter, x, y);
  setKeyboardStatus(added ? `נבחרה האות: ${letter}` : "לא נוספה אות חדשה.");
  ocrBusy = false;
}

function handleImageFile(file) {
  if (!file) return;
  if (imageSelectionCompleted) return;
  if (!file.type.startsWith("image/")) {
    setWarning("זה לא קובץ תמונה. נסי לבחור או להדביק תמונה בלבד.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      setWarning("");
      beginImageSelection(reader.result);
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

if (imageDropEl) {
  imageDropEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      imageUploadEl?.click();
    }
  });

  imageDropEl.addEventListener("dragover", (e) => e.preventDefault());

  imageDropEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files && e.dataTransfer.files[0];
    handleImageFile(file);
  });
}

if (imageDoneBtn) {
  imageDoneBtn.addEventListener("click", () => {
    if (!imageSelectionActive) return;
    endImageSelection(true);
  });
}

if (imagePreviewCanvas) {
  imagePreviewCanvas.addEventListener("pointerup", (event) => {
    event.preventDefault();
    handleCanvasTap(event);
  });
}

document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        handleImageFile(file);
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
  const normalizedManual = sanitizePool(poolEl.value, imageSelectionActive ? 0 : maxPoolLen);
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

  const k = pool.length;

  if (k === 0) {
    const line = renderPattern(base.slice());
    if (line) resultsEl.appendChild(line);
    return;
  }

  if (k > freePositions.length) {
    setWarning(`הזנת ${k} אותיות ידועות, אבל יש רק ${freePositions.length} מקומות פנויים בתבנית.`);
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

buildSlotsUI();
renderSelectedChips();
syncPoolPlaceholder();

poolEl.addEventListener("input", () => {
  if (imageSelectionActive) {
    syncPoolPlaceholder();
    return;
  }
  const maxLen = Math.min(getMaxPoolLen(), MAX_YELLOW);
  const normalized = sanitizePool(poolEl.value, maxLen);
  if (poolEl.value !== normalized) poolEl.value = normalized;
  syncPoolPlaceholder();
  recompute();
});

recompute();
