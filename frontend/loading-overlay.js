/**
 * Wipes the dancer artwork in from left to right as a stand-in progress bar
 * while a task runs, completing to 100% the instant the task finishes.
 * Mirrors the desktop app's PIL-based loading overlay, using a canvas here.
 */

const DEFAULT_ARTWORK_PATH = "loading-artwork/loading_artwork.png";

async function pickRandomArtworkPath() {
  try {
    const response = await fetch("/api/loading-artworks");
    if (!response.ok) throw new Error("bad response");
    const data = await response.json();
    if (data.files && data.files.length) {
      const choice = data.files[Math.floor(Math.random() * data.files.length)];
      return `loading-artwork/${choice}`;
    }
  } catch (err) {
    // fall through to the default below
  }
  return DEFAULT_ARTWORK_PATH;
}

function showLoadingOverlay(message, estimatedSeconds = 10) {
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";

  const box = document.createElement("div");
  box.className = "loading-box";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  box.appendChild(canvas);

  const caption = document.createElement("div");
  caption.className = "loading-caption";
  caption.textContent = `${message}…`;
  box.appendChild(caption);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const img = new Image();
  const cap = 0.94;
  let done = false;
  let imgReady = false;
  const startTime = performance.now();

  // Give the canvas a sensible size immediately so the box isn't 0x0 while
  // the image is still loading (its natural size isn't known yet).
  canvas.width = 360;
  canvas.height = 280;

  pickRandomArtworkPath().then((path) => {
    img.src = path;
  });

  img.onload = () => {
    const displayWidth = 360;
    const ratio = displayWidth / img.naturalWidth;
    canvas.width = displayWidth;
    canvas.height = Math.round(img.naturalHeight * ratio);
    imgReady = true;
  };

  function render(fraction) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!imgReady) return; // nothing to reveal yet — plain white box until the image is ready
    const revealedWidth = Math.max(1, Math.floor(canvas.width * fraction));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, revealedWidth, canvas.height);
    ctx.clip();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function tick() {
    if (done) {
      render(1);
      caption.textContent = "Done";
      setTimeout(() => overlay.remove(), 250);
      return;
    }
    // Ramp based on elapsed time vs. a rough estimate of how long this kind
    // of operation actually takes, eased so it doesn't feel like it slams
    // to a stop right at the cap. If the real operation runs long, this
    // just holds steady at the cap until finish() actually fires — but for
    // anything close to the estimate, the fill now tracks real elapsed
    // time instead of always rushing to ~92% in the first couple seconds
    // regardless of how long the task actually takes.
    const elapsedSeconds = (performance.now() - startTime) / 1000;
    const linear = Math.min(elapsedSeconds / estimatedSeconds, 1);
    const eased = 1 - Math.pow(1 - linear, 2);
    render(Math.min(eased * cap, cap));
    requestAnimationFrame(tick);
  }

  // Start immediately — don't wait on the image, which may still be loading
  // (especially the very first time, before the browser has it cached).
  tick();

  return {
    finish() {
      done = true;
    },
  };
}
