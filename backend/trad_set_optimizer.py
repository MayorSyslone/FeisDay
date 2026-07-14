import random
import math
import numpy as np


def generate_data(rows=50, cols=7, low=0, high=10, seed=None):
    rng = np.random.default_rng(seed)
    return rng.integers(low, high + 1, size=(rows, cols), dtype=int)


def overlap_of_two_rows(row_a, row_b):
    return int(np.minimum(row_a, row_b).sum())


def overlap_of_group(rows):
    if len(rows) < 2:
        return 0
    return int(np.min(np.vstack(rows), axis=0).sum())


def move_row(order, from_index, to_index):
    if from_index == to_index:
        return order
    moved = order.copy()
    row_id = moved.pop(from_index)
    moved.insert(to_index, row_id)
    return moved


def group_indices_from_order(order, group_size):
    groups = []
    i = 0
    while i < len(order):
        groups.append(order[i:i + group_size])
        i += group_size
    return groups


def total_group_overlap(data, order, group_size=2):
    total = 0
    group_overlaps = []
    for group in group_indices_from_order(order, group_size):
        if len(group) < 2:
            group_overlaps.append((group, 0))
            continue
        overlap = overlap_of_group([data[idx] for idx in group])
        group_overlaps.append((group, overlap))
        total += overlap
    return total, group_overlaps


def improve_order_by_row_moves(data, initial_order, group_size=2, max_passes=10):
    best_order = initial_order.copy()
    best_score, _ = total_group_overlap(data, best_order, group_size=group_size)
    n = len(best_order)

    for _ in range(max_passes):
        improved = False
        for from_index in range(n):
            for to_index in range(n):
                if from_index == to_index:
                    continue
                candidate = move_row(best_order, from_index, to_index)
                candidate_score, _ = total_group_overlap(data, candidate, group_size=group_size)
                if candidate_score > best_score:
                    best_order = candidate
                    best_score = candidate_score
                    improved = True
        if not improved:
            break

    return best_order, best_score


def optimize_row_order(data, group_size=2, random_restarts=40, seed=42):
    n = len(data)
    base_order = list(range(n))
    best_order, best_score = improve_order_by_row_moves(data, base_order, group_size=group_size)

    random.seed(seed)
    for _ in range(random_restarts):
        trial_order = base_order.copy()
        random.shuffle(trial_order)
        trial_order, trial_score = improve_order_by_row_moves(
            data, trial_order, group_size=group_size, max_passes=6
        )
        if trial_score > best_score:
            best_order = trial_order
            best_score = trial_score

    return best_order, best_score


def build_optimized_grouping(rows=50, cols=7, group_size=2, seed=42):
    data = generate_data(rows=rows, cols=cols, seed=seed)
    best_order, best_total_overlap = optimize_row_order(data, group_size=group_size)
    _, groups = total_group_overlap(data, best_order, group_size=group_size)
    return data, best_order, groups, best_total_overlap


def _safe_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def extract_trad_vector_from_source(source_data, tune_count=7):
    values = []
    for i in range(tune_count):
        source_index = 8 + 2 * i
        values.append(max(0, _safe_int(source_data[source_index] if source_index < len(source_data) else 0)))
    return np.array(values, dtype=int)


def optimize_trad_slots(candidates, max_parallel, random_restarts=80):
    if not candidates:
        return []

    group_size = max(1, int(max_parallel))
    matrix = np.array([extract_trad_vector_from_source(comp["source_data"]) for comp in candidates], dtype=int)
    best_order, _ = optimize_row_order(
        matrix, group_size=group_size, random_restarts=random_restarts, seed=42
    )

    slots = []
    for group in group_indices_from_order(best_order, group_size):
        slots.append([candidates[idx] for idx in group])
    return slots


def calculate_parallel_slot_seconds(trad_comps, setup_seconds=60, per_rotation_seconds=120):
    if not trad_comps:
        return 0

    counts_matrix = np.vstack([
        extract_trad_vector_from_source(comp["source_data"])
        for comp in trad_comps
    ])
    ghost_counts = np.max(counts_matrix, axis=0)

    at_values = [float(comp.get("dancers_at_a_time", 2) or 2) for comp in trad_comps]
    ghost_at_a_time = min(at_values) if at_values else 2.0
    ghost_rotations = np.array(
        [math.ceil(count / ghost_at_a_time) if count > 0 else 0 for count in ghost_counts],
        dtype=int
    )

    total_rotations = int(np.sum(ghost_rotations))
    return int(setup_seconds + total_rotations * per_rotation_seconds) if total_rotations > 0 else int(setup_seconds)


if __name__ == "__main__":
    matrix, order, grouped_pairs, total_overlap = build_optimized_grouping(group_size=2)
    print("Matrix shape:", matrix.shape)
    print("Best order:", order)
    print("Total overlap:", total_overlap)
    print("Grouped pairs/groups:")
    for group in grouped_pairs:
        print(group)