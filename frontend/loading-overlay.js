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

function showLoadingOverlay(message) {
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
  let progress = 0;
  const cap = 0.92;
  let done = false;

  pickRandomArtworkPath().then((path) => {
    img.src = path;
  });

  img.onload = () => {
    const displayWidth = 360;
    const ratio = displayWidth / img.naturalWidth;
    canvas.width = displayWidth;
    canvas.height = Math.round(img.naturalHeight * ratio);
    tick();
  };

  function render(fraction) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    progress += (cap - progress) * 0.06 + 0.002;
    progress = Math.min(progress, cap);
    render(progress);
    requestAnimationFrame(tick);
  }

  return {
    finish() {
      done = true;
    },
  };
}
