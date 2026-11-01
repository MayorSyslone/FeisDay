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

**5. Start the server:-----------------------------------------------------------------

```
uvicorn main:app --reload
```

You should see something like `Uvicorn running on http://127.0.0.1:8000`.

**6. Open your browser to** `http://127.0.0.1:8000` — you'll see the upload
page. Pick a dancer registration CSV and click "Generate schedule."

Leave the terminal window open while you're using it; `Ctrl+C` stops the
server. Next time, you only need steps 3 and 5 (no need to recreate the
virtual environment or reinstall packages).

## Checking it out online (Render)--------------------------------------------------------------

Just put feisday.onrender.com into your search engine! Wait a bit for startup (it goes inactive after an idle period) and then use it on dancer data!

Do keep in mind you must have access to the competitor list CSV from FeisWEB - I still need to add capabilities of running dancer CSV's from other websites, as well as a whole plethora of other capabilities!! But don't worry, once I'm done with college stuff I should be good to go!!!!!!!!!!!!!!!!!!!!!!!!!!!!! :-)
