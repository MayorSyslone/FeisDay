/**
 * Drag-to-reorder list (dance order / level order in Advanced settings).
 * Pure logic (moveItem, computeInsertIndex) is separated out for testing;
 * mountDraggableList is the DOM/mouse-event layer on top of it.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    const exported = factory();
    root.moveItem = exported.moveItem;
    root.computeInsertIndex = exported.computeInsertIndex;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Moves array[from] to final index `to`, shifting everything between.
   * `to` is interpreted as the item's index in the RESULTING array (not a
   * pre-removal edge position) — see computeInsertIndex for that
   * conversion. Mutates and returns the array for convenience. */
  function moveItem(array, from, to) {
    if (from === to || from < 0 || from >= array.length) return array;
    const clampedTo = Math.max(0, Math.min(to, array.length - 1));
    const [item] = array.splice(from, 1);
    array.splice(clampedTo, 0, item);
    return array;
  }

  /** Converts a hovered "edge" position (0..N, the gap before item `edge`
   * in the original N-item list) into the final index moveItem expects.
   * Edges after the dragged item's own position shift down by one once
   * it's removed. */
  function computeInsertIndex(from, edge) {
    return edge > from ? edge - 1 : edge;
  }

  return { moveItem, computeInsertIndex };
});

function mountDraggableList(container, items, onChange) {
  let dragIndex = null;
  let ghostEl = null;
  let edgeLineEl = null;
  let currentEdge = null;

  container.style.position = "relative";
  render();

  function render() {
    container.innerHTML = "";
    items.forEach((label, index) => {
      const row = document.createElement("div");
      row.className = "dl-row";
      row.dataset.index = String(index);

      const handle = document.createElement("span");
      handle.className = "dl-handle";
      handle.textContent = "\u2261";
      row.appendChild(handle);

      const text = document.createElement("span");
      text.className = "dl-label";
      text.textContent = label;
      row.appendChild(text);

      row.addEventListener("mousedown", (event) => onRowMouseDown(event, index));
      container.appendChild(row);
    });

    edgeLineEl = document.createElement("div");
    edgeLineEl.className = "dl-edge-line";
    container.appendChild(edgeLineEl);
  }

  function rows() {
    return Array.from(container.querySelectorAll(".dl-row"));
  }

  /** Y position (viewport coords) of edge `index`: 0 = above the first
   * row, N = below the last row, matching the schedule grid's edgeY. */
  function edgeY(edgeIndex) {
    const rowEls = rows();
    if (rowEls.length === 0) return null;
    if (edgeIndex < rowEls.length) return rowEls[edgeIndex].getBoundingClientRect().top;
    return rowEls[rowEls.length - 1].getBoundingClientRect().bottom;
  }

  function nearestEdge(clientY) {
    const rowEls = rows();
    let best = 0;
    let bestDist = Infinity;
    for (let edge = 0; edge <= rowEls.length; edge++) {
      const y = edgeY(edge);
      if (y === null) continue;
      const dist = Math.abs(clientY - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = edge;
      }
    }
    return best;
  }

  function showEdgeLine(edge) {
    const y = edgeY(edge);
    if (y === null) return;
    const containerRect = container.getBoundingClientRect();
    edgeLineEl.style.top = `${y - containerRect.top}px`;
    edgeLineEl.style.display = "block";
  }

  function hideEdgeLine() {
    if (edgeLineEl) edgeLineEl.style.display = "none";
  }

  function onRowMouseDown(event, index) {
    dragIndex = index;
    ghostEl = document.createElement("div");
    ghostEl.className = "dl-ghost";
    ghostEl.textContent = items[index];
    document.body.appendChild(ghostEl);
    positionGhost(event.clientX, event.clientY);
    event.preventDefault();
  }

  function positionGhost(x, y) {
    if (ghostEl) {
      ghostEl.style.left = `${x + 12}px`;
      ghostEl.style.top = `${y + 12}px`;
    }
  }

  function onMouseMove(event) {
    if (dragIndex === null) return;
    positionGhost(event.clientX, event.clientY);
    currentEdge = nearestEdge(event.clientY);
    showEdgeLine(currentEdge);
  }

  function onMouseUp() {
    if (dragIndex === null) return;
    const from = dragIndex;
    dragIndex = null;
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    hideEdgeLine();

    if (currentEdge !== null) {
      moveItem(items, from, computeInsertIndex(from, currentEdge));
    }
    currentEdge = null;
    render();
    onChange(items);
  }

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  return {
    destroy: () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
  };
}
