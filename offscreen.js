// Runs the Gradient AI-text detector (DeBERTa-v3-large, q4 ONNX) with transformers.js.
// Lives in an offscreen document so the model stays loaded between requests.
import { AutoModelForSequenceClassification, AutoTokenizer, env } from "./vendor/transformers.min.js";

const DETECTOR_REPO = "batmac/gradient-ai-text-detector-onnx";
// Pinned: third-party conversion whose files have changed before.
const DETECTOR_REVISION = "776d0164ba0de631036c70f6a146d68a7cd4ea4e";
const MAX_TOKENS = 512;

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL("vendor/ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("vendor/ort-wasm-simd-threaded.asyncify.wasm")
};

function reportProgress(progress) {
  chrome.runtime.sendMessage({ action: "detectorProgress", progress }).catch(() => {});
}

// Only the .onnx weights are big enough to be worth reporting; the tokenizer files
// would make the bar jump to 100% and back.
function progressReporter() {
  let last = -1;
  return (p) => {
    if (p.status !== "progress" || !p.total || !p.file?.endsWith(".onnx")) return;
    const fraction = Math.floor((p.loaded / p.total) * 100) / 100;
    if (fraction !== last) {
      last = fraction;
      reportProgress(fraction);
    }
  };
}

// navigator.gpu can exist without a usable adapter (headless, blocklisted GPUs), and a
// failed WebGPU session init also breaks a later wasm fallback, so probe first.
async function pickDevice() {
  try {
    return (await navigator.gpu?.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function loadDetector() {
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(DETECTOR_REPO, { revision: DETECTOR_REVISION });
    const device = await pickDevice();
    console.info(`Unslop: loading AI-text detector on ${device}`);
    const model = await AutoModelForSequenceClassification.from_pretrained(DETECTOR_REPO, {
      revision: DETECTOR_REVISION,
      dtype: "q4",
      device,
      progress_callback: progressReporter()
    });
    return { tokenizer, model };
  } finally {
    reportProgress(null);
  }
}

let detector = null;

// The model has a single logit (num_labels = 1), so P(AI) is its sigmoid. The
// text-classification pipeline would softmax it into 1.0 for every input.
async function scoreTexts(texts) {
  detector ??= loadDetector().catch((e) => {
    detector = null;
    throw e;
  });
  const { tokenizer, model } = await detector;
  const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: MAX_TOKENS });
  const { logits } = await model(inputs);
  return logits.tolist().map(([logit]) => 1 / (1 + Math.exp(-logit)));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  if (msg.action === "score") {
    scoreTexts(msg.texts).then(
      (scores) => sendResponse({ scores }),
      (e) => sendResponse({ error: `AI-text detector error: ${e.message}` })
    );
    return true;
  }
});
