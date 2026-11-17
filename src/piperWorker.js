// web/src/piperWorker.js
//
// In-browser Piper text-to-speech (@mintplex-labs/piper-tts-web, ONNX + WASM
// from jsDelivr), run as a module Web Worker so synthesis never janks the page
// or the player. The voice model (~63 MB, from Hugging Face) is downloaded
// once and kept by the library in the origin's private file system (OPFS).
//
// Protocol (messages to the worker / from it):
//   {type: "init", voiceId}           -> {type: "progress", loaded, total}*,
//                                        {type: "ready"} | {type: "error", message}
//   {type: "predict", id, text}       -> {type: "result", id, blob}
//                                      | {type: "error", id, message}
// Requests are handled one at a time, in order (the caller also serializes).
//
// The same handler runs on the main thread when Workers are unavailable
// (createPiperHandler, used by voiceEngines.js).

export const PIPER_LIB_URL = "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm";
// The onnxruntime-web version the library bundles: its WASM must match.
export const ONNX_WASM_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

/** A message handler `(data) => void` that answers through `post(message)`. */
export function createPiperHandler(post, importLib = () => import(PIPER_LIB_URL)) {
  let session = null;
  let chain = Promise.resolve();

  async function init(voiceId) {
    const tts = await importLib();
    // The library keeps one session per page/worker; reset it to switch voices.
    tts.TtsSession._instance = null;
    session = new tts.TtsSession({
      voiceId,
      progress: (p) => {
        if (p && p.total) post({ type: "progress", loaded: p.loaded, total: p.total });
      },
      logger: () => {},
      wasmPaths: {
        onnxWasm: ONNX_WASM_URL,
        piperData: `${tts.WASM_BASE}.data`,
        piperWasm: `${tts.WASM_BASE}.wasm`,
      },
    });
    await session.waitReady;
  }

  return function handle(data) {
    chain = chain.then(async () => {
      if (data?.type === "init") {
        try {
          await init(data.voiceId);
          post({ type: "ready" });
        } catch (err) {
          session = null;
          post({ type: "error", message: String(err?.message ?? err) });
        }
      } else if (data?.type === "predict") {
        try {
          if (!session) throw new Error("voice not loaded");
          const blob = await session.predict(String(data.text ?? ""));
          post({ type: "result", id: data.id, blob });
        } catch (err) {
          post({ type: "error", id: data.id, message: String(err?.message ?? err) });
        }
      }
    });
    return chain;
  };
}

// Running as a worker: wire the handler to the worker's message port.
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  const handle = createPiperHandler((message) => self.postMessage(message));
  self.onmessage = (event) => handle(event.data);
}
