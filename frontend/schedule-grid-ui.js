/**
 * Rendering + mouse interaction on top of schedule-model.js.
 *
 * Interaction summary:
 *  - Click and drag on a cell body: draws a rectangular selection, clamped
 *    to that cell's region (can't cross into a neighboring stage/group).
 *  - Hover the selection's border: cursor becomes "move"; dragging from
 *    there picks the block up.
 *  - While carrying a block: hovering a same-shaped all-HOLD target
 *    highlights it green (drop = swap in place). Hovering a row boundary
 *    (only offered for full-region-width selections) highlights that
 *    boundary as an insertion line (drop = shove rows to make room).
 *  - On drop: model updates, times recalculate immediately, and any
 *    parallel-group row with mismatched dance types lights up red.
 */

const EDGE_GRAB_PX = 8;
const EDGE_INSERT_PX = 10;

function mountScheduleGrid(container, sidecar, options = {}) {
  const model = new ScheduleModel(sidecar);
  const onChange = options.onChange || (() => {});

  let selection = null;
  let mode = "idle"; // idle | selecting | armed | moving
  let selectAnchor = null; // {regionIndex, colIdx, rowIdx}
  let moveGrabOffset = null; // {colOffset, rowOffset} within the block, where the user grabbed it
  let dropCandidate = null; // {kind:'hold', colStart, rowStart} | {kind:'edge', rowIndex} | null

  const cellEls = []; // cellEls[regionIndex][rowIndex][colOffset] = element
  const regionEls = []; // regionEls[regionIndex] = wrapper element

  const MAX_UNDO = 50;
  const undoStack = [];

  function pushUndoSnapshot() {
    undoStack.push(model.snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    model.restoreSnapshot(undoStack.pop());
    const conflicts = model.recalculate();
    render();
    highlightConflicts(conflicts);
    onChange(model);
  }

  function onKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    const active = document.activeElement;
    const isEditable = active && (
      active.tagName === "INPUT" || active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" || active.isContentEditable
    );
    if (isEditable) return;
    event.preventDefault();
    undo();
  }

  render();

  container.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", onKeyDown);

  function render() {
    container.innerHTML = "";
    cellEls.length = 0;
    regionEls.length = 0;

    const board = document.createElement("div");
    board.className = "sg-board";

    model.regions.forEach((region, regionIndex) => {
      const wrapper = document.createElement("div");
      wrapper.className = "sg-region " + (region.type === "group" ? "sg-region-group" : "sg-region-standalone");
      wrapper.dataset.regionIndex = String(regionIndex);

      if (region.type === "group") {
        const label = document.createElement("div");
        label.className = "sg-group-label";
        label.textContent = model.groupMeta[region.groupIndex].name;
        wrapper.appendChild(label);
      }

      const headerRow = document.createElement("div");
      headerRow.className = "sg-header-row";
      headerRow.style.gridTemplateColumns = `repeat(${region.columns.length}, 1fr)`;
      region.columns.forEach((c) => {
        const h = document.createElement("div");
        h.className = "sg-col-header";
        h.textContent = model.stageMeta[c].name;
        headerRow.appendChild(h);
      });
      wrapper.appendChild(headerRow);

      const gridEl = document.createElement("div");
      gridEl.className = "sg-grid";
      gridEl.style.gridTemplateColumns = `repeat(${region.columns.length}, 1fr)`;

      const regionCellRows = [];
      region.rows.forEach((row, rowIndex) => {
        const rowCells = [];
        region.columns.forEach((c, colOffset) => {
          const cell = row[c];
          const cellEl = document.createElement("div");
          cellEl.className = "sg-cell" + (cell.isHold ? " sg-hold" : cell.isLunch ? " sg-lunch" : "");
          cellEl.dataset.regionIndex = String(regionIndex);
          cellEl.dataset.rowIndex = String(rowIndex);
          cellEl.dataset.colOffset = String(colOffset);

          if (!cell.isHold || cell.text !== "HOLD") {
            const textEl = document.createElement("div");
            textEl.className = "sg-cell-text";
            textEl.textContent = cell.text;
            const timeEl = document.createElement("div");
            timeEl.className = "sg-cell-time";
            timeEl.textContent = cell.time || "";
            cellEl.appendChild(textEl);
            cellEl.appendChild(timeEl);
          } else {
            cellEl.textContent = "HOLD";
          }

          gridEl.appendChild(cellEl);
          rowCells.push(cellEl);
        });
        regionCellRows.push(rowCells);
      });

      wrapper.appendChild(gridEl);
      board.appendChild(wrapper);
      cellEls.push(regionCellRows);
      regionEls.push(wrapper);
    });

    container.appendChild(board);
    paintSelection();
  }

  // --------------------------------------------------------- hit testing

  function cellAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const cellEl = el.closest(".sg-cell");
    if (!cellEl || !container.contains(cellEl)) return null;
    return {
      regionIndex: Number(cellEl.dataset.regionIndex),
      rowIndex: Number(cellEl.dataset.rowIndex),
      colOffset: Number(cellEl.dataset.colOffset),
      el: cellEl,
    };
  }

  function selectionBoundingRect() {
    if (!selection) return null;
    const region = model.regions[selection.regionIndex];
    const topLeft = cellEls[selection.regionIndex][selection.rowStart][selection.colStart];
    const bottomRight = cellEls[selection.regionIndex][selection.rowEnd][selection.colEnd];
    const r1 = topLeft.getBoundingClientRect();
    const r2 = bottomRight.getBoundingClientRect();
    return {
      left: r1.left, top: r1.top, right: r2.right, bottom: r2.bottom,
    };
  }

  function nearSelectionEdge(clientX, clientY) {
    const rect = selectionBoundingRect();
    if (!rect) return false;
    const nearLeft = Math.abs(clientX - rect.left) <= EDGE_GRAB_PX && clientY >= rect.top - EDGE_GRAB_PX && clientY <= rect.bottom + EDGE_GRAB_PX;
    const nearRight = Math.abs(clientX - rect.right) <= EDGE_GRAB_PX && clientY >= rect.top - EDGE_GRAB_PX && clientY <= rect.bottom + EDGE_GRAB_PX;
    const nearTop = Math.abs(clientY - rect.top) <= EDGE_GRAB_PX && clientX >= rect.left - EDGE_GRAB_PX && clientX <= rect.right + EDGE_GRAB_PX;
    const nearBottom = Math.abs(clientY - rect.bottom) <= EDGE_GRAB_PX && clientX >= rect.left - EDGE_GRAB_PX && clientX <= rect.right + EDGE_GRAB_PX;
    return nearLeft || nearRight || nearTop || nearBottom;
  }

  // ------------------------------------------------------------- events

  function onMouseDown(event) {
    const hit = cellAtPoint(event.clientX, event.clientY);

    if (mode === "idle" || mode === "selecting") {
      if (!hit) { clearSelection(); return; }
      mode = "selecting";
      selectAnchor = hit;
      selection = model.clampSelection(hit.regionIndex, hit.colOffset, hit.colOffset, hit.rowIndex, hit.rowIndex);
      paintSelection();
      return;
    }

    if (mode === "armed" && selection) {
      mode = "moving";
      moveGrabOffset = hit && hit.regionIndex === selection.regionIndex
        ? { colOffset: hit.colOffset - selection.colStart, rowOffset: hit.rowIndex - selection.rowStart }
        : { colOffset: 0, rowOffset: 0 };
      container.classList.add("sg-dragging");
      return;
    }
  }

  function onMouseMove(event) {
    if (mode === "selecting" && selectAnchor) {
      const hit = cellAtPoint(event.clientX, event.clientY);
      if (hit && hit.regionIndex === selectAnchor.regionIndex) {
        selection = model.clampSelection(
          selectAnchor.regionIndex, selectAnchor.colOffset, hit.colOffset, selectAnchor.rowIndex, hit.rowIndex
        );
        paintSelection();
      }
      return;
    }

    if (mode === "idle" && selection) {
      // no-op; edge detection only matters once a selection exists, handled below
    }

    if (selection && (mode === "idle" || mode === "armed")) {
      const armed = nearSelectionEdge(event.clientX, event.clientY);
      mode = armed ? "armed" : "idle";
      container.classList.toggle("sg-armed", armed);
      return;
    }

    if (mode === "moving") {
      updateDropCandidate(event.clientX, event.clientY);
    }
  }

  function onMouseUp(event) {
    if (mode === "selecting") {
      mode = "idle";
      selectAnchor = null;
      return;
    }
    if (mode === "moving") {
      commitMove();
      mode = "idle";
      container.classList.remove("sg-dragging", "sg-armed");
      return;
    }
  }

  function updateDropCandidate(clientX, clientY) {
    clearDropHighlight();
    dropCandidate = null;
    if (!selection) return;

    const region = model.regions[selection.regionIndex];
    const width = selection.colEnd - selection.colStart + 1;
    const height = selection.rowEnd - selection.rowStart + 1;

    const hit = cellAtPoint(clientX, clientY);
    const rawColOffset = hit && hit.regionIndex === selection.regionIndex
      ? hit.colOffset - (moveGrabOffset ? moveGrabOffset.colOffset : 0)
      : selection.colStart;
    const targetColStart = clampInt(rawColOffset, 0, region.columns.length - width);

    // Row-boundary insert: full-width selections reorder the existing row
    // (old behavior); narrower selections create a brand-new row instead,
    // landing at whatever column offset the cursor is currently over.
    const rowsEl = cellEls[selection.regionIndex];
    for (let edge = 0; edge <= rowsEl.length; edge++) {
      const y = edgeY(selection.regionIndex, edge);
      if (y === null || Math.abs(clientY - y) > EDGE_INSERT_PX) continue;

      if (model.isFullRegionWidth(selection)) {
        if (model.canInsertAtEdge(selection, edge)) {
          dropCandidate = { kind: "edge", rowIndex: edge };
          highlightEdgeRange(selection.regionIndex, edge, 0, region.columns.length);
          return;
        }
      } else if (model.canInsertNewRowAt(selection, targetColStart, edge)) {
        dropCandidate = { kind: "new-row", edgeIndex: edge, colStart: targetColStart };
        highlightEdgeRange(selection.regionIndex, edge, targetColStart, width);
        return;
      }
    }

    if (hit && hit.regionIndex === selection.regionIndex) {
      const targetRowStart = clampInt(hit.rowIndex - (moveGrabOffset ? moveGrabOffset.rowOffset : 0), 0, region.rows.length - height);
      if (model.canSwapIntoHold(selection, targetColStart, targetRowStart)) {
        dropCandidate = { kind: "hold", colStart: targetColStart, rowStart: targetRowStart };
        highlightHoldTarget(selection.regionIndex, targetColStart, targetRowStart, width, height);
      }
    }
  }

  function edgeY(regionIndex, edgeIndex) {
    const rows = cellEls[regionIndex];
    if (rows.length === 0) return null;
    if (edgeIndex < rows.length) {
      return rows[edgeIndex][0].getBoundingClientRect().top;
    }
    return rows[rows.length - 1][0].getBoundingClientRect().bottom;
  }

  function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function highlightHoldTarget(regionIndex, colStart, rowStart, width, height) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const el = cellEls[regionIndex][rowStart + r][colStart + c];
        el.classList.add("sg-drop-target");
      }
    }
  }

  function highlightEdgeRange(regionIndex, edgeIndex, colStart, width) {
    const wrapper = regionEls[regionIndex];
    let line = wrapper.querySelector(".sg-edge-line");
    if (!line) {
      line = document.createElement("div");
      line.className = "sg-edge-line";
      wrapper.appendChild(line);
    }
    const rows = cellEls[regionIndex];
    const refRowIndex = edgeIndex < rows.length ? edgeIndex : rows.length - 1;
    const leftEl = rows[refRowIndex][colStart];
    const rightEl = rows[refRowIndex][colStart + width - 1];
    const leftRect = leftEl.getBoundingClientRect();
    const rightRect = rightEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const y = edgeY(regionIndex, edgeIndex);

    line.style.left = `${leftRect.left - wrapperRect.left}px`;
    line.style.width = `${rightRect.right - leftRect.left}px`;
    line.style.right = "auto";
    line.style.top = `${y - wrapperRect.top}px`;
    line.style.display = "block";
  }

  function clearDropHighlight() {
    container.querySelectorAll(".sg-drop-target").forEach((el) => el.classList.remove("sg-drop-target"));
    container.querySelectorAll(".sg-edge-line").forEach((el) => { el.style.display = "none"; });
  }

  function commitMove() {
    clearDropHighlight();
    if (selection && dropCandidate) {
      pushUndoSnapshot();
      if (dropCandidate.kind === "hold") {
        model.swapIntoHold(selection, dropCandidate.colStart, dropCandidate.rowStart);
      } else if (dropCandidate.kind === "edge") {
        model.insertAtEdge(selection, dropCandidate.rowIndex);
      } else if (dropCandidate.kind === "new-row") {
        model.insertNewRowWithSelection(selection, dropCandidate.colStart, dropCandidate.edgeIndex);
      }
      const conflicts = model.recalculate();
      render();
      highlightConflicts(conflicts);
      onChange(model);
    }
    dropCandidate = null;
    clearSelection();
  }

  function highlightConflicts(conflicts) {
    conflicts.forEach(({ regionIndex, rowIndex, stageIndex }) => {
      const region = model.regions[regionIndex];
      const colOffset = region.columns.indexOf(stageIndex);
      if (colOffset === -1) return;
      const el = cellEls[regionIndex][rowIndex][colOffset];
      if (el) el.classList.add("sg-conflict");
    });
  }

  function clearSelection() {
    selection = null;
    selectAnchor = null;
    container.classList.remove("sg-armed", "sg-dragging");
    paintSelection();
  }

  function paintSelection() {
    container.querySelectorAll(".sg-selected").forEach((el) => el.classList.remove("sg-selected"));
    if (!selection) return;
    for (let r = selection.rowStart; r <= selection.rowEnd; r++) {
      for (let c = selection.colStart; c <= selection.colEnd; c++) {
        const el = cellEls[selection.regionIndex][r][c];
        if (el) el.classList.add("sg-selected");
      }
    }
  }

  return {
    getModel: () => model,
    undo,
    recalculateNow: () => {
      const conflicts = model.recalculate();
      render();
      highlightConflicts(conflicts);
      return conflicts;
    },
    destroy: () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
