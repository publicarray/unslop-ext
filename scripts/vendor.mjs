// Copies transformers.js and the ONNX Runtime wasm files it loads into vendor/,
// since MV3 extensions can't load remote code.
import { copyFileSync, mkdirSync } from "node:fs";

const FILES = [
  "node_modules/@huggingface/transformers/dist/transformers.min.js",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm"
];

mkdirSync("vendor", { recursive: true });
for (const src of FILES) {
  const dest = `vendor/${src.split("/").pop()}`;
  copyFileSync(src, dest);
  console.log(`${src} -> ${dest}`);
}
