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


def build_print_order(stage_entries):
    # Drop middle HOLDs, keep LUNCH, reverse order, and force final HOLD page.
    non_hold_entries = [entry for entry in stage_entries if entry.upper() != "HOLD"]
    ordered = list(reversed(non_hold_entries))
    ordered.append("HOLD")
    return ordered


def competition_label_for_page(entry):
    upper = entry.upper()
    if upper in {"HOLD", "LUNCH"}:
        return upper, False

    no_count = re.sub(r"\s*\(\d+\)\s*$", "", entry).strip()
    parts = [part.strip() for part in no_count.split("/") if part.strip()]
    if len(parts) <= 1:
        return no_count, False
    return "\n".join(parts), True


def add_comp_page(document, entry):
    text, is_mixed = competition_label_for_page(entry)
    section = document.sections[0]

    table = document.add_table(rows=1, cols=1)
    table.autofit = False
    row = table.rows[0]
    row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
    # Leave a little room for the paragraph python-docx appends after each table.
    row.height = section.page_height - section.top_margin - section.bottom_margin - PAGE_FOOTER_ALLOWANCE

    cell = table.cell(0, 0)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    paragraph = cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    run = paragraph.add_run(text)
    run.bold = True
    run.font.name = "Arial"
    run.font.size = Pt(105 if is_mixed else 170)


def generate_stage_docs(stage_schedule_csv, output_dir):
    df = pd.read_csv(stage_schedule_csv)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    stage_columns = [
        col
        for col in df.columns
        if re.fullmatch(r"Stage \d+ Comp", str(col).strip(), flags=re.IGNORECASE)
    ]
    if not stage_columns:
        stage_columns = [
            col
            for col in df.columns
            if re.fullmatch(r"Stage \d+", str(col).strip(), flags=re.IGNORECASE)
        ]
    if not stage_columns:
        raise ValueError(
            "No stage columns found. Expected headers like 'Stage 1 Comp' or 'Stage 1'."
        )

    for stage_column in stage_columns:
        entries = parse_stage_entries(df[stage_column].tolist())
        print_order = build_print_order(entries)

        document = Document()
        configure_page_layout(document)

        for page_index, entry in enumerate(print_order):
            add_comp_page(document, entry)

        filename = stage_column.replace(" ", "_").lower() + "_numbers.docx"
        document.save(output_path / filename)


if __name__ == "__main__":
    script_dir = Path(__file__).resolve().parent
    stage_csv = script_dir / "stage_schedule.csv"
    docs_output = script_dir / "stage_printouts"

    if not stage_csv.exists():
        raise FileNotFoundError(f"Could not find stage schedule CSV: {stage_csv}")

    generate_stage_docs(stage_csv, docs_output)