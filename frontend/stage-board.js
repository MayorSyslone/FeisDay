/**
 * StageBoard — pure JS port of the desktop app's stage_board.py.
 * Same behavior: add/remove stages, drag one stage onto another to form a
 * parallel group, drag a stage out to split it off (a group down to 1
 * member auto-dissolves), rename stages/groups. No DOM dependency.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    const exported = factory();
    root.StageBoard = exported.StageBoard;
    root.DEFAULT_LEVEL_CODES = exported.DEFAULT_LEVEL_CODES;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_LEVEL_CODES = [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10];

  class StageBoard {
    constructor() {
      this.stages = {}; // id -> {id, levelCodes: Set, startTime, name}
      this.groups = {}; // id -> {id, members: [stageId,...], name}
      this.slots = []; // [{kind: 'stage', id} | {kind: 'group', id}]
      this._nextStageId = 1;
      this._nextGroupId = 1;
      this._loadDefaultLayout();
    }

    _loadDefaultLayout() {
      const s1 = this._newStage(new Set(DEFAULT_LEVEL_CODES), "8:00 AM", "Stage 1");
      const s2 = this._newStage(new Set(DEFAULT_LEVEL_CODES), "8:00 AM", "Stage 2");
      const s3 = this._newStage(new Set(DEFAULT_LEVEL_CODES), "8:00 AM", "Stage 3");
      const s4 = this._newStage(new Set([6, 7]), "8:00 AM", "Stage 4");
      const groupId = this._nextGroupId++;
      this.groups[groupId] = { id: groupId, members: [s1, s2, s3], name: "Group 1" };
      this.slots = [
        { kind: "group", id: groupId },
        { kind: "stage", id: s4 },
      ];
    }

    _newStage(levelCodes, startTime, name) {
      const id = this._nextStageId++;
      this.stages[id] = {
        id,
        levelCodes: levelCodes || new Set(),
        startTime: startTime || "8:00 AM",
        name: name || `Stage ${id}`,
      };
      return id;
    }

    addStage() {
      const id = this._newStage(new Set(), "8:00 AM");
      this.slots.push({ kind: "stage", id });
      return id;
    }

    removeStage(stageId) {
      const groupId = this._groupContaining(stageId);
      if (groupId !== null) {
        this._removeMemberFromGroup(groupId, stageId);
      } else {
        this.slots = this.slots.filter((s) => !(s.kind === "stage" && s.id === stageId));
      }
      delete this.stages[stageId];
    }

    _groupContaining(stageId) {
      for (const groupId in this.groups) {
        if (this.groups[groupId].members.includes(stageId)) return Number(groupId);
      }
      return null;
    }

    _slotIndexOfStage(stageId) {
      return this.slots.findIndex((s) => s.kind === "stage" && s.id === stageId);
    }

    _slotIndexOfGroup(groupId) {
      return this.slots.findIndex((s) => s.kind === "group" && s.id === groupId);
    }

    _removeMemberFromGroup(groupId, stageId) {
      const group = this.groups[groupId];
      group.members = group.members.filter((m) => m !== stageId);
      if (group.members.length <= 1) this._dissolveGroup(groupId);
    }

    _dissolveGroup(groupId) {
      const group = this.groups[groupId];
      if (!group) return;
      delete this.groups[groupId];
      const idx = this._slotIndexOfGroup(groupId);
      const replacement = group.members.map((m) => ({ kind: "stage", id: m }));
      if (idx !== -1) {
        this.slots.splice(idx, 1, ...replacement);
      } else {
        this.slots.push(...replacement);
      }
    }

    _extractStageFromCurrentLocation(stageId) {
      const groupId = this._groupContaining(stageId);
      if (groupId !== null) {
        this._removeMemberFromGroup(groupId, stageId);
      } else {
        const idx = this._slotIndexOfStage(stageId);
        if (idx !== -1) this.slots.splice(idx, 1);
      }
    }

    dropStageOntoStage(draggedStageId, targetStageId) {
      if (draggedStageId === targetStageId) return;
      const draggedGroup = this._groupContaining(draggedStageId);
      const targetGroup = this._groupContaining(targetStageId);
      if (draggedGroup !== null && draggedGroup === targetGroup) return;

      const targetIdx = this._slotIndexOfStage(targetStageId);
      if (targetIdx === -1) {
        this.dropStageOntoGroup(draggedStageId, targetGroup);
        return;
      }

      this._extractStageFromCurrentLocation(draggedStageId);
      const newTargetIdx = this._slotIndexOfStage(targetStageId);

      const groupId = this._nextGroupId++;
      this.groups[groupId] = { id: groupId, members: [targetStageId, draggedStageId], name: `Group ${groupId}` };
      this.slots[newTargetIdx] = { kind: "group", id: groupId };
    }

    dropStageOntoGroup(draggedStageId, groupId) {
      if (!this.groups[groupId]) return;
      if (this.groups[groupId].members.includes(draggedStageId)) return;
      this._extractStageFromCurrentLocation(draggedStageId);
      this.groups[groupId].members.push(draggedStageId);
    }

    ejectStageToStandalone(stageId) {
      if (this._groupContaining(stageId) === null) return;
      this._extractStageFromCurrentLocation(stageId);
      this.slots.push({ kind: "stage", id: stageId });
    }

    renameStage(stageId, newName) {
      if (this.stages[stageId] && newName.trim()) this.stages[stageId].name = newName.trim();
    }

    renameGroup(groupId, newName) {
      if (this.groups[groupId] && newName.trim()) this.groups[groupId].name = newName.trim();
    }

    flatten() {
      const ordered = [];
      const parallelGroups = [];
      this.slots.forEach((slot) => {
        if (slot.kind === "stage") {
          ordered.push(this.stages[slot.id]);
        } else {
          const positions = [];
          this.groups[slot.id].members.forEach((memberId) => {
            positions.push(ordered.length + 1);
            ordered.push(this.stages[memberId]);
          });
          parallelGroups.push(positions);
        }
      });
      return { ordered, parallelGroups };
    }

    toConfig() {
      const { ordered, parallelGroups } = this.flatten();
      const groupNames = this.slots.filter((s) => s.kind === "group").map((s) => this.groups[s.id].name);
      return {
        stage_perms: ordered.map((s) => Array.from(s.levelCodes).sort((a, b) => a - b)),
        stage_start_times: ordered.map((s) => s.startTime),
        stage_names: ordered.map((s) => s.name),
        parallel_stages: parallelGroups,
        group_names: groupNames,
      };
    }
  }

  return { StageBoard, DEFAULT_LEVEL_CODES };
});
