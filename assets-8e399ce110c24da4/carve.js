const byId = (id) => document.getElementById(id);
const workspace = byId("workspace");
const original = byId("original");
const result = byId("result");
const energy = byId("energy");
const dimensions = ["width", "height"];
const status = byId("status");
const showEnergy = byId("show-energy");
const download = byId("download");

const paintMask = byId("paint-mask");
const clearMask = byId("clear-mask");
const maskCanvas = document.createElement("canvas");
const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
let painting = false;
let stroke;
let hasMask = false;

const maxDimension = 800;
let worker;
let source;
let loadVersion = 0;
let pendingCarve;
let activeCarve;
let carveTimeout;
let dragDepth = 0;

function setTargetLabel(dimension) {
  byId(`${dimension}-value`).value = `${byId(dimension).value} px`;
}

function drawPixels(canvas, buffer, width, height) {
  canvas.width = width;
  canvas.height = height;
  const data = new ImageData(new Uint8ClampedArray(buffer), width, height);
  canvas.getContext("2d").putImageData(data, 0, 0);
  const fit = Math.min(1, (3 * source.width) / (4 * source.height));
  canvas.style.setProperty("--preview-width", `${100 * fit * width / source.width}%`);
}

function stopWorker() {
  clearTimeout(carveTimeout);
  worker?.terminate();
  worker = undefined;
  activeCarve = undefined;
}

function makeWorker() {
  const instance = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  instance.addEventListener("message", ({ data }) => {
    if (worker !== instance) return;
    clearTimeout(carveTimeout);
    const job = activeCarve;
    activeCarve = undefined;
    if (data.error) {
      status.textContent = data.error;
    } else {
      if (pendingCarve === undefined) {
        const { targetWidth: width, targetHeight: height } = job;
        drawPixels(energy, data.edges, source.width, source.height);
        showEnergy.disabled = false;
        drawPixels(result, data.carved, width, height);
        byId("result-size").textContent = `${width} × ${height}`;
        download.disabled = false;
        const removed = [
          width < source.width && `${source.width - width} columns`,
          height < source.height && `${source.height - height} rows`,
        ].filter(Boolean).join(" and ");
        status.textContent = removed ? `${removed} removed` : "Original dimensions";
      }
    }
    runCarve();
  });
  instance.addEventListener("error", () => {
    if (worker !== instance) return;
    stopWorker();
    pendingCarve = undefined;
    status.textContent = "Could not start the WebAssembly engine. Reload the page and try again.";
  });
  return instance;
}

function runCarve() {
  if (activeCarve !== undefined || pendingCarve === undefined) return;
  activeCarve = pendingCarve;
  pendingCarve = undefined;
  download.disabled = true;
  status.textContent = "Carving image…";
  try {
    worker ??= makeWorker();
    const pixels = source.data.slice();
    const mask = hasMask ? readMask() : null;
    const transfer = mask ? [pixels.buffer, mask.buffer] : [pixels.buffer];
    worker.postMessage({
      pixels, width: source.width, height: source.height,
      ...activeCarve, mask,
    }, transfer);
    carveTimeout = setTimeout(() => {
      stopWorker();
      status.textContent = "Carving timed out. Change the target size or reload the image to try again.";
      runCarve();
    }, 20000);
  } catch {
    stopWorker();
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
    stopWorker();
    source = { name, width, height, data: pixels.data };
    maskCanvas.width = width;
    maskCanvas.height = height;
    stroke = undefined;
    hasMask = false;
    clearMask.disabled = true;
    paintMask.disabled = false;
    setPainting(false);
    drawPixels(original, pixels.data.buffer, width, height);
    result.style.removeProperty("--preview-width");
    byId("source-size").textContent = `${width} × ${height}`;
    byId("result-size").textContent = "";
    byId("credit").hidden = !isSample;
    showEnergy.checked = false;
    showEnergy.disabled = true;
    syncEnergyView();
    resetTarget();
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
  byId("seam-key").hidden = !showEnergy.checked;
  byId("source-title").textContent = showEnergy.checked ? "Energy map" : "Original";
}

function loadSample() {
  return loadImage("./Broadway_tower_edit.jpg", "broadway-tower", true);
}

function requestCarve() {
  if (!source) return;
  pendingCarve = {
    targetWidth: Number(byId("width").value),
    targetHeight: Number(byId("height").value),
  };
  runCarve();
}

function resetTarget() {
  if (!source) return;
  for (const dimension of dimensions) {
    const slider = byId(dimension);
    slider.max = source[dimension];
    slider.value = dimension === "width"
      ? Math.max(1, Math.round(source.width * 0.72))
      : source.height;
    slider.disabled = source[dimension] === 1;
    setTargetLabel(dimension);
  }
  requestCarve();
}

function readMask() {
  const rgba = maskContext.getImageData(0, 0, source.width, source.height).data;
  const mask = new Uint8Array(source.width * source.height);
  for (let i = 0; i < mask.length; ++i) mask[i] = rgba[i * 4 + 3];
  return mask;
}

function renderMask() {
  const ctx = original.getContext("2d");
  ctx.putImageData(new ImageData(source.data, source.width, source.height), 0, 0);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalAlpha = 1;
}

function setPainting(enabled) {
  painting = enabled;
  paintMask.setAttribute("aria-pressed", enabled);
  byId("mask-hint").hidden = !enabled;
  original.classList.toggle("painting", enabled);
  if (enabled) {
    showEnergy.checked = false;
    syncEnergyView();
  }
}

function paint(event) {
  const bounds = original.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * source.width / bounds.width;
  const y = (event.clientY - bounds.top) * source.height / bounds.height;
  const radius = Math.max(1, 12 * source.width / bounds.width);
  maskContext.fillStyle = maskContext.strokeStyle = "#38e5b5";
  maskContext.lineWidth = 2 * radius;
  maskContext.lineCap = "round";
  maskContext.beginPath();
  if (stroke.x === undefined) {
    maskContext.arc(x, y, radius, 0, 2 * Math.PI);
    maskContext.fill();
  } else {
    maskContext.moveTo(stroke.x, stroke.y);
    maskContext.lineTo(x, y);
    maskContext.stroke();
  }
  Object.assign(stroke, { x, y });
  hasMask = true;
  clearMask.disabled = false;
  renderMask();
}

function finishStroke(event) {
  if (stroke?.id !== event.pointerId) return;
  stroke = undefined;
  requestCarve();
}

for (const dimension of dimensions) {
  const slider = byId(dimension);
  slider.addEventListener("input", () => setTargetLabel(dimension));
  slider.addEventListener("change", requestCarve);
}
paintMask.addEventListener("click", () => setPainting(!painting));
clearMask.addEventListener("click", () => {
  maskContext.clearRect(0, 0, source.width, source.height);
  hasMask = false;
  clearMask.disabled = true;
  renderMask();
  requestCarve();
});
original.addEventListener("pointerdown", (event) => {
  if (!painting || stroke || event.button !== 0) return;
  original.setPointerCapture(event.pointerId);
  stroke = { id: event.pointerId };
  paint(event);
});
original.addEventListener("pointermove", (event) => {
  if (stroke?.id === event.pointerId) paint(event);
});
original.addEventListener("pointerup", finishStroke);
original.addEventListener("pointercancel", finishStroke);
original.addEventListener("lostpointercapture", finishStroke);
showEnergy.addEventListener("change", () => {
  if (showEnergy.checked) setPainting(false);
  syncEnergyView();
});
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
  const filename = `${source.name}-${result.width}x${result.height}.png`;
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
