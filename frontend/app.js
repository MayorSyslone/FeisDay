const board = new StageBoard();
let gridController = null;

const preloadedArtworkImages = []; // kept alive on purpose -- see preloadLoadingArtwork

preloadLoadingArtwork();

function preloadLoadingArtwork() {
  fetch("/api/loading-artworks")
    .then((response) => response.json())
    .then((data) => {
      (data.files || []).forEach((filename) => {
        const img = new Image();
        img.src = `loading-artwork/${filename}`;
        // Without keeping a reference, this Image has nothing pointing to
        // it once this callback returns and can get garbage-collected
        // before its fetch/decode finishes -- silently aborting the
        // "preload" and defeating the whole point.
        preloadedArtworkImages.push(img);
      });
    })
    .catch(() => {}); // non-critical; the loading overlay falls back gracefully either way
}

document.getElementById("info-btn").addEventListener("click", showInfoModal);

function showInfoModal() {
  const overlay = document.createElement("div");
  overlay.className = "sb-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sb-modal";
  modal.style.maxWidth = "620px";
  modal.innerHTML = `
    <h3>How this works</h3>
    <ol class="info-list">
      <li><strong>Stages</strong> — set up your stages here. Drag one stage onto another to run
        them in parallel (they'll share time slots and can't run different dances at once).
        Drag a stage back out to split it off. Rename stages/groups and pick each stage's
        allowed levels and start time.</li>
      <li><strong>Advanced settings</strong> — age cutoff, lunch window, and how early a
        competition can be pulled forward to fill a hold.</li>
      <li><strong>Build schedule</strong> — pick your dancer registration CSV, then Generate.
        The schedule appears below as an editable grid.</li>
      <li><strong>Editing the grid</strong> — click and drag to select cells (a selection can't
        cross into a different stage or parallel group). Hover the selection's edge to grab it,
        then drag: drop onto a matching HOLD block to swap in, or onto a row boundary to reorder
        (a full-width selection moves as a block; a narrower one inserts a brand-new row instead,
        so you can offset it left/right into whichever stages you drop it on).
        <code>Ctrl+Z</code> (<code>Cmd+Z</code> on Mac) undoes the last move. Times and any
        dance-type conflicts (highlighted red) update automatically after every move.</li>
      <li><strong>Stage number printouts</strong> — set your options (stage name page, HOLD page,
        LUNCH page, dancer counts, page numbers, reverse order), then preview each stage's
        big-print pages live.</li>
      <li><strong>Export</strong> — one button downloads a zip with the schedule CSV, a formatted
        schedule document, and every stage's printout pages.</li>
    </ol>
  `;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-accent";
  closeBtn.textContent = "Close";
  closeBtn.style.marginTop = "0.75rem";
  closeBtn.onclick = () => overlay.remove();
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

const stageBoardContainer = document.getElementById("stage-board");
const boardUi = mountStageBoard(stageBoardContainer, board);

document.getElementById("add-stage-btn").addEventListener("click", () => {
  boardUi.addStage();
});

const ageHardStopInput = document.getElementById("age-hard-stop");
const lunchStartInput = document.getElementById("lunch-start");
const lunchEndInput = document.getElementById("lunch-end");
const lunchLengthInput = document.getElementById("lunch-length");
const maxEarlyFillInput = document.getElementById("max-early-fill");

populateTimeSelect(lunchStartInput, "11:30 AM");
populateTimeSelect(lunchEndInput, "01:00 PM");

// These must match schedule_creator.py's hardcoded defaults exactly, since
// that's what the backend falls back to if these keys aren't sent at all —
// keeping them in sync means "never touched the order" behaves identically
// whether or not the config explicitly includes them.
const DEFAULT_DANCE_ORDER = ["Treble Reel", "Treble Jig", "Slip Jig", "Hornpipe", "Single (Hop) Jig", "Reel", "Light Jig", "2 Rounds", "3 Rounds", "Traditional Set", "4 Hand", "8 Hand", "Dancers Choice"];
const DEFAULT_LEVEL_ORDER = ["Advanced Beginner thru Prizewinner Charity", "Prelim & Champ Charity", "Special Needs", "PreBeginner", "Beginner", "Adult Beginner", "Advanced Beginner", "Adult Adv Beginner", "Novice", "Adult Novice", "Prizewinner", "Adult Prizewinner", "Preliminary", "Champion", "Adult Championship", "All Levels", "Team"];

const danceOrderItems = DEFAULT_DANCE_ORDER.slice();
const levelOrderItems = DEFAULT_LEVEL_ORDER.slice();
mountDraggableList(document.getElementById("dance-order-list"), danceOrderItems, () => {});
mountDraggableList(document.getElementById("level-order-list"), levelOrderItems, () => {});

const ageYoungestFirstCheckbox = document.getElementById("age-youngest-first");
const ageOldestFirstCheckbox = document.getElementById("age-oldest-first");
ageYoungestFirstCheckbox.addEventListener("change", () => {
  if (ageYoungestFirstCheckbox.checked) ageOldestFirstCheckbox.checked = false;
  else ageYoungestFirstCheckbox.checked = true; // at least one must stay checked
});
ageOldestFirstCheckbox.addEventListener("change", () => {
  if (ageOldestFirstCheckbox.checked) ageYoungestFirstCheckbox.checked = false;
  else ageOldestFirstCheckbox.checked = true;
});

function populateTimeSelect(selectEl, defaultValue) {
  TIME_OPTIONS.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    if (t === defaultValue) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function buildAdvancedConfig() {
  return {
    age_hard_stop: parseInt(ageHardStopInput.value, 10) || 3,
    lunch_time_range: [lunchStartInput.value, lunchEndInput.value],
    lunch_length: parseInt(lunchLengthInput.value, 10) || 60,
    max_early_fill_minutes: parseInt(maxEarlyFillInput.value, 10) || 90,
    dance_type_order: danceOrderItems.slice(),
    dance_level_order: levelOrderItems.slice(),
    age_sort_direction: ageOldestFirstCheckbox.checked ? "oldest_first" : "youngest_first",
  };
}

// ---------------------------------------------------------------- generate

const csvFileInput = document.getElementById("csv-file");
const csvCheck = document.getElementById("csv-check");
const generateBtn = document.getElementById("generate-btn");
const scheduleCheck = document.getElementById("schedule-check");
const gridContainer = document.getElementById("grid-container");
const gridHint = document.getElementById("grid-hint");
const statusEl = document.getElementById("status");

csvFileInput.addEventListener("change", () => {
  csvCheck.textContent = csvFileInput.files.length ? "\u2713" : "";
});

generateBtn.addEventListener("click", async () => {
  if (!csvFileInput.files.length) {
    alert("Please select your dancer registration CSV first.");
    return;
  }

  const config = board.toConfig();
  Object.assign(config, buildAdvancedConfig());

  if (config.stage_perms.some((perms) => perms.length === 0)) {
    if (!confirm("One or more stages have no allowed levels selected. Continue anyway?")) {
      return;
    }
  }

  const formData = new FormData();
  formData.append("csv_file", csvFileInput.files[0]);
  formData.append("settings", JSON.stringify(config));

  generateBtn.disabled = true;
  const overlay = showLoadingOverlay("Building schedule", 12);

  try {
    const response = await fetch("/api/generate-schedule", { method: "POST", body: formData });
    overlay.finish();
    if (!response.ok) {
      const errorText = await response.text();
      statusEl.textContent = "Schedule generation failed.";
      alert(`Schedule generation failed:\n${errorText}`);
      return;
    }
    const data = await response.json();
    scheduleCheck.textContent = "\u2713";
    statusEl.textContent = "Schedule generated.";
    mountGrid(data);
  } catch (err) {
    overlay.finish();
    statusEl.textContent = "Schedule generation failed.";
    alert(`Schedule generation failed:\n${err}`);
  } finally {
    generateBtn.disabled = false;
  }
});

function mountGrid(sidecarData) {
  gridContainer.innerHTML = "";
  gridHint.textContent =
    "Click and drag to select cells (selections stay within one stage or parallel group). " +
    "Hover the selection's edge to grab it — drop on a matching HOLD block to swap in, " +
    "or on a row boundary to reorder (full-width) or insert a new row (partial-width). " +
    "Times and conflict highlights update after every move.";

  const gridEl = document.createElement("div");
  gridEl.id = "schedule-grid";
  gridContainer.appendChild(gridEl);

  gridController = mountScheduleGrid(gridEl, sidecarData, {
    onChange: () => {
      statusEl.textContent = "Schedule changed.";
    },
  });

  exportBtn.disabled = false;
  mountPrintoutPreview();
}

function buildCsvBlob(columns) {
  const names = Object.keys(columns);
  const headers = [];
  names.forEach((name) => {
    headers.push(`${name} Time`);
    headers.push(`${name} Comp`);
  });

  const maxRows = Math.max(...names.map((n) => columns[n].length), 0);
  const lines = [headers.map(csvEscape).join(",")];
  for (let i = 0; i < maxRows; i++) {
    const row = [];
    names.forEach((name) => {
      const cell = columns[name][i] || { time: "", text: "" };
      row.push(csvEscape(cell.time));
      row.push(csvEscape(cell.text));
    });
    lines.push(row.join(","));
  }
  return new Blob([lines.join("\r\n")], { type: "text/csv" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// -------------------------------------------------------------- printouts

const printoutsPanel = document.getElementById("printouts-panel");
const printoutTabsEl = document.getElementById("printout-stage-tabs");
const printoutPreviewEl = document.getElementById("printout-preview");

const optStageNamePage = document.getElementById("opt-stage-name-page");
const optHoldPage = document.getElementById("opt-hold-page");
const optLunchPage = document.getElementById("opt-lunch-page");
const optDancerCount = document.getElementById("opt-dancer-count");
const optPageNumbers = document.getElementById("opt-page-numbers");
const optReverseOrder = document.getElementById("opt-reverse-order");

const PRINTOUT_OPTION_CHECKBOXES = [
  optStageNamePage, optHoldPage, optLunchPage, optDancerCount, optPageNumbers, optReverseOrder,
];
PRINTOUT_OPTION_CHECKBOXES.forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    if (currentPrintoutStageIndex !== null) showStagePrintout(currentPrintoutStageIndex);
  });
});

function buildPrintoutOptionsJs() {
  return {
    includeStageNamePage: optStageNamePage.checked,
    includeHoldPage: optHoldPage.checked,
    includeLunchPage: optLunchPage.checked,
    showDancerCount: optDancerCount.checked,
    showPageNumbers: optPageNumbers.checked,
    reverseOrder: optReverseOrder.checked,
  };
}

function buildPrintoutOptionsForBackend() {
  return {
    include_stage_name_page: optStageNamePage.checked,
    include_hold_page: optHoldPage.checked,
    include_lunch_page: optLunchPage.checked,
    show_dancer_count: optDancerCount.checked,
    show_page_numbers: optPageNumbers.checked,
    reverse_order: optReverseOrder.checked,
  };
}

let printoutPages = [];
let currentPrintoutStageIndex = null;

function showStagePrintout(stageIndex) {
  currentPrintoutStageIndex = stageIndex;
  // Always re-read from the live model so the preview reflects any edits
  // made since the schedule was generated.
  const model = gridController.getModel();
  const columns = model.toColumns();
  const name = model.stageMeta[stageIndex].name;
  const cells = columns[name] || [];
  printoutPages = PrintoutLogic.buildPrintPages(cells, name, buildPrintoutOptionsJs());
  renderAllPrintoutPages();
}

function renderAllPrintoutPages() {
  printoutPreviewEl.innerHTML = "";
  if (!printoutPages.length) {
    printoutPreviewEl.textContent = "Nothing to print for this stage yet.";
    return;
  }
  printoutPages.forEach((page) => {
    const pageEl = document.createElement("div");
    pageEl.className = "printout-page";

    const textEl = document.createElement("div");
    textEl.className = "printout-page-text " + (page.isMixed ? "mixed" : "single");
    textEl.textContent = page.text;
    pageEl.appendChild(textEl);

    if (page.pageNumber !== null) {
      const numberEl = document.createElement("div");
      numberEl.className = "printout-page-number";
      numberEl.textContent = `Page ${page.pageNumber} of ${page.totalPages}`;
      pageEl.appendChild(numberEl);
    }

    printoutPreviewEl.appendChild(pageEl);
  });
}

function mountPrintoutPreview() {
  printoutsPanel.style.display = "";
  printoutTabsEl.innerHTML = "";

  const model = gridController.getModel();
  const stageIndices = Object.keys(model.stageMeta).map(Number).sort((a, b) => a - b);

  stageIndices.forEach((stageIndex, i) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "printout-tab" + (i === 0 ? " active" : "");
    tab.textContent = model.stageMeta[stageIndex].name;
    tab.addEventListener("click", () => {
      printoutTabsEl.querySelectorAll(".printout-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      showStagePrintout(stageIndex);
    });
    printoutTabsEl.appendChild(tab);
  });

  if (stageIndices.length) showStagePrintout(stageIndices[0]);
}

// ------------------------------------------------------------------ export

const exportBtn = document.getElementById("export-btn");
const exportStatusEl = document.getElementById("export-status");

exportBtn.addEventListener("click", async () => {
  if (!gridController) return;
  const columns = gridController.getModel().toColumns();
  const csvBlob = buildCsvBlob(columns);

  const formData = new FormData();
  formData.append("csv_file", csvBlob, "stage_schedule.csv");
  formData.append("printout_options", JSON.stringify(buildPrintoutOptionsForBackend()));

  exportBtn.disabled = true;
  exportStatusEl.textContent = "Building export…";
  const overlay = showLoadingOverlay("Building export", 6);

  try {
    const response = await fetch("/api/export", { method: "POST", body: formData });
    overlay.finish();
    if (!response.ok) {
      const errorText = await response.text();
      exportStatusEl.textContent = "Export failed.";
      alert(`Export failed:\n${errorText}`);
      return;
    }
    const zipBlob = await response.blob();
    downloadBlob(zipBlob, "feis_schedule_export.zip");
    exportStatusEl.textContent = "Export downloaded.";
  } catch (err) {
    overlay.finish();
    exportStatusEl.textContent = "Export failed.";
    alert(`Export failed:\n${err}`);
  } finally {
    exportBtn.disabled = false;
  }
});
