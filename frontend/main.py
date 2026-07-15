"""
Feis Schedule Builder — API
============================

A thin FastAPI wrapper around the existing, unmodified scheduling scripts:
    schedule_creator.py, trad_set_optimizer.py, stage_number_printer.py

None of that logic is reimplemented here. This file just gives it an HTTP
front door: accept an uploaded CSV + settings, run schedule_creator.py
exactly the way the desktop app did (as a subprocess with the same three
CLI arguments), and hand back the resulting schedule as JSON. Export bundles
the current (possibly hand-edited) schedule CSV, a formatted schedule
document, and the stage number printouts into a single downloadable zip.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload
Then open http://127.0.0.1:8000 in a browser.
"""

import io
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
SCHEDULE_CREATOR_PATH = BASE_DIR / "schedule_creator.py"

app = FastAPI(title="Feis Schedule Builder API")

# Wide open for now since this is a small personal tool with no accounts/auth yet.
# Tighten this (specific origins) before sharing the URL widely.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/generate-schedule")
async def generate_schedule(csv_file: UploadFile = File(...), settings: str = Form(...)):
    try:
        config = json.loads(settings)
    except json.JSONDecodeError:
        raise HTTPException(400, "settings must be valid JSON")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_csv_path = tmp_path / "input.csv"
        output_csv_path = tmp_path / "schedule.csv"
        config_path = tmp_path / "config.json"

        with open(input_csv_path, "wb") as f:
            shutil.copyfileobj(csv_file.file, f)
        with open(config_path, "w") as f:
            json.dump(config, f)

        result = subprocess.run(
            [sys.executable, str(SCHEDULE_CREATOR_PATH),
             str(input_csv_path), str(output_csv_path), str(config_path)],
            capture_output=True, text=True,
        )

        if result.returncode != 0:
            raise HTTPException(
                500, result.stderr.strip() or "Schedule generation failed — check the CSV format."
            )

        # schedule_creator.py writes this next to the CSV via
        # os.path.splitext(output_path)[0] + ".schedule.json"
        sidecar_path = output_csv_path.parent / (output_csv_path.stem + ".schedule.json")
        with open(sidecar_path) as f:
            schedule_data = json.load(f)

    return schedule_data


@app.post("/api/export")
async def export_everything(csv_file: UploadFile = File(...), printout_options: str = Form("{}")):
    try:
        options = json.loads(printout_options) if printout_options else {}
    except json.JSONDecodeError:
        raise HTTPException(400, "printout_options must be valid JSON")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "stage_schedule.csv"
        schedule_doc_path = tmp_path / "stage_schedule.docx"
        printouts_dir = tmp_path / "stage_printouts"

        with open(csv_path, "wb") as f:
            shutil.copyfileobj(csv_file.file, f)

        sys.path.insert(0, str(BASE_DIR))
        from stage_number_printer import generate_stage_docs, generate_schedule_document

        try:
            generate_schedule_document(str(csv_path), str(schedule_doc_path))
            generate_stage_docs(str(csv_path), str(printouts_dir), options=options)
        except Exception as exc:
            raise HTTPException(500, f"Export failed: {exc}")

        docx_files = sorted(printouts_dir.glob("*.docx"))

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(csv_path, arcname="stage_schedule.csv")
            if schedule_doc_path.exists():
                zf.write(schedule_doc_path, arcname="stage_schedule.docx")
            for docx_path in docx_files:
                zf.write(docx_path, arcname=f"stage_printouts/{docx_path.name}")
        zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=feis_schedule_export.zip"},
    )


@app.get("/api/loading-artworks")
async def list_loading_artworks():
    artwork_dir = FRONTEND_DIR / "loading-artwork"
    if not artwork_dir.exists():
        return {"files": []}
    files = sorted(p.name for p in artwork_dir.glob("*.png"))
    return {"files": files}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serves index.html/app.js/style.css from ../frontend at the site root.
# Keep this mount LAST — routes above take priority; anything not matched
# above falls through to the static files.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
