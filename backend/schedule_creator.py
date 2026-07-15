import pandas as pd
import numpy as np
import re
import math
import sys
import json
from datetime import datetime
from trad_set_optimizer import optimize_trad_slots, calculate_parallel_slot_seconds
import os

# Optional CLI args so this can be driven by a UI instead of always
# popping its own file dialog / writing to a fixed path:
#   python schedule_creator.py [input_csv_path] [output_csv_path] [config_json_path]
# Any argument can be omitted; omitted ones fall back to the original
# default behavior (file dialog, default output path, hardcoded settings below).
_csv_path_arg = sys.argv[1] if len(sys.argv) > 1 else None
_output_csv_arg = sys.argv[2] if len(sys.argv) > 2 else None
_config_path_arg = sys.argv[3] if len(sys.argv) > 3 else None


def _load_config_overrides(config_path):
    if not config_path or not os.path.exists(config_path):
        return {}
    with open(config_path, "r") as config_file:
        return json.load(config_file)


_config_overrides = _load_config_overrides(_config_path_arg)

age_hard_stop = _config_overrides.get("age_hard_stop", 3)

# stage_perms is a list with one entry per stage (in stage order), each entry
# being the list of numeric level codes that stage is allowed to run. The
# number of stages is simply len(stage_perms) - add/remove entries to
# add/remove stages. Defaults to the original 4-stage setup.
stage_perms = _config_overrides.get(
    "stage_perms",
    [
        [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
        [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
        [300, 100, 1, 2, 92, 3, 93, 4, 94, 5, 95, 99, 8, 10],
        [6, 7],
    ],
)

# One start time per stage, same order as stage_perms.
stage_start_times = _config_overrides.get(
    "stage_start_times", ["8:00:00 AM"] * len(stage_perms)
)

lunch_time_range = tuple(_config_overrides.get("lunch_time_range", ("11:30:00 AM", "1:00:00 PM")))

lunch_length = _config_overrides.get("lunch_length", 60) # In minutes

max_early_fill_minutes = _config_overrides.get("max_early_fill_minutes", 90) # Max minutes a comp can be pulled earlier to fill HOLD spots

# List of parallel stage groups. Each inner list holds the (1-indexed) stage
# numbers that run in lockstep together. Stages not listed in any group run
# independently. Defaults to the original setup: stages 1-3 in parallel,
# stage 4 independent.
parallel_stages = _config_overrides.get("parallel_stages", [[1,2,3]])

# Optional friendly display names (purely cosmetic — used in the CSV header
# and the interactive schedule editor's sidecar JSON). Falls back to
# "Stage N" / "Group N" if not provided.
stage_names = _config_overrides.get("stage_names", [f"Stage {i + 1}" for i in range(len(stage_perms))])
group_names = _config_overrides.get("group_names", [f"Group {i + 1}" for i in range(len(parallel_stages))])

dance_type_order = _config_overrides.get(
    "dance_type_order",
    ["Treble Reel", "Treble Jig", "Slip Jig", "Hornpipe", "Single Jig", "Single (Hop) Jig", "Reel", "Light Jig", "2 Rounds", "3 Rounds", "Traditional Set", "4 Hand", "8 Hand", "Dancers Choice"],
)

dance_level_order = _config_overrides.get(
    "dance_level_order",
    ["Advanced Beginner thru Prizewinner Charity", "Prelim & Champ Charity", "Special Need", "Special Needs", "PreBeginner", "Beginner", "Adult Beginner", "Advanced Beginner", "Adult Adv Beginner", "Novice", "Adult Novice", "Prizewinner", "Adult Prizewinner", "Preliminary", "Champion", "Adult Championship", "All Levels", "Team"],
)

# "youngest_first" (default, ascending) or "oldest_first" (descending).
age_sort_direction = _config_overrides.get("age_sort_direction", "youngest_first")

dance_type_map = {"Treble Reel" : 1, "Treble Jig" : 2, "Slip Jig" : 3, "Hornpipe" : 4, "Single Jig" : 5,
                  "Single (Hop) Jig" : 5, "Reel" : 6, "Light Jig" : 7, "2 Rounds": 8, "3 Rounds" : 9,
                  "Traditional Set" : 10, "4 Hand" : 11, "8 Hand" : 13, "Dancers Choice" : 14}
dance_level_map = {"Advanced Beginner thru Prizewinner Charity" : 300, "Prelim & Champ Charity" : 300,
                   "Special Need" : 100, "Special Needs" : 100, "PreBeginner" : 1, "Beginner" : 2, "Adult Beginner" : 92,
                   "Advanced Beginner" : 3, "Adult Adv Beginner" : 93, "Novice" : 4, "Adult Novice" : 94,
                   "Prizewinner" : 5, "Adult Prizewinner" : 95, "Preliminary" : 6, "Champion" : 7,
                   "Adult Championship" : 99, "All Levels" : 8, "Team" : 10}

dance_time_sec = {"Treble Reel" : 90, "Treble Jig" : 90, "Slip Jig" : 90, "Hornpipe" : 90, "Single Jig" : 90,
                         "Single (Hop) Jig" : 90, "Reel" : 90, "Light Jig" : 90, "2 Rounds": 120, "3 Rounds" : 120,
                         "Traditional Set" : 120, "4 Hand" : 135, "8 Hand" : 135, "Dancers Choice" : 120}

stage_schedule = np.zeros(len(stage_perms))

def select_and_convert_csv(forced_path=None):
    if forced_path:
        df = pd.read_csv(forced_path)
        return df.to_numpy()

    # Only needed for the desktop app's no-argument fallback. Imported here
    # (rather than at module load) so this file can run on servers without
    # Tk/Tcl installed (e.g. Render) as long as a forced_path is always given.
    import tkinter as tk
    from tkinter import filedialog

    # Initialize hidden tkinter root
    root = tk.Tk()
    root.withdraw()

    # Open file dialog
    file_path = filedialog.askopenfilename(
        title="Select a CSV file",
        filetypes=[("CSV files", "*.csv")]
    )

    if file_path:
        # Read CSV into a Pandas DataFrame
        df = pd.read_csv(file_path)
        
        # Convert to a Pandas/NumPy array
        data_array = df.to_numpy()
        
        return data_array
    
    return None

dancer_data = select_and_convert_csv(_csv_path_arg)

# Create an empty array with the same amount of rows as dancer data and 14 columns to hstack it to the right of the dancer data (used right after)
empty_array = np.full((len(dancer_data), 12), None, dtype=object)
dancer_data = np.hstack((dancer_data, empty_array))

# Account for a ton of NaN gaps since some comps have extra data so empty rows are created to store that data. This can be done by simply
# Checking where column 1 is a NaN, and moving any data in that row to the end of the row of that competition (the nearest row above that
# has a filled in code), after which the row with the NaN code is removed. This is done in a while loop until all rows have a filled in code.
for i in range(len(dancer_data)):
    if pd.isna(dancer_data[i, 1]):
        # Find the nearest row above with a filled in code
        for j in range(i-1, -1, -1):
            if not pd.isna(dancer_data[j, 1]):
                # Remove NaN values from the current row before moving data
                dancer_data_cur = dancer_data[i][~pd.isna(dancer_data[i])]

                # Move data from the current row to the end of the found row (starting at the earlierst None value in that row)
                first_none_index = np.where(dancer_data[j] == None)[0][0]
                dancer_data[j][first_none_index:first_none_index+len(dancer_data_cur)] = dancer_data_cur
                break

# Remove full NaN rows where data was moved out of
dancer_data = dancer_data[~pd.isna(dancer_data[:, 1])]

dance_codes = dancer_data[:,1]
dancer_counts = dancer_data[:,2]
dance_genders = dancer_data[:,3]
dance_levels = dancer_data[:,4]
dance_types = dancer_data[:,5]
dance_ages_raw = dancer_data[:,6]

def collect_non_empty_values(values):
    return [
        value for value in values
        if not (pd.isna(value) or value is None or (isinstance(value, str) and value.strip() == ""))
    ]

def merge_unique_values(left_values, right_values):
    merged = []
    for value in list(left_values) + list(right_values):
        if value not in merged:
            merged.append(value)
    return merged

def merge_text_values(left_value, right_value):
    left = collect_non_empty_values([left_value])
    right = collect_non_empty_values([right_value])
    merged = merge_unique_values(left, right)
    return "/".join(str(value) for value in merged) if merged else None

comp_source_data = np.array([collect_non_empty_values(row) for row in dancer_data], dtype=object)

type_to_num = np.vectorize(lambda x: dance_type_map.get(x, 0))
level_to_num = np.vectorize(lambda x: dance_level_map.get(x, 0))

dance_type_num = type_to_num(dance_types)
dance_level_num = level_to_num(dance_levels)

'''
For each dance entry, determine a numeric "age group" used only for merging low-count competitions
with a nearby age group of the same dance type, and for age-based sort ordering. Adult levels are
always treated as 21 and Special Need(s) as 0, regardless of the Age column text, since the level
name alone already establishes those unambiguously. For everything else, the age group is read
directly from the CSV's own "Age" column (e.g. "Under 12", "Under 12 All", "12 & Over", "Adult",
"Adult 40 & Over") by pulling the first number out of that text. Entries with no parseable number
(blank, "All Ages", etc.) are left as NaN, which the merge/sort logic below already treats as
"no age info" (skipped for merging, sorted last).
'''
ADULT_LEVEL_NAMES = {"Adult Beginner", "Adult Adv Beginner", "Adult Novice", "Adult Prizewinner", "Adult Championship"}
SPECIAL_NEED_LEVEL_NAMES = {"Special Need", "Special Needs"}

def parse_age_group(age_text, level_name):
    if level_name in ADULT_LEVEL_NAMES:
        return 21
    if level_name in SPECIAL_NEED_LEVEL_NAMES:
        return 0
    if not isinstance(age_text, str) or not age_text.strip():
        return float("nan")
    match = re.search(r"\d+", age_text)
    if match:
        return int(match.group())
    if "adult" in age_text.lower():
        return 21
    return float("nan")

age_group = np.empty(len(dance_codes))
for i in range(len(dance_codes)):
    age_group[i] = parse_age_group(dance_ages_raw[i], dance_levels[i])

# Find all competitions where the level is between beginner and prelim and the dancer count is below 5 (not using .get since its a numpy array)
low_comp_count = np.where((dance_level_num >= 1) & (dance_level_num <= 6) & (dancer_counts < 5))[0]

'''
Merge low counts with nearby age groups of the same dance type (using the age group array from earlier + picking the nearest age group with a lower
dancer count). After a merge, this mixed dance group is treated as a single group and the original low-count group is removed from the list of
competitions unless it is still below 5 dancers in which case it is merged again with the next nearest age group with a lower dancer count. This
continues until all low-count groups are merged or removed OR the whole group reaches the age hard stop. After merging, the codes are written as
"code1/code2" and the dancer count is the sum of the two groups. The age group is now a list (if it were 7,8 then 9 and 10 could be chosen to
merge).

The script runs from the end of the list to the beginning in a while loop (only runs while low_comp_count is not empty) and checks the nearest age group with a lower dancer count. If it finds one, it merges the two groups and removes the original low-count group from the list of competitions. If it does not find one, it keeps the original group and moves on to the next low-count group. This continues until all low-count groups are merged or removed OR the whole group reaches the age hard stop.
'''

# Convert the age_group array type to object so it accepts mixed scalar/list ages after merges
age_group = age_group.astype(object)

def normalize_age_values(age_value):
    if isinstance(age_value, list):
        flattened = []
        for value in age_value:
            flattened.extend(normalize_age_values(value))
        return flattened
    if pd.isna(age_value):
        return []
    return [int(age_value)]

while len(low_comp_count) > 0:
    for i in low_comp_count:
        current_age_group = age_group[i]
        current_dance_type = dance_types[i]
        current_dance_level = dance_level_num[i]
        current_dancer_count = dancer_counts[i]
        current_age_values = normalize_age_values(current_age_group)

        # Find the nearest age group with a lower dancer count
        nearest_index = None
        nearest_age_diff = float('inf')

        for j in range(len(dance_codes)):
            if (
                i != j
                and dance_types[j] == current_dance_type
                and dance_level_num[j] == current_dance_level
                and dancer_counts[j] < current_dancer_count
            ):
                comparison_age_values = normalize_age_values(age_group[j]) + current_age_values
                if len(comparison_age_values) == 0:
                    continue
                age_diff = max(comparison_age_values) - min(comparison_age_values)

                if age_diff < nearest_age_diff and age_diff <= age_hard_stop:
                    nearest_index = j
                    nearest_age_diff = age_diff

        if nearest_index is not None:
            # Merge the two groups
            dance_codes[nearest_index] += f"/{dance_codes[i]}"
            dancer_counts[nearest_index] += dancer_counts[i]
            merged_ages = normalize_age_values(age_group[nearest_index]) + normalize_age_values(age_group[i])
            age_group[nearest_index] = sorted(set(merged_ages))
            dance_genders[nearest_index] = merge_text_values(dance_genders[nearest_index], dance_genders[i])
            comp_source_data[nearest_index] = merge_unique_values(comp_source_data[nearest_index], comp_source_data[i])

            # Remove the original low-count group from the list of competitions
            dance_codes = np.delete(dance_codes, i)
            dancer_counts = np.delete(dancer_counts, i)
            dance_level_num = np.delete(dance_level_num, i)
            dance_type_num = np.delete(dance_type_num, i)
            dance_levels = np.delete(dance_levels, i)
            dance_types = np.delete(dance_types, i)
            dance_genders = np.delete(dance_genders, i)
            comp_source_data = np.delete(comp_source_data, i)
            age_group = np.delete(age_group, i)

            # Update low_comp_count after deletion
            low_comp_count = np.where((dance_level_num >= 1) & (dance_level_num <= 6) & (dancer_counts < 5))[0]
            break
    else:
        # If no merges were made, break the loop
        break

# Now a main scheduling array is created with all compeitions organized by level (using the level order), then by type (using the type order),
# then by dancer count least to greatest, and then by age group (which if it is a range should techincally still nest correctly) - this is
# mainly done from least to greatest

level_sort_order = {level: index for index, level in enumerate(dance_level_order)}
type_sort_order = {dance_type_name: index for index, dance_type_name in enumerate(dance_type_order)}

def age_group_sort_key(age_value):
    values = normalize_age_values(age_value)
    if not values:
        return (float('inf'),)
    if age_sort_direction == "oldest_first":
        return tuple(sorted(-v for v in values))
    return tuple(sorted(values))

def dancer_count_sort_key(count_value):
    try:
        return -int(count_value)
    except (TypeError, ValueError):
        return 0

sorted_competitions = sorted(
    zip(dance_codes, dancer_counts, dance_genders, dance_levels, dance_types, age_group, comp_source_data),
    key=lambda row: (
        level_sort_order.get(row[3], len(level_sort_order)),
        type_sort_order.get(row[4], len(type_sort_order)),
        dancer_count_sort_key(row[1]),
        age_group_sort_key(row[5]),
    )
)

def dancers_at_a_time(dance_level_name, dance_type_name):
    if dance_type_name == "8 Hand":
        return 1
    if dance_level_name in ["Preliminary", "Champion", "Adult Championship", "Prelim & Champ Charity"]:
        return 2.5
    return 2

def calculate_total_time_seconds(comp):
    dancer_count = int(comp[1])
    source_data = comp[-1]

    if dancer_count == 0:
        return 0
    else:
        dance_level = comp[3]
        dance_type = comp[4]
        at_a_time = dancers_at_a_time(dance_level, dance_type)
        if dance_type != "Traditional Set":
            rotation_count = math.ceil(dancer_count / at_a_time)
        else:
            rotation_count = 0
            for i in range(7):
                rotation_count += math.ceil(int(source_data[2*i+8]) / at_a_time)

        sec = dance_time_sec.get(dance_type)
        
        if dance_type not in ["2 Rounds", "3 Rounds"]:
            return sec * rotation_count + 60
        else:
            return sec * rotation_count + sec * dancer_count + 60

def build_output_source_data(comp):
    source_data = list(comp[-1])
    if len(source_data) < 6:
        source_data += [None] * (6 - len(source_data))
    source_data[1] = comp[0]
    source_data[2] = int(comp[1])
    source_data[3] = comp[2]
    source_data[4] = comp[3]
    source_data[5] = comp[4]
    return source_data

scheduling_with_time = [
    (calculate_total_time_seconds(comp), build_output_source_data(comp))
    for comp in sorted_competitions
]

max_source_len = max((len(source_data) for _, source_data in scheduling_with_time), default=0)

scheduling_array = np.array([
    [time_seconds] + list(source_data) + [None] * (max_source_len - len(source_data))
    for time_seconds, source_data in scheduling_with_time
], dtype=object)

scheduling_labels = ["Time (Seconds)"] + [f"Source Data {i+1}" for i in range(max_source_len)]

'''
Create stage schedules from the sorted competitions while respecting stage level permissions.
For parallel stage groups, each slot index must use the same dance type across the group.
If a stage cannot run that slot's dance type immediately, it is marked HOLD for that slot.
Slot duration in a parallel group is the longest competition duration in that slot, so
all stages in that group advance to the same next start time.
'''

stage_comp_entries = [[] for _ in range(len(stage_perms))]
stage_start_entries = [[] for _ in range(len(stage_perms))]
stage_comp_duration = [[] for _ in range(len(stage_perms))]   # seconds cost of each row, for the interactive editor
stage_comp_dance = [[] for _ in range(len(stage_perms))]      # dance type of each row (None for HOLD), for the interactive editor
next_stage_cursor = 0
stage_assigned_comps = [[] for _ in range(len(stage_perms))]
stage_current_times = np.zeros(len(stage_perms), dtype=int)
stage_start_seconds = np.zeros(len(stage_perms), dtype=int)

def start_time_to_seconds(start_time):
    for fmt in ("%I:%M:%S %p", "%I:%M %p"):
        try:
            parsed = datetime.strptime(start_time, fmt)
            return parsed.hour * 3600 + parsed.minute * 60 + parsed.second
        except ValueError:
            continue
    return 8 * 3600

def seconds_to_duration_hms(total_seconds):
    total_seconds = int(total_seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02}:{minutes:02}:{seconds:02}"

def seconds_to_clock_ampm(total_seconds):
    total_seconds = int(total_seconds) % (24 * 3600)
    hours_24 = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    suffix = "AM" if hours_24 < 12 else "PM"
    hours_12 = hours_24 % 12
    if hours_12 == 0:
        hours_12 = 12
    return f"{hours_12:02}:{minutes:02}:{seconds:02} {suffix}"

def normalize_parallel_groups(raw_groups, total_stages):
    normalized_groups = []
    for raw_group in raw_groups:
        group = []
        for stage in raw_group:
            if not isinstance(stage, (int, np.integer)):
                continue
            if 1 <= int(stage) <= total_stages:
                stage_index = int(stage) - 1
            elif 0 <= int(stage) < total_stages:
                stage_index = int(stage)
            else:
                continue
            if stage_index not in group:
                group.append(stage_index)
        if len(group) > 1:
            normalized_groups.append(group)
    return normalized_groups

for stage_index in range(len(stage_perms)):
    configured_start = stage_start_times[stage_index] if stage_index < len(stage_start_times) else "8:00:00 AM"
    stage_start_seconds[stage_index] = start_time_to_seconds(configured_start)
    stage_current_times[stage_index] = stage_start_seconds[stage_index]

lunch_window_start = start_time_to_seconds(lunch_time_range[0])
lunch_window_end = start_time_to_seconds(lunch_time_range[1])
lunch_duration_seconds = int(lunch_length * 60)
max_early_fill_seconds = int(max_early_fill_minutes * 60)
lunch_taken = [False for _ in range(len(stage_perms))]

def maybe_insert_lunch(stage_index):
    if lunch_taken[stage_index]:
        return
    comp_end_time = int(stage_current_times[stage_index])
    if lunch_window_start <= comp_end_time <= lunch_window_end:
        stage_start_entries[stage_index].append(seconds_to_clock_ampm(stage_current_times[stage_index]))
        stage_comp_entries[stage_index].append("LUNCH")
        stage_comp_duration[stage_index].append(lunch_duration_seconds)
        stage_comp_dance[stage_index].append("LUNCH")
        stage_current_times[stage_index] += lunch_duration_seconds
        lunch_taken[stage_index] = True

for i, comp in enumerate(sorted_competitions):
    comp_time = scheduling_with_time[i][0]
    comp_code = comp[0]
    comp_dancer_count = int(comp[1])
    comp_level_name = comp[3]
    comp_dance_type = comp[4]

    # Determine the stage permissions for the current competition
    current_level_num = dance_level_map.get(comp_level_name, 0)
    allowed_stages = [stage_index for stage_index, perms in enumerate(stage_perms) if current_level_num in perms]
    if not allowed_stages:
        continue

    # Fill stage spots in round-robin order (Stage 1, Stage 2, ... then back to Stage 1),
    # while still respecting stage permissions.
    selected_stage_index = None
    for offset in range(len(stage_perms)):
        candidate_stage = (next_stage_cursor + offset) % len(stage_perms)
        if candidate_stage in allowed_stages:
            selected_stage_index = candidate_stage
            break
    if selected_stage_index is None:
        continue

    stage_assigned_comps[selected_stage_index].append({
        "comp_id": i,
        "order": i,
        "code": comp_code,
        "count": comp_dancer_count,
        "time_seconds": int(comp_time),
        "dance_type": comp_dance_type,
        "level_name": comp_level_name,
        "stage_index": selected_stage_index,
        "source_data": scheduling_with_time[i][1],
        "dancers_at_a_time": dancers_at_a_time(comp_level_name, comp_dance_type),
    })
    next_stage_cursor = (selected_stage_index + 1) % len(stage_perms)

normalized_parallel_groups = normalize_parallel_groups(parallel_stages, len(stage_perms))
stage_to_group = {}
effective_parallel_groups = []
for group in normalized_parallel_groups:
    filtered_group = [stage for stage in group if stage not in stage_to_group]
    if len(filtered_group) > 1:
        group_id = len(effective_parallel_groups)
        effective_parallel_groups.append(filtered_group)
        for stage in filtered_group:
            stage_to_group[stage] = group_id

# Non-parallel stages run sequentially.
for stage_index in range(len(stage_perms)):
    if stage_index in stage_to_group:
        continue
    for comp in stage_assigned_comps[stage_index]:
        stage_start_entries[stage_index].append(seconds_to_clock_ampm(stage_current_times[stage_index]))
        stage_comp_entries[stage_index].append(f"{comp['code']} ({comp['count']})")
        stage_comp_duration[stage_index].append(int(comp["time_seconds"]))
        stage_comp_dance[stage_index].append(comp["dance_type"])
        stage_current_times[stage_index] += comp["time_seconds"]
        maybe_insert_lunch(stage_index)

# Parallel groups run slot-by-slot, with HOLD where a stage cannot fill the slot dance type.
for group in effective_parallel_groups:
    group_positions = {stage_index: 0 for stage_index in group}
    consumed_comp_ids = set()

    def advance_group_position(stage_index):
        while (
            group_positions[stage_index] < len(stage_assigned_comps[stage_index])
            and stage_assigned_comps[stage_index][group_positions[stage_index]]["comp_id"] in consumed_comp_ids
        ):
            group_positions[stage_index] += 1

    def has_remaining(stage_index):
        advance_group_position(stage_index)
        return group_positions[stage_index] < len(stage_assigned_comps[stage_index])

    def assign_slot_to_group(slot_comps):
        by_comp_allowed = []
        for comp in slot_comps:
            level_num = dance_level_map.get(comp["level_name"], 0)
            allowed = [stage for stage in group if level_num in stage_perms[stage]]
            if comp["stage_index"] in allowed:
                allowed = [comp["stage_index"]] + [s for s in allowed if s != comp["stage_index"]]
            by_comp_allowed.append((comp, allowed))
        by_comp_allowed.sort(key=lambda item: len(item[1]))

        assigned = {}
        used_stages = set()

        def backtrack(idx):
            if idx == len(by_comp_allowed):
                return True
            comp, allowed = by_comp_allowed[idx]
            for stage in allowed:
                if stage in used_stages:
                    continue
                assigned[comp["comp_id"]] = stage
                used_stages.add(stage)
                if backtrack(idx + 1):
                    return True
                used_stages.remove(stage)
                assigned.pop(comp["comp_id"], None)
            return False

        backtrack(0)
        return assigned

    def find_promotable_candidate(stage_index, dance_type, min_level_priority):
        advance_group_position(stage_index)
        start_position = group_positions[stage_index]
        early_shift_seconds = 0
        comps = stage_assigned_comps[stage_index]

        for position in range(start_position, len(comps)):
            candidate = comps[position]
            if candidate["comp_id"] in consumed_comp_ids:
                continue

            candidate_level_priority = level_sort_order.get(candidate["level_name"], len(level_sort_order))
            if (
                candidate["dance_type"] == dance_type
                and candidate_level_priority >= min_level_priority
                and early_shift_seconds <= max_early_fill_seconds
            ):
                return position, candidate

            early_shift_seconds += candidate["time_seconds"]
            if early_shift_seconds > max_early_fill_seconds:
                break

        return None, None

    def pick_best_slot_dance_type(group, group_positions, stage_assigned_comps, consumed_comp_ids, lookahead=5):
        """
        Look ahead at the next N comps in each stage and pick the dance type
        that minimizes HOLDs (maximizes fills).
        Returns (dance_type, anchor_comp, anchor_stage).
        """
        type_fill_counts = {}
        
        for stage_index in group:
            advance_group_position(stage_index)
            if group_positions[stage_index] >= len(stage_assigned_comps[stage_index]):
                continue
            
            # Look ahead at next lookahead comps in this stage
            for offset in range(lookahead):
                pos = group_positions[stage_index] + offset
                if pos >= len(stage_assigned_comps[stage_index]):
                    break
                comp = stage_assigned_comps[stage_index][pos]
                if comp["comp_id"] in consumed_comp_ids:
                    continue
                
                dtype = comp["dance_type"]
                if dtype not in type_fill_counts:
                    type_fill_counts[dtype] = []
                type_fill_counts[dtype].append((stage_index, comp, pos, offset))
                break  # Only look at first non-consumed comp per stage per lookahead
        
        # Pick dance type with most stages ready (minimizes HOLDs)
        if not type_fill_counts:
            return None, None, None
        
        best_type = max(type_fill_counts.keys(), key=lambda t: len(set(s for s, _, _, _ in type_fill_counts[t])))
        entries = type_fill_counts[best_type]
        anchor_stage, anchor_comp, _, _ = min(entries, key=lambda e: e[1]["order"])
        
        return best_type, anchor_comp, anchor_stage

    while any(has_remaining(stage_index) for stage_index in group):
        available_next = []
        for stage_index in group:
            if has_remaining(stage_index):
                position = group_positions[stage_index]
                available_next.append((stage_assigned_comps[stage_index][position], stage_index))
        if not available_next:
            break

        slot_dance_type, anchor_comp, anchor_stage = pick_best_slot_dance_type(group, group_positions, stage_assigned_comps, consumed_comp_ids)
        if slot_dance_type is None:
            break
        slot_duration = 0
        slot_entries = {stage_index: "HOLD" for stage_index in group}

        if slot_dance_type == "Traditional Set":
            trad_candidates = []
            for stage_index in group:
                advance_group_position(stage_index)
                for candidate in stage_assigned_comps[stage_index][group_positions[stage_index]:]:
                    if candidate["comp_id"] in consumed_comp_ids:
                        continue
                    if candidate["dance_type"] == "Traditional Set":
                        trad_candidates.append(candidate)

            if trad_candidates:
                trad_slots = optimize_trad_slots(trad_candidates, len(group))
                for trad_slot in trad_slots:
                    slot_duration = calculate_parallel_slot_seconds(trad_slot)
                    slot_entries = {stage_index: "HOLD" for stage_index in group}
                    assigned_stages = assign_slot_to_group(trad_slot)
                    assigned_any = False

                    for comp in trad_slot:
                        if comp["comp_id"] in assigned_stages:
                            assigned_stage = assigned_stages[comp["comp_id"]]
                            slot_entries[assigned_stage] = f"{comp['code']} ({comp['count']})"
                            consumed_comp_ids.add(comp["comp_id"])
                            assigned_any = True

                    if not assigned_any and trad_slot:
                        fallback = trad_slot[0]
                        fallback_stage = fallback["stage_index"] if fallback["stage_index"] in group else group[0]
                        slot_entries[fallback_stage] = f"{fallback['code']} ({fallback['count']})"
                        consumed_comp_ids.add(fallback["comp_id"])

                    for stage_index in group:
                        stage_start_entries[stage_index].append(seconds_to_clock_ampm(stage_current_times[stage_index]))
                        stage_comp_entries[stage_index].append(slot_entries[stage_index])
                        stage_comp_duration[stage_index].append(int(slot_duration))
                        stage_comp_dance[stage_index].append(
                            None if slot_entries[stage_index] == "HOLD" else "Traditional Set"
                        )
                        stage_current_times[stage_index] += slot_duration
                        maybe_insert_lunch(stage_index)
                continue
        else:
            anchor_level_priority = level_sort_order.get(anchor_comp["level_name"], len(level_sort_order))
            for stage_index in group:
                if not has_remaining(stage_index):
                    continue

                position, candidate = find_promotable_candidate(
                    stage_index,
                    slot_dance_type,
                    anchor_level_priority
                )
                if candidate is None:
                    continue

                slot_entries[stage_index] = f"{candidate['code']} ({candidate['count']})"
                slot_duration = max(slot_duration, candidate["time_seconds"])

                if position == group_positions[stage_index]:
                    group_positions[stage_index] += 1
                else:
                    consumed_comp_ids.add(candidate["comp_id"])

        for stage_index in group:
            stage_start_entries[stage_index].append(seconds_to_clock_ampm(stage_current_times[stage_index]))
            stage_comp_entries[stage_index].append(slot_entries[stage_index])
            stage_comp_duration[stage_index].append(int(slot_duration))
            stage_comp_dance[stage_index].append(
                None if slot_entries[stage_index] == "HOLD" else slot_dance_type
            )
            stage_current_times[stage_index] += slot_duration
            
            maybe_insert_lunch(stage_index)

stage_schedule = stage_current_times - stage_start_seconds

# Create 2 columns per stage (Time | Comp)
stage_columns = {}
for stage_index in range(len(stage_perms)):
    stage_name = stage_names[stage_index] if stage_index < len(stage_names) else f"Stage {stage_index + 1}"
    time_col_name = f"{stage_name} Time"
    comp_col_name = f"{stage_name} Comp"
    
    # Start with stage name as header (will be in row 0)
    stage_columns[time_col_name] = [stage_name]
    stage_columns[comp_col_name] = [stage_name]
    
    # Add time and comp entries
    for i in range(len(stage_comp_entries[stage_index])):
        time_entry = stage_start_entries[stage_index][i] if i < len(stage_start_entries[stage_index]) else ""
        comp_entry = stage_comp_entries[stage_index][i]
        stage_columns[time_col_name].append(time_entry)
        stage_columns[comp_col_name].append(comp_entry)

max_stage_rows = max((len(values) for values in stage_columns.values()), default=0)
for col_name in stage_columns:
    stage_columns[col_name] = stage_columns[col_name] + [None] * (max_stage_rows - len(stage_columns[col_name]))

script_dir = os.path.dirname(os.path.abspath(__file__))
output_path = _output_csv_arg if _output_csv_arg else os.path.join(script_dir, "stage_schedule.csv")

stage_schedule_df = pd.DataFrame(stage_columns)
stage_schedule_df.to_csv(output_path, index=False)

# Sidecar JSON for the interactive schedule editor (schedule_grid.py / schedule_ui.py).
# Purely additive — the CSV above is unchanged and remains the source of truth
# for anyone just wanting the plain schedule.
stage_to_group_name = {}
for group_pos, group in enumerate(effective_parallel_groups):
    name = group_names[group_pos] if group_pos < len(group_names) else f"Group {group_pos + 1}"
    for stage_index in group:
        stage_to_group_name[stage_index] = {"group_index": group_pos, "name": name}

sidecar = {
    "stages": [
        {
            "index": stage_index,
            "name": stage_names[stage_index] if stage_index < len(stage_names) else f"Stage {stage_index + 1}",
            "group_index": stage_to_group_name.get(stage_index, {}).get("group_index"),
        }
        for stage_index in range(len(stage_perms))
    ],
    "groups": [
        {
            "index": group_pos,
            "name": group_names[group_pos] if group_pos < len(group_names) else f"Group {group_pos + 1}",
            "members": group,
        }
        for group_pos, group in enumerate(effective_parallel_groups)
    ],
    "rows": {
        str(stage_index): [
            {
                "time": stage_start_entries[stage_index][i] if i < len(stage_start_entries[stage_index]) else "",
                "text": stage_comp_entries[stage_index][i],
                "duration_seconds": stage_comp_duration[stage_index][i] if i < len(stage_comp_duration[stage_index]) else 0,
                "dance_type": stage_comp_dance[stage_index][i] if i < len(stage_comp_dance[stage_index]) else None,
                "is_hold": stage_comp_entries[stage_index][i] == "HOLD",
                "is_lunch": stage_comp_entries[stage_index][i] == "LUNCH",
            }
            for i in range(len(stage_comp_entries[stage_index]))
        ]
        for stage_index in range(len(stage_perms))
    },
}

sidecar_path = os.path.splitext(output_path)[0] + ".schedule.json"
with open(sidecar_path, "w") as sidecar_file:
    json.dump(sidecar, sidecar_file)

print(f"Stage schedule written to: {output_path}")
print(f"Schedule editor data written to: {sidecar_path}")