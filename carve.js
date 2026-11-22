const byId = (id) => document.getElementById(id);
const workspace = byId("workspace");
const original = byId("original");
const result = byId("result");
const energy = byId("energy");
const size = byId("size");
const target = byId("target");
const status = byId("status");
const showEnergy = byId("show-energy");
const download = byId("download");

const maxDimension = 800;
let worker;
let source;
let loadVersion = 0;
let pendingWidth;
let activeWidth;
let hasEnergy = false;
let dragDepth = 0;

function setTargetLabel() {
  target.value = `${size.value} px`;
}

function drawPixels(canvas, buffer, width, height) {
  canvas.width = width;
  canvas.height = height;
  const data = new ImageData(new Uint8ClampedArray(buffer), width, height);
  canvas.getContext("2d").putImageData(data, 0, 0);
  const fit = Math.min(1, (3 * source.width) / (4 * source.height));
  canvas.style.setProperty("--preview-width", `${100 * fit * width / source.width}%`);
}

function makeWorker() {
  const instance = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  instance.addEventListener("message", ({ data }) => {
    if (worker !== instance) return;
    const width = activeWidth;
    activeWidth = undefined;
    if (data.error) {
      status.textContent = data.error;
    } else {
      if (data.edges) {
        drawPixels(energy, data.edges, source.width, source.height);
        hasEnergy = true;
        showEnergy.disabled = false;
      }
      if (pendingWidth === undefined || pendingWidth === width) {
        pendingWidth = undefined;
        drawPixels(result, data.carved, width, source.height);
        byId("result-size").textContent = `${width} × ${source.height}`;
        download.disabled = false;
        status.textContent = width === source.width ? "Original width" : `${source.width - width} columns removed`;
      }
    }
    runCarve();
  });
  instance.addEventListener("error", () => {
    if (worker !== instance) return;
    activeWidth = undefined;
    pendingWidth = undefined;
    worker.terminate();
    worker = undefined;
    status.textContent = "Could not start the WebAssembly engine. Reload the page and try again.";
  });
  return instance;
}

function runCarve() {
  if (activeWidth !== undefined || pendingWidth === undefined) return;
  activeWidth = pendingWidth;
  pendingWidth = undefined;
  download.disabled = true;
  status.textContent = "Carving image…";
  try {
    worker ??= makeWorker();
    const pixels = source.data.slice();
    worker.postMessage({
      pixels, width: source.width, height: source.height,
      target: activeWidth, includeEnergy: !hasEnergy,
    }, [pixels.buffer]);
  } catch {
    activeWidth = undefined;
    status.textContent = "Could not start the WebAssembly engine.";
  }
}

async function loadImage(url, name, isSample = false) {
  const version = ++loadVersion;
  status.textContent = "Opening image…";
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (version !== loadVersion) return;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);

    // Stop work for the previous source before switching dimensions.
    worker?.terminate();
    worker = undefined;
    activeWidth = undefined;
    hasEnergy = false;
    source = { name, width, height, data: pixels.data };
    drawPixels(original, pixels.data.buffer, width, height);
    result.style.removeProperty("--preview-width");
    byId("source-size").textContent = `${width} × ${height}`;
    byId("result-size").textContent = "";
    byId("credit").hidden = !isSample;
    showEnergy.checked = false;
    showEnergy.disabled = true;
    syncEnergyView();
    size.max = width;
    size.value = Math.max(1, Math.round(width * 0.72));
    size.disabled = width === 1;
    setTargetLabel();
    pendingWidth = Number(size.value);
    runCarve();
    byId("source-size").title = scale < 1 ? `Scaled from ${image.naturalWidth} × ${image.naturalHeight}` : "";
  } catch {
    if (version === loadVersion) status.textContent = "Could not open this image. Try a PNG, JPEG, or WebP.";
  } finally {
    if (!isSample) URL.revokeObjectURL(url);
  }
}

function loadFile(file) {
  if (file) loadImage(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ""));
}

function syncEnergyView() {
  original.hidden = showEnergy.checked;
  energy.hidden = !showEnergy.checked;
  byId("source-title").textContent = showEnergy.checked ? "Energy map" : "Original";
}

function loadSample() {
  return loadImage("./Broadway_tower_edit.jpg", "broadway-tower", true);
}

size.addEventListener("input", setTargetLabel);
size.addEventListener("change", () => {
  pendingWidth = Number(size.value);
  runCarve();
});
showEnergy.addEventListener("change", syncEnergyView);
byId("sample").addEventListener("click", loadSample);
byId("file").addEventListener("change", (event) => {
  loadFile(event.target.files[0]);
  event.target.value = "";
});
window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  workspace.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (dragDepth > 0 && --dragDepth === 0) workspace.classList.remove("dragging");
});
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  workspace.classList.remove("dragging");
  loadFile(event.dataTransfer.files[0]);
});
download.addEventListener("click", () => {
  const filename = `${source.name}-${result.width}px.png`;
  result.toBlob((blob) => {
    if (!blob) {
      status.textContent = "Could not create the PNG.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

loadSample();
