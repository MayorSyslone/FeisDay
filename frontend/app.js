// v0: hardcoded default settings matching the desktop app's defaults
// (3 stages running in parallel, 1 championship stage on its own).
// A real settings UI (stages, levels, times) is the next piece to build.
const DEFAULT_CONFIG = {
  stage_perms: [
    [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
    [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
    [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
    [6, 7],
  ],
  stage_start_times: ["8:00:00 AM", "8:00:00 AM", "8:00:00 AM", "8:00:00 AM"],
  stage_names: ["Stage 1", "Stage 2", "Stage 3", "Stage 4"],
  parallel_stages: [[1, 2, 3]],
  group_names: ["Group 1"],
  age_hard_stop: 3,
  lunch_time_range: ["11:30:00 AM", "1:00:00 PM"],
  lunch_length: 60,
  max_early_fill_minutes: 90,
};

const form = document.getElementById("upload-form");
const statusEl = document.getElementById("status");
const tableContainer = document.getElementById("table-container");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById("csv-file");
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append("csv_file", fileInput.files[0]);
  formData.append("settings", JSON.stringify(DEFAULT_CONFIG));

  statusEl.textContent = "Generating…";
  tableContainer.innerHTML = "";

  try {
    const response = await fetch("/api/generate-schedule", { method: "POST", body: formData });
    if (!response.ok) {
      const errorText = await response.text();
      statusEl.textContent = `Error: ${errorText}`;
      return;
    }
    const data = await response.json();
    statusEl.textContent = "Done.";
    renderSchedule(data);
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
  }
});

function renderSchedule(data) {
  const table = document.createElement("table");

  const headerRow = document.createElement("tr");
  data.stages.forEach((stage) => {
    const th = document.createElement("th");
    th.textContent = stage.name;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  const maxRows = Math.max(...data.stages.map((s) => (data.rows[s.index] || []).length), 0);

  for (let i = 0; i < maxRows; i++) {
    const tr = document.createElement("tr");
    data.stages.forEach((stage) => {
      const td = document.createElement("td");
      const rows = data.rows[stage.index] || [];
      const cell = rows[i];
      if (cell) {
        td.textContent = `${cell.text} — ${cell.time}`;
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }

  tableContainer.appendChild(table);
}
