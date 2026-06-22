# Wordle Assist

Wordle Assist is a small, mobile-friendly, Hebrew-first helper for solving 5-letter Hebrew Wordle-style puzzles.

The app does one thing very deliberately: it takes what the player already knows about a word, generates every 5-letter arrangement that is still consistent with those clues, and lets the player eliminate impossible patterns as the game progresses.

It is intentionally simple:

- No framework
- No backend
- No login
- No build step
- Just static files, browser logic, and an installable PWA shell

## Purpose

This project is designed for the common in-game workflow:

- You already know some exact letters and exact positions.
- You already know some letters belong to the word, but not where.
- You want to see every 5-letter arrangement that is still possible.
- You want to prune the list quickly while staying inside a single lightweight screen.

The app is especially tuned for Hebrew input and Hebrew display behavior, including normalization of final-form letters.

## Core idea

The app works with a 5-slot pattern:

- Green letters: letters whose positions are already known
- Yellow letters: letters that are known to exist, but whose positions are not fixed
- Result lines: all generated 5-letter patterns consistent with the current constraints

The app does not try to guess the best word statistically and does not rank candidates by dictionary frequency. Its job is exhaustive pattern generation plus fast manual elimination.

## Main features

- Five dedicated inputs for known-position letters
- One shared input for known letters with unknown positions
- Generation of all valid 5-letter permutations from the current clue set
- Support for cases where the user enters more yellow letters than free slots remain
- Toggle for allowing green letters to appear again in free positions
- Toggle for allowing yellow letters to appear again in free positions
- Swipe-left gesture on a result row to hide that row
- Touch long-press on mobile result letters to ban a letter from a specific position
- Regular click on desktop result letters to open the same ban action
- Passive screenshot/image note area for pasting or uploading an image while solving
- PWA support for installability and offline-friendly behavior

## How to use the app

### 1. Enter green letters

Use the five boxes at the top to enter letters whose positions are already known.

Behavior:

- Each box accepts a single Hebrew letter.
- Typing a new letter replaces the previous one in that box.
- A filled green box turns green visually.
- Tapping or clicking a filled box clears it immediately.
- Backspace on an empty box clears the previous box and moves focus backward.
- Left and right arrow navigation is supported between boxes.

### 2. Enter yellow letters

Use the yellow-letter field for letters that are known to belong to the word, but whose positions are not known.

Behavior:

- Only Hebrew letters are accepted.
- Whitespace is removed automatically.
- Invalid characters are discarded.
- Final-form letters are normalized internally to their regular forms.
- The field is limited to 5 letters.
- If the user tries to type more than 5 yellow letters, the input is trimmed and the field shakes as feedback.

### 3. Review generated patterns

The results area shows all current candidate 5-letter patterns.

Each pattern is rendered as a five-cell line. Empty slots are shown as underscores when relevant.

### 4. Use duplicate toggles when needed

The app includes two optional toggles:

- `תכפיל ירוקות`
- `תכפיל צהובות`

These expand the result set when you believe the answer may repeat already-known letters.

### 5. Eliminate impossible results during solving

You can keep narrowing the list without editing the original inputs:

- Swipe a result row left to hide that row from the current session.
- Long-press a letter on touch devices to open the position-ban menu.
- Click a letter on desktop to open the same menu.
- Choose `האות לא יכולה להיות במיקום הזה` to remove every pattern where that letter appears in that exact position.

## Constraint model

This section is the most important part of understanding the app.

### Green letters

Green letters are absolute constraints:

- The letter must appear in that exact slot.
- Those positions are considered fixed.

### Yellow letters

Yellow letters are treated as a pool of letters known to belong somewhere in the word, but not tied to a specific slot.

They are not stored as individual slot bans by default. They are stored as a multiset of letters that must be distributed across available positions according to the current generation rules.

### When yellow count is less than or equal to free-slot count

If there are enough open slots to place all yellow letters:

- Every yellow letter is placed somewhere.
- The app generates every placement of that multiset across the available positions.

Example:

- Greens fix 2 positions
- 3 positions remain free
- 3 yellow letters are entered

In that case, every result will contain all 3 yellow letters.

### When yellow count is greater than free-slot count

If the user enters more yellow letters than the number of currently free positions:

- The app still generates valid 5-letter results.
- It chooses every subset of yellow letters that can fit into the remaining free positions.
- It then permutes those letters across the free positions.

This is intentional and important.

It means:

- Not every single result must contain every yellow letter.
- Across the full result set, all valid 5-letter completions are represented.

Example:

- 3 green letters are fixed
- Only 2 positions remain free
- The user enters 3 yellow letters

In this case, each single result can contain only 2 of those 3 yellow letters, because the word itself is only 5 letters long. The app therefore shows every valid 5-letter completion implied by those constraints.

## Duplicate-letter behavior

The duplicate toggles expand the result space beyond the base placements.

### `תכפיל ירוקות`

When enabled:

- Letters already fixed as green may also appear again in free positions.

### `תכפיל צהובות`

When enabled:

- Letters from the yellow pool may also appear again in free positions.

### Important implementation detail

Duplicate expansion is not limited to filling only blank cells.

The current implementation can also replace letters that were previously placed into free positions during the base permutation phase. This matters in dense scenarios such as:

- 3 greens plus 3 yellows
- 4 greens plus 2 yellows
- any case where free positions are already fully occupied before duplicate expansion runs

Without this behavior, duplicate toggles would miss valid outcomes.

## Hebrew-specific behavior

The app is Hebrew-aware in a few important ways:

- Only Hebrew letters from `א` to `ת` are accepted as letter input.
- Final forms such as `ך`, `ם`, `ן`, `ף`, `ץ` are normalized internally to their regular forms.
- When a final-form letter belongs in the last visible slot, it is rendered in its final form for display.

This keeps internal matching consistent while still showing natural Hebrew output.

## Result interactions

### Hide a pattern

Swipe a result row left to hide it.

Behavior:

- Hidden rows are removed from the current result view.
- The hide state is in-memory only.
- Reloading the page resets hidden rows.

### Ban a letter from a specific position

On a result letter:

- Touch device: long-press
- Desktop: click

Then choose:

- `האות לא יכולה להיות במיקום הזה`

Behavior:

- The app stores a temporary ban for that exact letter and that exact visual position.
- All result lines matching that banned combination are filtered out.
- The ban state is in-memory only.
- Reloading the page resets banned positions.

## Passive image note

The lower card includes an image note area.

What it does:

- Accepts uploaded image files
- Accepts pasted images
- Shows the image inline as a visual reference
- Allows temporarily hiding and re-showing the image

What it does not currently do:

- No OCR
- No automatic extraction of letters
- No board parsing
- No image-based game analysis

It is currently a passive helper panel, useful when the user wants the puzzle screenshot visible while manually entering clues.

## PWA and offline behavior

The project includes:

- `manifest.webmanifest`
- `sw.js`

This makes the app installable as a Progressive Web App and allows offline-friendly use.

Current service-worker strategy:

- Core app files are cached for resilience
- App-shell requests prefer fresh network data first
- Cached content is used as fallback when needed
- Older cache versions are cleaned up during activation

For the best PWA behavior, serve the project over HTTP or HTTPS rather than relying only on `file://` browsing.

## Project structure

### `index.html`

Contains:

- The full UI structure
- Embedded styling
- Input areas for greens and yellows
- Duplicate toggles
- Results container
- Passive image note UI

### `app.js`

Contains:

- Input normalization
- Hebrew letter handling
- Permutation generation
- Duplicate expansion logic
- Result rendering
- Swipe handling
- Letter-position banning
- Passive image note behavior
- PWA registration

### `sw.js`

Contains:

- Service worker install and activate handlers
- Cache versioning
- Core asset caching
- Request strategy for app-shell files

### `manifest.webmanifest`

Contains:

- PWA metadata
- App name
- Start URL
- Theme settings
- RTL/Hebrew metadata

## Running locally

There is no build step.

You can run the project as a static site.

### Simplest option

Open `index.html` directly in a browser.

### Better option for PWA testing

Serve the folder with any static file server, for example:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

This is the better option when testing:

- service worker behavior
- manifest behavior
- offline flow
- installability

## Browser expectations

The app expects a modern browser with support for:

- ES6 JavaScript
- Pointer events
- Service workers
- FileReader

It is designed primarily for mobile use, but includes desktop-friendly behavior for result-letter interaction as well.

## What the app does not do

To keep scope clear, this app currently does not:

- validate candidates against a dictionary
- score or rank words by probability
- persist solving state across reloads
- sync state between devices
- infer green/yellow constraints automatically from screenshots
- provide game-history tracking

## Design philosophy

This project deliberately favors:

- directness over abstraction
- touch-first interaction
- zero-dependency simplicity
- explicit user control
- exhaustive generation rather than opaque guessing

The result is a small tool that stays understandable, hackable, and easy to host anywhere.

## Notes for future maintenance

If you extend this project, the most sensitive behavior lives in the permutation engine inside `app.js`.

Changes in these areas can easily cause regressions:

- handling more yellow letters than free slots
- duplicate-letter expansion
- long-press versus click behavior on result letters
- Hebrew final-form normalization
- swipe interaction on result rows

Any logic change in those areas should be tested against real solving scenarios such as:

- 3 greens + 3 yellows
- duplicate greens enabled
- duplicate yellows enabled
- both duplicate toggles enabled
- banning a letter from a position after results are shown
- hiding rows and recomputing

## Summary

Wordle Assist is a lightweight Hebrew Wordle companion focused on exhaustive 5-letter pattern generation and fast manual pruning.

Its strength is not prediction. Its strength is clarity:

- enter what you know
- see every matching 5-letter arrangement
- remove what cannot work
- keep solving
