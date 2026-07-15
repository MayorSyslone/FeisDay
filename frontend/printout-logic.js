/**
 * Pure port of stage_number_printer.py's print-order and label logic, used
 * for the in-browser preview so it matches the real .docx output exactly.
 * No DOM dependency — testable directly with Node.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PrintoutLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_PRINTOUT_OPTIONS = {
    includeStageNamePage: true,
    includeHoldPage: true,
    includeLunchPage: true,
    showDancerCount: true,
    showPageNumbers: true,
    reverseOrder: true,
  };

  /** cells: array of {text} in schedule order for one stage (blanks allowed). */
  function parseStageEntries(cells) {
    const entries = [];
    cells.forEach((cell) => {
      const text = (cell && cell.text ? String(cell.text) : "").trim();
      if (!text) return;
      if (text.startsWith("Total Time:")) return;
      entries.push(text);
    });
    return entries;
  }

  function stripAllCounts(entry) {
    return entry.split("/").map((part) => part.replace(/\s*\(\d+\)\s*$/, "").trim()).join("/");
  }

  /** Returns {text, isMixed, isHold}. */
  function competitionLabelForPage(entry, showDancerCount = true) {
    const upper = entry.toUpperCase();
    if (upper === "HOLD" || upper === "LUNCH") {
      return { text: upper, isMixed: false, isHold: upper === "HOLD" };
    }
    const base = showDancerCount ? entry : stripAllCounts(entry);
    const parts = base.split("/").map((p) => p.trim()).filter((p) => p.length);
    if (parts.length <= 1) {
      return { text: base, isMixed: false, isHold: false };
    }
    return { text: parts.join("\n"), isMixed: true, isHold: false };
  }

  /** Turns one stage's raw schedule cells into print-ready pages. See
   * stage_number_printer.py's build_print_pages for the full physical-
   * stacking rationale (last generated = top of a printed stack, so the
   * optional HOLD/stage-name pages go at the very END of this list; page
   * numbers always track true chronological position. Stage name/HOLD sit
   * at the START of the natural (non-reversed) order; reverseOrder simply
   * reverses the whole sequence as one unit, title and HOLD included. */
  function buildPrintPages(cells, stageName = "", options = {}) {
    const opts = Object.assign({}, DEFAULT_PRINTOUT_OPTIONS, options);

    let entries = parseStageEntries(cells);
    if (!opts.includeLunchPage) {
      entries = entries.filter((e) => e.toUpperCase() !== "LUNCH");
    }

    const chronological = entries.filter((e) => e.toUpperCase() !== "HOLD");
    const totalPages = chronological.length;

    const naturalPages = [];

    if (opts.includeStageNamePage) {
      naturalPages.push({ text: stageName || "Stage", isMixed: false, isHold: true, isTitle: true, pageNumber: null, totalPages });
    }
    if (opts.includeHoldPage) {
      naturalPages.push({ text: "HOLD", isMixed: false, isHold: true, isTitle: false, pageNumber: null, totalPages });
    }

    chronological.forEach((entry, index) => {
      const label = competitionLabelForPage(entry, opts.showDancerCount);
      naturalPages.push(Object.assign(label, {
        isTitle: false,
        pageNumber: opts.showPageNumbers ? index + 1 : null,
        totalPages,
      }));
    });

    return opts.reverseOrder ? naturalPages.slice().reverse() : naturalPages;
  }

  return {
    DEFAULT_PRINTOUT_OPTIONS,
    parseStageEntries,
    competitionLabelForPage,
    buildPrintPages,
  };
});
