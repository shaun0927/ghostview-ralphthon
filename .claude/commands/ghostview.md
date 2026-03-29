Run a GhostView accessibility parity audit on the target URL: $ARGUMENTS

## Pipeline Overview

```
navigate → hero screenshot → ghost detection (3 levels) →
screenshot capture loop (inject overlay → screenshot → remove) →
LLM analysis (Pass 2 + findings) → report generation → summary
```

---

### Step 1: Navigate

Use OpenChrome `navigate` to open the page. If navigation fails, write an empty result and stop.

### Step 2: Hero Screenshot (Before/After)

Scroll to top. Take a full-viewport screenshot using `page_screenshot` (omit `path` for base64 return). Save as `heroScreenshot`.

Then capture the "AI View" blackhole screenshot:
1. Inject blackhole overlays via `batch_execute`:
   ```
   batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.blackhole_all }]
   ```
2. Take screenshot via `page_screenshot` → save as `heroBlackhole`
3. Remove blackhole: `batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.removeBlackhole }]`

Both `heroScreenshot` and `heroBlackhole` are embedded in the report as a draggable before/after slider.

### Step 3: Count Interactive Elements

Use `batch_execute` to run:
```
document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[onclick],[tabindex="0"]').length
```
Store as `totalInteractive`.

### Step 4: Ghost Detection (3 Levels)

Run ALL detection queries from `ghostview/scripts/ghost-detect.js` via `javascript_tool`.

**Level 1 — GHOST (completely missing):**
Use `getGhostQueries()` — run each `collectExpression` to get ghost elements.

**Level 2 — AMBIGUOUS (label exists but useless):**
Use `batch_execute` to run these queries from `nightshift/scripts/ghost-queries.js`:
- `AMBIGUOUS_QUERIES.useless_alt` — images with alt="image", "photo", etc.
- `AMBIGUOUS_QUERIES.short_labels` — labels ≤ 2 chars
- `AMBIGUOUS_QUERIES.generic_labels` — labels like "click here"

**Level 3 — DUPLICATE (same label on 3+ elements):**
- `DUPLICATE_QUERIES.duplicate_label_groups` — count of unique duplicated labels
- `DUPLICATE_QUERIES.duplicate_label_elements` — total affected elements

Run the detail queries (`DETAIL_QUERIES`) for any category with count > 0.

### Step 5: Plan Screenshot Sections

Use `batch_execute` to run `getCategorySections` from `ghostview/scripts/ghost-overlays.js`:
```
(() => { ... getCategorySections expression ... })()
```
This returns JSON with each category's element count and scroll position. Use this to decide which sections to screenshot.

### Step 6: Screenshot Capture Loop (Inject & Capture)

**For each category that has findings** (ghost_images, ambiguous_images, duplicate_labels, ghost_buttons, ghost_links), capture a screenshot pair:

#### 6a. Inject overlay style (once)
```
batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.injectStyle }]
```

#### 6b. For each category:
1. **Scroll** to the category's first element:
   ```
   batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.scrollTo<Category> }]
   ```
2. **Take NORMAL screenshot** via `page_screenshot` (omit path for base64) — save as `normal_<category>`.
   For section-level crops, use the `clip` parameter with coordinates from `getCategorySections`.
3. **Inject blackhole overlays** for this category:
   ```
   batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.blackhole_all }]
   ```
   This replaces ghost elements with dark void boxes showing what AI cannot see.
4. **Take BLACKHOLE screenshot** via `page_screenshot` — save as `ghost_<category>`
5. **Remove blackhole overlays:**
   ```
   batch_execute: tasks=[{ tabId, script: OVERLAY_EXPRESSIONS.removeBlackhole }]
   ```

**Category → Overlay mapping:**
| Category | Scroll Expression | Inject Expression |
|----------|------------------|-------------------|
| alt-less images | `scrollToGhostImages` | `ghost_images` |
| useless alt | `scrollToAmbiguousImages` | `ambiguous_images` |
| duplicate labels | `scrollToDuplicateLabels` | `duplicate_labels` |
| unnamed buttons | (scroll to first button) | `ghost_buttons` |
| unnamed links | (scroll to first link) | `ghost_links` |

**Important:** Overlays use `position:absolute` with coordinates from `getBoundingClientRect() + window.scroll`. They're injected into the live DOM, so positions are 100% accurate. Take the screenshot immediately after injection — do not scroll between inject and screenshot.

### Step 7: Pass 2 — LLM Analysis

Review each detected category. For each, generate a **finding object**:

```json
{
  "severity": "ghost|ambiguous|duplicate",
  "title": "한국어 제목 — 문제를 한 문장으로",
  "elementInfo": "<element> × count",
  "description": "한국어로 문제 설명 (2-3 sentences)",
  "screenshots": {
    "normal": "data:image/png;base64,...",
    "ghost": "data:image/png;base64,..."
  },
  "screenshotCaption": "스크린샷 하단 캡션",
  "codeCompare": {
    "human": {
      "label": "👁 사람이 보는 것",
      "html": "<!-- actual HTML with highlights using <span class='hl'>...</span> -->"
    },
    "machine": {
      "label": "🤖 AI / 스크린 리더가 보는 것",
      "html": "<!-- same HTML showing what AI sees, with <span class='gt'>→ AI: ...</span> notes -->"
    }
  },
  "impact": "한국어 임팩트 설명",
  "fix": {
    "label": "수정 방법 (30초)",
    "code": "<specific fix code>"
  }
}
```

**Code compare guidelines:**
- `human.html`: Show the actual HTML element, highlight the relevant attribute with `<span class="hl">`. Add a human-readable note showing what a person sees.
- `machine.html`: Show the same HTML but reveal the gap. Use `<span class="gt">→ AI: ...</span>` for the machine's perspective. For missing alt, show `<div class="invisible-box"><span class="invisible-text">❌ INVISIBLE</span></div>`.
- Keep code snippets short (3-6 lines). Show one representative example, not all instances.
- Write descriptions and impact in Korean. Code stays in English.

### Step 8: Generate Fix Suggestions

For each finding, create a specific, copy-pasteable fix:
- Ghost images: `<img alt="descriptive text based on context">`
- Duplicate labels: `<button aria-label="Follow BBC Sport">Follow</button>`
- Ambiguous alt: `<img alt="Three charts showing..." src="...">`

Fixes must be concrete — not "add aria-label" but the actual label text inferred from context.

### Step 9: Assemble Report Data & Generate HTML

Create the full report data object:
```json
{
  "url": "<target URL>",
  "timestamp": "<current UTC time>",
  "totalInteractive": <number>,
  "parityScore": <number>,
  "confusionScore": <number or null>,
  "categories": {
    "ghost": <count>,
    "ambiguous": <count>,
    "duplicate": <count>,
    "clear": <totalInteractive - ghost - ambiguous - duplicate>
  },
  "heroScreenshot": "data:image/png;base64,...",
  "findings": [ <finding objects from Step 7> ]
}
```

Write this to `/tmp/gv-report-data.json`.

Then run:
```bash
node ghostview/scripts/report.js /tmp/gv-report-data.json ghostview/output/<domain>.html
```

**Confusion Score formula** (optional, compute if ambiguous + duplicate data available):
```
confusionScore = ((clear) / totalInteractive) * 100
```
Where `clear` = elements that are both labeled AND uniquely identifiable.

### Step 10: Terminal Summary

Print:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GhostView Report — <url>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Perception Parity:  XX.X%
Interactive:        XXX elements
Ghosts:             XX (Level 1)
Ambiguous:          XX (Level 2)
Duplicate:          XX (Level 3)
Clear:              XX

Top findings:
  🔴 <finding 1 title>
  🟠 <finding 2 title>
  🟡 <finding 3 title>

Report: ghostview/output/<domain>.html
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Guard Rails

- **DO NOT** use `read_page(mode='ax')` — AX API has size limits
- **DO NOT** use `javascript_tool` for IIFEs — it returns `{}`. Use `batch_execute` instead
- **DO** use `batch_execute` for all detection and overlay injection (IIFEs work correctly)
- **DO** use `page_screenshot` for screenshots (omit `path` for base64, use `clip` for section crops)
- **DO** take screenshot IMMEDIATELY after overlay injection (before any scroll)
- **DO** call `removeBlackhole` after each blackhole screenshot
- **DO** write descriptions and impact in Korean, code in English
- **DO** use concrete fix suggestions (actual label text, not placeholders)
- If `navigate` fails, skip the site and write empty result
- All detection/overlay queries must be single expressions (IIFEs are OK)
- Screenshot base64 should use `data:image/png;base64,` prefix for report embedding
