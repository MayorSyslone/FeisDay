import os
import re
from pathlib import Path

import pandas as pd
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_ALIGN_VERTICAL, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

PAGE_FOOTER_ALLOWANCE = Pt(18)

DEFAULT_PRINTOUT_OPTIONS = {
    "include_stage_name_page": True,
    "include_hold_page": True,
    "include_lunch_page": True,
    "show_dancer_count": True,
    "show_page_numbers": True,
    "reverse_order": True,
}


def configure_page_layout(document):
    section = document.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    section.left_margin = Inches(0.5)
    section.right_margin = Inches(0.5)
    section.top_margin = Inches(0.5)
    section.bottom_margin = Inches(0.5)


def parse_stage_entries(stage_column_values):
    entries = []
    for value in stage_column_values:
        if pd.isna(value):
            continue
        text = str(value).strip()
        if not text:
            continue
        if text.startswith("Total Time:"):
            continue
        entries.append(text)
    return entries


def _strip_all_counts(entry):
    parts = entry.split("/")
    stripped = [re.sub(r"\s*\(\d+\)\s*$", "", part).strip() for part in parts]
    return "/".join(stripped)


def competition_label_for_page(entry, show_dancer_count=True):
    upper = entry.upper()
    if upper in {"HOLD", "LUNCH"}:
        return upper, False

    base = entry if show_dancer_count else _strip_all_counts(entry)
    parts = [part.strip() for part in base.split("/") if part.strip()]
    if len(parts) <= 1:
        return base, False
    return "\n".join(parts), True


def build_print_pages(stage_entries, stage_name="", options=None):
    """Turns a stage's raw schedule entries (chronological order) into a
    list of print-ready pages: [{text, is_mixed, is_hold, page_number,
    total_pages, is_title}, ...].

    Physical stacking note: pages are generated in this list's order, and
    when printed single-sided and stacked normally, whichever page is
    generated LAST ends up on TOP of the stack. So "at the start" (stage
    name, then HOLD, both optional) means those sit at the very START of
    the natural (non-reversed) order -- title page first, then HOLD, then
    the day itself in chronological order. reverse_order simply reverses
    this whole sequence as one unit (title and HOLD included), which is
    what puts them at the end, physically on top of a printed stack, seen
    first when you walk up to the stage before the event begins.

    Page numbers always represent true chronological position (page 1 =
    the first real competition of the day), regardless of reverse_order.
    """
    opts = dict(DEFAULT_PRINTOUT_OPTIONS)
    if options:
        opts.update(options)

    entries = stage_entries
    if not opts["include_lunch_page"]:
        entries = [e for e in entries if e.upper() != "LUNCH"]

    chronological = [e for e in entries if e.upper() != "HOLD"]
    total_pages = len(chronological)

    natural_pages = []

    if opts["include_stage_name_page"]:
        natural_pages.append({
            "text": stage_name or "Stage", "is_mixed": False, "is_hold": True, "is_title": True,
            "page_number": None, "total_pages": total_pages,
        })

    if opts["include_hold_page"]:
        natural_pages.append({
            "text": "HOLD", "is_mixed": False, "is_hold": True, "is_title": False,
            "page_number": None, "total_pages": total_pages,
        })

    for index, entry in enumerate(chronological):
        text, is_mixed = competition_label_for_page(entry, opts["show_dancer_count"])
        natural_pages.append({
            "text": text,
            "is_mixed": is_mixed,
            "is_hold": False,
            "is_title": False,
            "page_number": (index + 1) if opts["show_page_numbers"] else None,
            "total_pages": total_pages,
        })

    return list(reversed(natural_pages)) if opts["reverse_order"] else natural_pages


def add_comp_page(document, page):
    section = document.sections[0]
    available_height = section.page_height - section.top_margin - section.bottom_margin - PAGE_FOOTER_ALLOWANCE

    show_number = page.get("page_number") is not None
    footer_row_height = Pt(30)
    main_row_height = available_height - footer_row_height if show_number else available_height

    table = document.add_table(rows=2 if show_number else 1, cols=1)
    table.autofit = False

    main_row = table.rows[0]
    main_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
    main_row.height = main_row_height

    main_cell = table.cell(0, 0)
    main_cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    paragraph = main_cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    run = paragraph.add_run(page["text"])
    run.bold = True
    run.font.name = "Arial"
    run.font.size = Pt(105 if page["is_mixed"] else 170)

    if show_number:
        # A separate, dedicated row pinned to the bottom of the page --
        # NOT a second paragraph in the main cell, which would just get
        # vertically centered alongside the giant text instead of sitting
        # at the true bottom-right corner of the page itself.
        footer_row = table.rows[1]
        footer_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
        footer_row.height = footer_row_height

        footer_cell = table.cell(1, 0)
        footer_cell.vertical_alignment = WD_ALIGN_VERTICAL.BOTTOM
        footer_paragraph = footer_cell.paragraphs[0]
        footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        footer_run = footer_paragraph.add_run(f"Page {page['page_number']} of {page['total_pages']}")
        footer_run.font.name = "Arial"
        footer_run.font.size = Pt(12)


def _find_stage_comp_columns(df):
    """Returns [(stage_name, comp_column_name), ...]. Works for any stage
    name (not just "Stage N"), since custom names are supported."""
    pairs = []
    for col in df.columns:
        col_str = str(col).strip()
        if col_str.endswith(" Comp"):
            pairs.append((col_str[: -len(" Comp")].strip(), col_str))
    if not pairs:
        # Back-compat: older exports used a bare "Stage N" column with no
        # separate Time/Comp split.
        for col in df.columns:
            col_str = str(col).strip()
            if re.fullmatch(r"Stage \d+", col_str, flags=re.IGNORECASE):
                pairs.append((col_str, col_str))
    return pairs


def generate_stage_docs(stage_schedule_csv, output_dir, options=None):
    df = pd.read_csv(stage_schedule_csv)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    stage_pairs = _find_stage_comp_columns(df)
    if not stage_pairs:
        raise ValueError(
            "No stage columns found. Expected headers like '<Stage Name> Comp'."
        )

    for stage_name, comp_column in stage_pairs:
        # Row 0 of every stage column is always the stage name itself, by
        # construction (schedule_creator.py writes it as a placeholder
        # first row) -- never real schedule data, so it's always skipped.
        entries = parse_stage_entries(df[comp_column].tolist()[1:])
        pages = build_print_pages(entries, stage_name=stage_name, options=options)

        document = Document()
        configure_page_layout(document)

        for page in pages:
            add_comp_page(document, page)

        safe_name = re.sub(r"[^A-Za-z0-9]+", "_", stage_name).strip("_").lower() or "stage"
        filename = f"{safe_name}_numbers.docx"
        document.save(output_path / filename)


def generate_schedule_document(stage_schedule_csv, output_path):
    """A basic, formatted Word version of the master schedule: one table
    per stage (Time | Competition), landscape. Intentionally simple for
    now -- a first working version, not yet configurable."""
    df = pd.read_csv(stage_schedule_csv)
    stage_pairs = []
    for col in df.columns:
        col_str = str(col).strip()
        if col_str.endswith(" Time"):
            stage_name = col_str[: -len(" Time")].strip()
            comp_col = f"{stage_name} Comp"
            if comp_col in df.columns:
                stage_pairs.append((stage_name, col_str, comp_col))

    document = Document()
    configure_page_layout(document)

    for i, (stage_name, time_col, comp_col) in enumerate(stage_pairs):
        if i > 0:
            document.add_page_break()

        heading = document.add_heading(stage_name, level=1)

        table = document.add_table(rows=1, cols=2)
        table.style = "Light Grid Accent 1"
        header_cells = table.rows[0].cells
        header_cells[0].text = "Time"
        header_cells[1].text = "Competition"
        for cell in header_cells:
            for p in cell.paragraphs:
                for r in p.runs:
                    r.bold = True

        for time_value, comp_value in zip(df[time_col].tolist()[1:], df[comp_col].tolist()[1:]):
            if pd.isna(comp_value) or not str(comp_value).strip():
                continue
            row_cells = table.add_row().cells
            row_cells[0].text = "" if pd.isna(time_value) else str(time_value)
            row_cells[1].text = str(comp_value)

    document.save(output_path)


if __name__ == "__main__":
    script_dir = Path(__file__).resolve().parent
    stage_csv = script_dir / "stage_schedule.csv"
    docs_output = script_dir / "stage_printouts"

    if not stage_csv.exists():
        raise FileNotFoundError(f"Could not find stage schedule CSV: {stage_csv}")

    generate_stage_docs(stage_csv, docs_output)
