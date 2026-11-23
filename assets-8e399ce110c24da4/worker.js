import createEngine from "./engine.js";

let engine;

function transpose(bytes, width, height, channels) {
  const result = new Uint8Array(bytes.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * channels;
      const to = (x * height + y) * channels;
      for (let c = 0; c < channels; c++) result[to + c] = bytes[from + c];
    }
  }
  return result;
}

function carveWidth(module, pixels, width, height, target, mask) {
  const outputLength = target * height * 4;
  const pointers = [];
  try {
    const allocate = (length) => {
      const pointer = module._malloc(length);
      if (!pointer) throw new Error("Could not allocate image buffers.");
      pointers.push(pointer);
      return pointer;
    };
    const input = allocate(pixels.byteLength);
    const output = allocate(outputLength);
    const energy = allocate(pixels.byteLength);
    const protection = mask ? allocate(mask.byteLength) : 0;
    module.HEAPU8.set(pixels, input);
    if (mask) module.HEAPU8.set(mask, protection);
    if (!module._resizeHorizontally(input, output, energy, height, width, target, protection)) {
      throw new Error("The target size is invalid.");
    }
    // Read the current buffer after the call, since Wasm may grow its memory.
    return {
      carved: module.HEAPU8.slice(output, output + outputLength),
      edges: module.HEAPU8.slice(energy, energy + pixels.byteLength),
    };
  } finally {
    for (const pointer of pointers) module._free(pointer);
  }
}

function carveHeight(module, pixels, width, height, target, mask) {
  const { carved, edges } = carveWidth(module,
    transpose(pixels, width, height, 4), height, width, target,
    mask ? transpose(mask, width, height, 1) : null);
  return {
    carved: transpose(carved, target, width, 4),
    edges: transpose(edges, height, width, 4),
  };
}

function isRemoved(edges, pixel) {
  const offset = pixel * 4;
  return edges[offset] === 255 && edges[offset + 1] === 0 && edges[offset + 2] === 0;
}

function carve(module, { pixels, width, height, targetWidth, targetHeight, mask }) {
  if (targetWidth === width && targetHeight < height) {
    const vertical = carveHeight(module, pixels, width, height, targetHeight, mask);
    for (let i = 0; i < width * height; i++) {
      if (isRemoved(vertical.edges, i)) vertical.edges[i * 4 + 2] = 255;
    }
    return vertical;
  }
  const horizontal = carveWidth(module, pixels, width, height, targetWidth, mask);
  if (targetHeight === height) return horizontal;

  // The width pass preserves each row's pixel order. Its red overlay identifies
  // which original pixels were skipped, so we can carry the mask into pass two.
  const survivors = new Uint32Array(targetWidth * height);
  const compactMask = mask ? new Uint8Array(survivors.length) : null;
  let next = 0;
  for (let i = 0; i < width * height; i++) {
    if (isRemoved(horizontal.edges, i)) continue;
    survivors[next] = i;
    if (compactMask) compactMask[next] = mask[i];
    next++;
  }

  const vertical = carveHeight(module, horizontal.carved, targetWidth, height, targetHeight, compactMask);
  for (let i = 0; i < survivors.length; i++) {
    if (isRemoved(vertical.edges, i)) {
      horizontal.edges.set([255, 0, 255, 255], survivors[i] * 4);
    }
  }
  return { carved: vertical.carved, edges: horizontal.edges };
}

self.addEventListener("message", async ({ data }) => {
  try {
    const module = await (engine ??= createEngine());
    const { carved, edges } = carve(module, data);
    self.postMessage({ carved: carved.buffer, edges: edges.buffer }, [carved.buffer, edges.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
