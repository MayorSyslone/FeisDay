/**
 * Pure port of stage_number_printer.py's print-order and label logic, used
 * for the in-browser preview so it matches the real .docx output exactly.
 * No DOM dependency — testable directly with Node.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    const exported = factory();
    root.PrintoutLogic = exported;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

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

  /** Drop middle HOLDs, keep LUNCH, reverse order, force a final HOLD page. */
  function buildPrintOrder(entries) {
    const nonHold = entries.filter((e) => e.toUpperCase() !== "HOLD");
    const ordered = nonHold.slice().reverse();
    ordered.push("HOLD");
    return ordered;
  }

  /** Returns {text, isMixed} — isMixed pages use a smaller font, like the
   * desktop docx version (170pt single comp vs 105pt mixed). */
  function competitionLabelForPage(entry) {
    const upper = entry.toUpperCase();
    if (upper === "HOLD" || upper === "LUNCH") {
      return { text: upper, isMixed: false };
    }
    const noCount = entry.replace(/\s*\(\d+\)\s*$/, "").trim();
    const parts = noCount.split("/").map((p) => p.trim()).filter((p) => p.length);
    if (parts.length <= 1) {
      return { text: noCount, isMixed: false };
    }
    return { text: parts.join("\n"), isMixed: true };
  }

  /** Full pipeline: schedule cells for one stage -> print-ready pages. */
  function buildPrintPages(cells) {
    const entries = parseStageEntries(cells);
    const order = buildPrintOrder(entries);
    return order.map((entry) => competitionLabelForPage(entry));
  }

  return { parseStageEntries, buildPrintOrder, competitionLabelForPage, buildPrintPages };
});
