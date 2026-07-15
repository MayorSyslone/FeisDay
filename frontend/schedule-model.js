/**
 * Pure schedule grid model — no DOM dependency, so this can be unit tested
 * directly in Node. schedule-grid-ui.js is the thin rendering/mouse layer
 * built on top of this.
 *
 * Core concepts:
 *  - A "region" is an isolated left-to-right slice of the board: either one
 *    standalone stage (1 column) or one parallel group (N columns whose
 *    rows are synchronized time slots). Selections and moves can never
 *    cross a region boundary — that's the whole point of a region.
 *  - Each region holds an ordered list of "rows". A row is an object
 *    mapping stage index -> cell ({text, duration, danceType, isHold,
 *    isLunch}). A standalone region's rows just have one key.
 *  - Moving a selection either (a) swaps it with a same-shaped block of
 *    HOLD cells anywhere in the region, or (b) — only for a full-region-
 *    width selection — reinserts it at a row boundary, shifting the rows
 *    between old and new position to close the gap.
 */

class ScheduleModel {
  constructor(sidecar) {
    this.stageMeta = {}; // index -> {name, groupIndex}
    this.groupMeta = {}; // index -> {name, members}
    sidecar.stages.forEach((s) => { this.stageMeta[s.index] = { name: s.name, groupIndex: s.group_index }; });
    sidecar.groups.forEach((g) => { this.groupMeta[g.index] = { name: g.name, members: g.members.slice() }; });

    this.regions = this._buildRegions(sidecar);
    this.anchorSeconds = this._captureAnchors();
  }

  _buildRegions(sidecar) {
    const regions = [];
    const handledGroups = new Set();
    const stageIndices = Object.keys(this.stageMeta).map(Number).sort((a, b) => a - b);

    for (const stageIndex of stageIndices) {
      const groupIndex = this.stageMeta[stageIndex].groupIndex;
      if (groupIndex !== null && groupIndex !== undefined) {
        if (handledGroups.has(groupIndex)) continue;
        handledGroups.add(groupIndex);
        const members = this.groupMeta[groupIndex].members;
        const memberRowLists = members.map((m) => sidecar.rows[String(m)] || []);
        const rowCount = memberRowLists.length ? Math.min(...memberRowLists.map((r) => r.length)) : 0;
        const rows = [];
        for (let i = 0; i < rowCount; i++) {
          const row = {};
          members.forEach((m, idx) => { row[m] = cloneCell(memberRowLists[idx][i]); });
          rows.push(row);
        }
        regions.push({ type: "group", groupIndex, columns: members.slice(), rows });
      } else {
        const rowList = sidecar.rows[String(stageIndex)] || [];
        const rows = rowList.map((cell) => ({ [stageIndex]: cloneCell(cell) }));
        regions.push({ type: "standalone", groupIndex: null, columns: [stageIndex], rows });
      }
    }
    return regions;
  }

  _captureAnchors() {
    const anchors = {};
    for (const region of this.regions) {
      if (region.rows.length === 0) { anchors[region.columns[0]] = 0; continue; }
      const firstCol = region.columns[0];
      const firstCell = region.rows[0][firstCol];
      const key = region.type === "group" ? `group:${region.groupIndex}` : `stage:${firstCol}`;
      anchors[key] = parseTimeToSeconds(firstCell ? firstCell.time : "");
    }
    return anchors;
  }

  regionAnchorKey(region) {
    return region.type === "group" ? `group:${region.groupIndex}` : `stage:${region.columns[0]}`;
  }

  findRegionIndexForColumn(stageIndex) {
    return this.regions.findIndex((r) => r.columns.includes(stageIndex));
  }

  // ---------------------------------------------------------- selection

  /** Clamp a proposed rectangular selection to stay within one region. */
  clampSelection(regionIndex, colStartIdx, colEndIdx, rowStart, rowEnd) {
    const region = this.regions[regionIndex];
    const maxCol = region.columns.length - 1;
    const maxRow = region.rows.length - 1;
    return {
      regionIndex,
      colStart: Math.max(0, Math.min(colStartIdx, colEndIdx, maxCol)),
      colEnd: Math.min(maxCol, Math.max(colStartIdx, colEndIdx)),
      rowStart: Math.max(0, Math.min(rowStart, rowEnd)),
      rowEnd: Math.min(maxRow, Math.max(rowStart, rowEnd)),
    };
  }

  selectionColumns(selection) {
    const region = this.regions[selection.regionIndex];
    return region.columns.slice(selection.colStart, selection.colEnd + 1);
  }

  isFullRegionWidth(selection) {
    const region = this.regions[selection.regionIndex];
    return selection.colStart === 0 && selection.colEnd === region.columns.length - 1;
  }

  // -------------------------------------------------------------- moves

  /** Extract the block of cells a selection covers, without mutating anything. */
  _extractBlock(selection) {
    const region = this.regions[selection.regionIndex];
    const cols = this.selectionColumns(selection);
    const block = [];
    for (let r = selection.rowStart; r <= selection.rowEnd; r++) {
      const rowCells = {};
      cols.forEach((c) => { rowCells[c] = region.rows[r][c]; });
      block.push(rowCells);
    }
    return { cols, block };
  }

  /** True if a same-shaped block starting at (targetColStart, targetRowStart)
   * — offsets within the region — consists entirely of HOLD/blank cells,
   * i.e. safe to swap the selection into. Covers horizontal moves (e.g.
   * dropping into an adjacent stage's HOLD in the same row), vertical
   * moves, or both at once. */
  canSwapIntoHold(selection, targetColStart, targetRowStart) {
    const region = this.regions[selection.regionIndex];
    const width = selection.colEnd - selection.colStart + 1;
    const height = selection.rowEnd - selection.rowStart + 1;
    if (targetColStart < 0 || targetColStart + width > region.columns.length) return false;
    if (targetRowStart < 0 || targetRowStart + height > region.rows.length) return false;
    if (targetColStart === selection.colStart && targetRowStart === selection.rowStart) return false;

    const targetCols = region.columns.slice(targetColStart, targetColStart + width);
    for (let r = 0; r < height; r++) {
      const row = region.rows[targetRowStart + r];
      for (const c of targetCols) {
        if (!cellIsEmptyOrHold(row[c])) return false;
      }
    }
    return true;
  }

  /** Swap a selection's block with a same-shaped HOLD block elsewhere in
   * the same region (any combination of column/row offset). */
  swapIntoHold(selection, targetColStart, targetRowStart) {
    const region = this.regions[selection.regionIndex];
    const srcCols = this.selectionColumns(selection);
    const width = srcCols.length;
    const height = selection.rowEnd - selection.rowStart + 1;
    const targetCols = region.columns.slice(targetColStart, targetColStart + width);
    const { block } = this._extractBlock(selection);

    for (let r = 0; r < height; r++) {
      const srcRow = region.rows[selection.rowStart + r];
      const dstRow = region.rows[targetRowStart + r];
      for (let ci = 0; ci < width; ci++) {
        const moving = block[r][srcCols[ci]];
        dstRow[targetCols[ci]] = moving;
        // Only clear the source cell to HOLD if the destination isn't also
        // the source (guards the case where a move overlaps itself on one axis).
        if (srcRow !== dstRow || srcCols[ci] !== targetCols[ci]) {
          srcRow[srcCols[ci]] = makeHoldCell();
        }
      }
    }
  }

  /** True if a full-region-width selection can be reinserted at a given
   * row-boundary edge index (0..rows.length, i.e. "before row edgeIndex").
   * Edges strictly inside the selection's own span have no sensible
   * whole-block meaning and stay blocked. The edges immediately touching
   * the selection (its own top/bottom boundary) ARE allowed — see
   * insertAtEdge, which treats them as "shift by one row" rather than the
   * literal no-op a naive remove-and-reinsert would produce. */
  canInsertAtEdge(selection, edgeIndex) {
    if (!this.isFullRegionWidth(selection)) return false;
    const region = this.regions[selection.regionIndex];
    if (edgeIndex < 0 || edgeIndex > region.rows.length) return false;
    if (edgeIndex > selection.rowStart && edgeIndex <= selection.rowEnd) return false;
    if (edgeIndex === selection.rowStart && selection.rowStart === 0) return false;
    if (edgeIndex === selection.rowEnd + 1 && selection.rowEnd + 1 >= region.rows.length) return false;
    return true;
  }

  /** Move a contiguous full-width row block to a new position, shifting
   * everything between the old and new position to close the gap. Dropping
   * on the edge immediately touching the selection's own top/bottom is
   * remapped to "shift by exactly one row" in that direction, rather than
   * landing back on the identical position. */
  insertAtEdge(selection, edgeIndex) {
    const region = this.regions[selection.regionIndex];
    const height = selection.rowEnd - selection.rowStart + 1;
    let effectiveEdge = edgeIndex;
    if (edgeIndex === selection.rowStart) effectiveEdge = edgeIndex - 1;
    else if (edgeIndex === selection.rowEnd + 1) effectiveEdge = edgeIndex + 1;

    const removed = region.rows.splice(selection.rowStart, height);
    const insertAt = effectiveEdge > selection.rowStart ? effectiveEdge - height : effectiveEdge;
    region.rows.splice(insertAt, 0, ...removed);
    return insertAt;
  }

  /** True if a PARTIAL-width selection (fewer than all of the region's
   * columns) can drop a brand-new row at edgeIndex, with the selection's
   * block landing at targetColStart..+width. Unlike canInsertAtEdge, this
   * never removes the selection's original row — other stages in that
   * group still occupy it — so this always grows the region by `height`
   * rows (recalculate()'s cleanup pass trims any row that ends up entirely
   * HOLD afterward). Because nothing is removed here, there's no degenerate
   * "identical position" case to guard against — any edge index is a
   * meaningful, distinct insertion, including ones touching or inside the
   * selection's own span. */
  canInsertNewRowAt(selection, targetColStart, edgeIndex) {
    if (this.isFullRegionWidth(selection)) return false; // that's canInsertAtEdge's job
    const region = this.regions[selection.regionIndex];
    const width = selection.colEnd - selection.colStart + 1;
    if (targetColStart < 0 || targetColStart + width > region.columns.length) return false;
    if (edgeIndex < 0 || edgeIndex > region.rows.length) return false;
    return true;
  }

  /** Inserts height-many brand-new rows at edgeIndex. The selection's cells
   * land at targetColStart..+width in those new rows (every other column
   * in the region is HOLD there); the selection's ORIGINAL cells become
   * HOLD in place (their row isn't removed, since other stages still use
   * it — only these specific columns empty out). */
  insertNewRowWithSelection(selection, targetColStart, edgeIndex) {
    const region = this.regions[selection.regionIndex];
    const width = selection.colEnd - selection.colStart + 1;
    const height = selection.rowEnd - selection.rowStart + 1;
    const srcCols = this.selectionColumns(selection);
    const targetCols = region.columns.slice(targetColStart, targetColStart + width);
    const { block } = this._extractBlock(selection);

    for (let r = selection.rowStart; r <= selection.rowEnd; r++) {
      srcCols.forEach((c) => { region.rows[r][c] = makeHoldCell(); });
    }

    const newRows = [];
    for (let r = 0; r < height; r++) {
      const row = {};
      region.columns.forEach((c) => { row[c] = makeHoldCell(); });
      targetCols.forEach((c, i) => { row[c] = block[r][srcCols[i]]; });
      newRows.push(row);
    }
    region.rows.splice(edgeIndex, 0, ...newRows);
  }

  // -------------------------------------------------------- recalculate

  /** Removes any group row where every member column is HOLD/blank — the
   * cleanup half of letting the table grow via insertNewRowWithSelection.
   * Standalone regions are untouched (they never gain HOLD cells). */
  _trimEmptyRows() {
    for (const region of this.regions) {
      region.rows = region.rows.filter(
        (row) => !region.columns.every((c) => cellIsEmptyOrHold(row[c]))
      );
    }
  }

  // ----------------------------------------------------------------- undo

  /** Deep-clones just the mutable row data (cell contents/positions) —
   * stageMeta/groupMeta/anchorSeconds never change after load, so they're
   * not part of the snapshot. */
  snapshot() {
    return this.regions.map((region) => ({
      type: region.type,
      groupIndex: region.groupIndex,
      columns: region.columns.slice(),
      rows: region.rows.map((row) => {
        const clone = {};
        for (const col in row) clone[col] = { ...row[col] };
        return clone;
      }),
    }));
  }

  restoreSnapshot(regions) {
    this.regions = regions;
  }

  /** Recomputes every region's times from its anchor, and returns a list
   * of {regionIndex, rowIndex, stageIndex} for cells in a row where two+
   * non-hold cells disagree on dance type. */
  recalculate() {
    this._trimEmptyRows();
    const conflicts = [];
    for (const region of this.regions) {
      const anchorKey = this.regionAnchorKey(region);
      let cumulative = this.anchorSeconds[anchorKey] || 0;

      for (let rowIndex = 0; rowIndex < region.rows.length; rowIndex++) {
        const row = region.rows[rowIndex];
        const presentCells = region.columns.map((c) => row[c]).filter((c) => c && !cellIsBlank(c));
        if (presentCells.length === 0) continue;

        const nonHold = presentCells.filter((c) => !c.isHold);
        const duration = nonHold.length ? Math.max(...nonHold.map((c) => c.duration || 0)) : 0;
        const timeStr = secondsToClockAmPm(cumulative);
        for (const c of region.columns) {
          if (row[c] && !cellIsBlank(row[c])) row[c].time = timeStr;
        }

        const danceTypes = new Set(nonHold.filter((c) => c.danceType).map((c) => c.danceType));
        if (danceTypes.size > 1) {
          for (const c of region.columns) {
            if (row[c] && !cellIsBlank(row[c]) && !row[c].isHold) {
              conflicts.push({ regionIndex: this.regions.indexOf(region), rowIndex, stageIndex: c });
            }
          }
        }
        cumulative += duration;
      }
    }
    return conflicts;
  }

  // -------------------------------------------------------------- export

  /** {stageName: [{time, text}, ...]} in stage order, for building a CSV. */
  toColumns() {
    const columns = {};
    let maxRows = 0;
    for (const region of this.regions) {
      for (const col of region.columns) {
        const name = this.stageMeta[col].name;
        const rows = region.rows.map((r) => r[col]).filter((c) => c !== undefined);
        columns[name] = rows.map((c) => (cellIsBlank(c) ? { time: "", text: "" } : { time: c.time, text: c.text }));
        maxRows = Math.max(maxRows, columns[name].length);
      }
    }
    for (const name in columns) {
      while (columns[name].length < maxRows) columns[name].push({ time: "", text: "" });
    }
    return columns;
  }
}

// ---------------------------------------------------------------- helpers

function cloneCell(cell) {
  if (!cell) return makeHoldCell();
  return {
    text: cell.text,
    time: cell.time,
    duration: cell.duration_seconds || 0,
    danceType: cell.dance_type || null,
    isHold: !!cell.is_hold,
    isLunch: !!cell.is_lunch,
  };
}

function makeHoldCell() {
  return { text: "HOLD", time: "", duration: 0, danceType: null, isHold: true, isLunch: false };
}

function cellIsBlank(cell) {
  return !cell || !cell.text || !cell.text.trim();
}

function cellIsEmptyOrHold(cell) {
  return cellIsBlank(cell) || cell.isHold;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/;

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const match = TIME_RE.exec(timeStr.trim());
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const suffix = match[4].toUpperCase();
  if (suffix === "AM") { if (hours === 12) hours = 0; } else { if (hours !== 12) hours += 12; }
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToClockAmPm(totalSeconds) {
  totalSeconds = ((totalSeconds % 86400) + 86400) % 86400;
  const hours24 = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours12)}:${pad(minutes)}:${pad(seconds)} ${suffix}`;
}

if (typeof module !== "undefined") {
  module.exports = { ScheduleModel, parseTimeToSeconds, secondsToClockAmPm };
}
