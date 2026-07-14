/**
 * Rendering + mouse interaction on top of stage-board.js.
 * Mirrors the desktop app's Stages tab: drag a stage card onto another to
 * group them in parallel, drag one out to split it off, rename stages and
 * groups, edit each stage's allowed levels and start time.
 */

const LEVEL_NAME_TO_CODE = {
  "Advanced Beginner thru Prizewinner Charity": 300,
  "Prelim & Champ Charity": 300,
  "Special Need": 100,
  "PreBeginner": 1,
  "Beginner": 2,
  "Adult Beginner": 92,
  "Advanced Beginner": 3,
  "Adult Adv Beginner": 93,
  "Novice": 4,
  "Adult Novice": 94,
  "Prizewinner": 5,
  "Adult Prizewinner": 95,
  "Preliminary": 6,
  "Champion": 7,
  "Adult Championship": 99,
  "All Levels": 8,
  "Team": 10,
};

function generateTimeOptions(startHour = 6, endHour = 21, stepMinutes = 15) {
  const options = [];
  for (let totalMin = startHour * 60; totalMin <= endHour * 60; totalMin += stepMinutes) {
    let hours24 = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    const suffix = hours24 < 12 ? "AM" : "PM";
    let hours12 = hours24 % 12;
    if (hours12 === 0) hours12 = 12;
    options.push(`${String(hours12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`);
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

function mountStageBoard(container, board) {
  render();

  function render() {
    container.innerHTML = "";
    const row = document.createElement("div");
    row.className = "sb-row";

    board.slots.forEach((slot) => {
      if (slot.kind === "stage") {
        row.appendChild(buildStageCard(slot.id, false));
      } else {
        row.appendChild(buildGroupCard(slot.id));
      }
    });

    container.appendChild(row);
  }

  function buildStageCard(stageId, inGroup) {
    const stage = board.stages[stageId];
    const card = document.createElement("div");
    card.className = "sb-card" + (inGroup ? " sb-card-in-group" : "");
    card.dataset.stageId = String(stageId);

    const header = document.createElement("div");
    header.className = "sb-card-header";
    const handle = document.createElement("span");
    handle.className = "sb-drag-handle";
    handle.textContent = stage.name;
    handle.title = "Drag onto another stage to group them";
    header.appendChild(handle);
    makeDraggable(handle, stageId);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "sb-small-btn";
    renameBtn.textContent = "Rename";
    renameBtn.onclick = () => promptRenameStage(stageId);
    header.appendChild(renameBtn);
    card.appendChild(header);

    const levelCount = stage.levelCodes.size;
    const summary = document.createElement("div");
    summary.className = "sb-muted";
    summary.textContent = levelCount
      ? `${levelCount} level${levelCount !== 1 ? "s" : ""} allowed`
      : "No levels selected";
    card.appendChild(summary);

    const editLevelsBtn = document.createElement("button");
    editLevelsBtn.type = "button";
    editLevelsBtn.className = "sb-btn";
    editLevelsBtn.textContent = "Edit levels…";
    editLevelsBtn.onclick = () => openLevelPicker(stageId);
    card.appendChild(editLevelsBtn);

    if (!inGroup) {
      const timeLabel = document.createElement("label");
      timeLabel.className = "sb-time-label";
      timeLabel.textContent = "Start time";
      const select = document.createElement("select");
      TIME_OPTIONS.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        if (t === stage.startTime) opt.selected = true;
        select.appendChild(opt);
      });
      select.onchange = () => { stage.startTime = select.value; };
      timeLabel.appendChild(select);
      card.appendChild(timeLabel);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "sb-btn sb-btn-danger";
    removeBtn.textContent = "Remove stage";
    removeBtn.onclick = () => { board.removeStage(stageId); render(); };
    card.appendChild(removeBtn);

    return card;
  }

  function buildGroupCard(groupId) {
    const group = board.groups[groupId];
    const outer = document.createElement("div");
    outer.className = "sb-group-card";

    const header = document.createElement("div");
    header.className = "sb-card-header";
    const label = document.createElement("span");
    label.className = "sb-group-label";
    label.textContent = group.name;
    header.appendChild(label);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "sb-small-btn";
    renameBtn.textContent = "Rename";
    renameBtn.onclick = () => promptRenameGroup(groupId);
    header.appendChild(renameBtn);
    outer.appendChild(header);

    const firstStage = board.stages[group.members[0]];
    const timeLabel = document.createElement("label");
    timeLabel.className = "sb-time-label";
    timeLabel.textContent = "Shared start time";
    const select = document.createElement("select");
    TIME_OPTIONS.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === firstStage.startTime) opt.selected = true;
      select.appendChild(opt);
    });
    select.onchange = () => {
      group.members.forEach((m) => { board.stages[m].startTime = select.value; });
    };
    timeLabel.appendChild(select);
    outer.appendChild(timeLabel);

    const membersRow = document.createElement("div");
    membersRow.className = "sb-members-row";
    group.members.forEach((stageId) => {
      membersRow.appendChild(buildStageCard(stageId, true));
    });
    outer.appendChild(membersRow);

    return outer;
  }

  // -------------------------------------------------------------- drag

  let dragStageId = null;
  let ghostEl = null;

  function makeDraggable(handleEl, stageId) {
    handleEl.addEventListener("mousedown", (e) => {
      dragStageId = stageId;
      ghostEl = document.createElement("div");
      ghostEl.className = "sb-drag-ghost";
      ghostEl.textContent = board.stages[stageId].name;
      document.body.appendChild(ghostEl);
      positionGhost(e.clientX, e.clientY);
      e.preventDefault();
    });
  }

  function positionGhost(x, y) {
    if (ghostEl) {
      ghostEl.style.left = `${x + 12}px`;
      ghostEl.style.top = `${y + 12}px`;
    }
  }

  window.addEventListener("mousemove", (e) => {
    if (dragStageId !== null) positionGhost(e.clientX, e.clientY);
  });

  window.addEventListener("mouseup", (e) => {
    if (dragStageId === null) return;
    const stageId = dragStageId;
    dragStageId = null;
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }

    const target = elementAtIgnoringGhost(e.clientX, e.clientY);
    const targetCard = target ? target.closest(".sb-card:not(.sb-card-in-group), .sb-card-in-group") : null;

    if (!targetCard) {
      board.ejectStageToStandalone(stageId);
      render();
      return;
    }

    const targetStageId = targetCard.dataset.stageId ? Number(targetCard.dataset.stageId) : null;

    if (targetStageId !== null && targetStageId !== stageId) {
      board.dropStageOntoStage(stageId, targetStageId);
    } else {
      board.ejectStageToStandalone(stageId);
    }
    render();
  });

  function elementAtIgnoringGhost(x, y) {
    if (ghostEl) ghostEl.style.display = "none";
    const el = document.elementFromPoint(x, y);
    if (ghostEl) ghostEl.style.display = "";
    return el;
  }

  // ------------------------------------------------------------ dialogs

  function openLevelPicker(stageId) {
    const stage = board.stages[stageId];
    const overlay = document.createElement("div");
    overlay.className = "sb-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sb-modal";
    modal.innerHTML = `<h3>Which levels can ${escapeHtml(stage.name)} run?</h3>`;

    const grid = document.createElement("div");
    grid.className = "sb-level-grid";
    const checkboxes = {};
    Object.keys(LEVEL_NAME_TO_CODE).forEach((name) => {
      const code = LEVEL_NAME_TO_CODE[name];
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = stage.levelCodes.has(code);
      checkboxes[name] = cb;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + name));
      grid.appendChild(label);
    });
    modal.appendChild(grid);

    const buttonRow = document.createElement("div");
    buttonRow.className = "sb-modal-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sb-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => overlay.remove();
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "sb-btn sb-btn-accent";
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => {
      const codes = new Set();
      Object.keys(checkboxes).forEach((name) => {
        if (checkboxes[name].checked) codes.add(LEVEL_NAME_TO_CODE[name]);
      });
      stage.levelCodes = codes;
      overlay.remove();
      render();
    };
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    modal.appendChild(buttonRow);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function promptRenameStage(stageId) {
    const name = window.prompt("Rename stage:", board.stages[stageId].name);
    if (name && name.trim()) {
      board.renameStage(stageId, name);
      render();
    }
  }

  function promptRenameGroup(groupId) {
    const name = window.prompt("Rename parallel group:", board.groups[groupId].name);
    if (name && name.trim()) {
      board.renameGroup(groupId, name);
      render();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    addStage: () => { board.addStage(); render(); },
    render,
  };
}
