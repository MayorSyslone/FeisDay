# Feis Schedule Builder — web version (v0)

This is the very first slice of the web version: upload a dancer registration
CSV, generate a schedule with the default 4-stage layout, and see the raw
result in a plain table. It reuses `schedule_creator.py`, `trad_set_optimizer.py`,
and `stage_number_printer.py` completely unchanged — the web app just gives
them an HTTP front door.

Not built yet (next steps): a settings UI for stages/levels/times, printouts,
and — the big one — a proper custom editable grid that won't let you break a
parallel group's dance-type sync.

## Folder layout

```
web/
  backend/
    main.py                 <- the API
    requirements.txt
    schedule_creator.py      <- copied straight from the desktop app, untouched
    trad_set_optimizer.py
    stage_number_printer.py
  frontend/
    index.html
    app.js
    style.css
```

## Running it on your laptop

You'll need Python installed (3.10+ is safe). Check with:

```
python3 --version
```

If that fails, install Python from https://www.python.org/downloads/ first.

**1. Open a terminal in the `web/backend` folder.**

**2. Create a virtual environment** (keeps these packages separate from
anything else on your machine):

```
py -m venv venv
```

**3. Activate it:**

- Mac/Linux: `source venv/bin/activate`
- Windows (PowerShell): `venv\Scripts\Activate.ps1`

You'll know it worked if your terminal prompt now starts with `(venv)`.

**4. Install the dependencies:**

```
pip install -r requirements.txt
```

**5. Start the server:**

```
uvicorn main:app --reload
```

You should see something like `Uvicorn running on http://127.0.0.1:8000`.

**6. Open your browser to** `http://127.0.0.1:8000` — you'll see the upload
page. Pick a dancer registration CSV and click "Generate schedule."

Leave the terminal window open while you're using it; `Ctrl+C` stops the
server. Next time, you only need steps 3 and 5 (no need to recreate the
virtual environment or reinstall packages).

## Putting it online for free (Render)

[Render](https://render.com) has a genuine free tier for small web services —
no credit card needed for the basic plan. The trade-off: if nobody uses it for
about 15 minutes, it goes to sleep, and the next request takes 30–60 seconds
to wake it back up. For a tool you use occasionally before a feis, that's a
totally reasonable trade for $0/month.

**1. Put this `web` folder in a GitHub repository.** (If you've never used
Git/GitHub before, say so and I'll walk you through that part separately —
it's a whole thing on its own.)

**2. Create a free Render account** at https://render.com and connect your
GitHub account.

**3. Click "New +" → "Web Service"** and pick your repository.

**4. Set these fields:**
- **Root Directory:** `web/backend`
- **Runtime:** Python 3
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Instance Type:** Free

**5. Click "Create Web Service."** Render will build and deploy it, and give
you a public URL like `https://your-app-name.onrender.com` — that's the whole
app, live, for anyone to use.

Whenever you push new changes to GitHub, Render redeploys automatically.

## What's next

Once you've confirmed this runs on your laptop and (if you want) deployed it,
the next pieces to build are, roughly in order:
1. A proper settings screen (stages, levels, start times, parallel groups) —
   this already exists as logic in `stage_board.py` from the desktop app; it
   just needs a web UI on top of it.
2. The custom editable schedule grid, built so a parallel group's rows can
   only move together — the thing tksheet couldn't do for us.
3. Printouts (wiring up `stage_number_printer.py` and returning a downloadable
   file).
