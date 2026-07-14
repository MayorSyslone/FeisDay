const board = new StageBoard();
let gridController = null;

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
      <li><strong>Save schedule CSV</strong> — downloads the current (edited) schedule.</li>
      <li><strong>Stage number printouts</strong> — preview each stage's big-print pages, then
        download the real .docx files for posting at each stage.</li>
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
  };
}

// ---------------------------------------------------------------- generate

const csvFileInput = document.getElementById("csv-file");
const csvCheck = document.getElementById("csv-check");
const generateBtn = document.getElementById("generate-btn");
const scheduleCheck = document.getElementById("schedule-check");
const gridContainer = document.getElementById("grid-container");
const gridHint = document.getElementById("grid-hint");
const saveCsvBtn = document.getElementById("save-csv-btn");
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
  const overlay = showLoadingOverlay("Building schedule");

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

  saveCsvBtn.disabled = false;
  mountPrintoutPreview();
}

saveCsvBtn.addEventListener("click", () => {
  if (!gridController) return;
  const columns = gridController.getModel().toColumns();
  downloadBlob(buildCsvBlob(columns), "stage_schedule.csv");
});

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
const downloadPrintoutsBtn = document.getElementById("download-printouts-btn");
const printoutsStatusEl = document.getElementById("printouts-status");

let printoutPages = [];

function showStagePrintout(stageIndex) {
  // Always re-read from the live model so the preview reflects any edits
  // made since the schedule was generated.
  const columns = gridController.getModel().toColumns();
  const name = gridController.getModel().stageMeta[stageIndex].name;
  const cells = columns[name] || [];
  printoutPages = PrintoutLogic.buildPrintPages(cells);
  renderAllPrintoutPages();
}

function renderAllPrintoutPages() {
  printoutPreviewEl.innerHTML = "";
  if (!printoutPages.length) {
    printoutPreviewEl.textContent = "Nothing to print for this stage yet.";
    return;
  }
  printoutPages.forEach((page, i) => {
    const pageEl = document.createElement("div");
    pageEl.className = "printout-page";

    const textEl = document.createElement("div");
    textEl.className = "printout-page-text " + (page.isMixed ? "mixed" : "single");
    textEl.textContent = page.text;
    pageEl.appendChild(textEl);

    const numberEl = document.createElement("div");
    numberEl.className = "printout-page-number";
    numberEl.textContent = page.pageNumber !== null ? `Page ${page.pageNumber} of ${page.totalPages}` : "";
    pageEl.appendChild(numberEl);

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


downloadPrintoutsBtn.addEventListener("click", async () => {
  if (!gridController) return;
  const columns = gridController.getModel().toColumns();
  const csvBlob = buildCsvBlob(columns);

  const formData = new FormData();
  formData.append("csv_file", csvBlob, "schedule.csv");

  downloadPrintoutsBtn.disabled = true;
  printoutsStatusEl.textContent = "Generating printouts…";
  const overlay = showLoadingOverlay("Building printouts");

  try {
    const response = await fetch("/api/generate-printouts", { method: "POST", body: formData });
    overlay.finish();
    if (!response.ok) {
      const errorText = await response.text();
      printoutsStatusEl.textContent = "Printout generation failed.";
      alert(`Printout generation failed:\n${errorText}`);
      return;
    }
    const zipBlob = await response.blob();
    downloadBlob(zipBlob, "stage_printouts.zip");
    printoutsStatusEl.textContent = "Printouts downloaded.";
  } catch (err) {
    overlay.finish();
    printoutsStatusEl.textContent = "Printout generation failed.";
    alert(`Printout generation failed:\n${err}`);
  } finally {
    downloadPrintoutsBtn.disabled = false;
  }
});
