/**
 * Simple drag-to-reorder list (dance order / level order in Advanced
 * settings). moveItem is the pure part (testable in Node); mountDraggableList
 * is the DOM/mouse-event layer on top of it.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.moveItem = factory().moveItem;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Moves array[from] to index `to`, shifting everything between. Mutates
   * and returns the array for convenience. */
  function moveItem(array, from, to) {
    if (from === to || from < 0 || from >= array.length) return array;
    const clampedTo = Math.max(0, Math.min(to, array.length - 1));
    const [item] = array.splice(from, 1);
    array.splice(clampedTo, 0, item);
    return array;
  }

  return { moveItem };
});

function mountDraggableList(container, items, onChange) {
  let dragIndex = null;
  let ghostEl = null;

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

  function elementAtIgnoringGhost(x, y) {
    if (ghostEl) ghostEl.style.display = "none";
    const el = document.elementFromPoint(x, y);
    if (ghostEl) ghostEl.style.display = "";
    return el;
  }

  function onMouseMove(event) {
    if (dragIndex === null) return;
    positionGhost(event.clientX, event.clientY);
    Array.from(container.children).forEach((row) => row.classList.remove("dl-drop-target"));
    const target = elementAtIgnoringGhost(event.clientX, event.clientY);
    const row = target ? target.closest(".dl-row") : null;
    if (row) row.classList.add("dl-drop-target");
  }

  function onMouseUp(event) {
    if (dragIndex === null) return;
    const from = dragIndex;
    dragIndex = null;
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }

    const target = elementAtIgnoringGhost(event.clientX, event.clientY);
    const row = target ? target.closest(".dl-row") : null;

    if (row) {
      moveItem(items, from, Number(row.dataset.index));
    }
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
