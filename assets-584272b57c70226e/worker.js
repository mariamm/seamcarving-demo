import createEngine from "./engine.js";

let engine;

self.addEventListener("message", async ({ data }) => {
  const { pixels, width, height, target } = data;
  try {
    const module = await (engine ??= createEngine());
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
      module.HEAPU8.set(pixels, input);
      if (!module._resizeHorizontally(input, output, energy, height, width, target)) {
        throw new Error("The target width is invalid.");
      }

      // Read the current buffer after the call, since Wasm may grow its memory.
      const carved = module.HEAPU8.slice(output, output + outputLength).buffer;
      const edges = module.HEAPU8.slice(energy, energy + pixels.byteLength).buffer;
      self.postMessage({ carved, edges }, [carved, edges]);
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
