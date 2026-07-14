"""
Feis Schedule Builder — API (v0)
=================================

A thin FastAPI wrapper around the existing, unmodified scheduling scripts:
    schedule_creator.py, trad_set_optimizer.py, stage_number_printer.py

None of that logic is reimplemented here. This file just gives it an HTTP
front door: accept an uploaded CSV + settings, run schedule_creator.py
exactly the way the desktop app did (as a subprocess with the same three
CLI arguments), and hand back the resulting schedule as JSON.

This is a starting point, not the finished thing — it does not yet do
printouts, and the "editable table" is intentionally left to the frontend
to build properly later. Its whole job right now is to prove the pipeline
works end to end over HTTP.

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


@app.post("/api/generate-printouts")
async def generate_printouts(csv_file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "schedule.csv"
        output_dir = tmp_path / "stage_printouts"

        with open(csv_path, "wb") as f:
            shutil.copyfileobj(csv_file.file, f)

        sys.path.insert(0, str(BASE_DIR))
        from stage_number_printer import generate_stage_docs

        try:
            generate_stage_docs(str(csv_path), str(output_dir))
        except Exception as exc:
            raise HTTPException(500, f"Printout generation failed: {exc}")

        docx_files = sorted(output_dir.glob("*.docx"))
        if not docx_files:
            raise HTTPException(500, "No printout files were generated.")

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for docx_path in docx_files:
                zf.write(docx_path, arcname=docx_path.name)
        zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=stage_printouts.zip"},
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
