# Unslop

A browser extension that slopifies or unslops marketing/clickbait text on any page, and detects likely AI-generated or clickbait articles.

## Features

- **Word-swap** — instant, offline slopify/unslop using a curated plain-English ↔ corporate-jargon dictionary.
- **AI rewrite** — slower, higher-quality rewrite using either Chrome's built-in on-device AI (Gemini Nano) or a local OpenAI-compatible server (e.g. [llama-server](https://github.com/ggml-org/llama.cpp)). Shows exactly which words changed on hover, color-coded by whether the dictionary or the AI made the change.
- **Flag corporate jargon** — highlights (or fades) buzzwords on the page without rewriting anything
- **Check if AI/clickbait** — scores a page's AI-generation likelihood and clickbait/marketing-slop level, with a short "unslopped" preview of the title and opening text.
- **Highlight AI-written paragraphs** — runs the [Gradient AI-text detector](https://huggingface.co/ShantanuT01/gradient-ai-text-detector) (DeBERTa-v3-large, [q4 ONNX build](https://huggingface.co/batmac/gradient-ai-text-detector-onnx)) locally in the browser and tints each paragraph by its P(AI) score. The ~400 MB model downloads from Hugging Face on first use and is cached; page text never leaves your machine. Scores are not calibrated, so don't use them as proof. Chromium only for now (needs the offscreen documents API).

## Installing

1. Clone or download this repo.
2. Run `npm ci --ignore-scripts && npm run vendor` to copy transformers.js and the ONNX Runtime wasm files into `vendor/` (needed for AI-text highlighting; MV3 extensions can't load remote code).
3. Open `chrome://extensions` (or the equivalent in your Chromium-based browser).
4. Enable "Developer mode".
5. Click "Load unpacked" and select this folder.

For Firefox, load it as a temporary add-on via `about:debugging#/runtime/this-firefox`, or install a build from the Releases page (see [`.github/workflows/build.yml`](.github/workflows/build.yml) for how per-browser bundles are produced).

## AI backend setup

Open the extension's Settings page to choose a backend:

- **Chrome built-in AI** (default) — requires `chrome://flags/#prompt-api-for-chrome-extensions` enabled and the on-device model downloaded via `chrome://components` ("Optimization Guide On Device Model"). Not available in Brave or other Chromium forks that strip Google's on-device model.
- **llama-server** — point it at any local OpenAI-compatible `/v1/chat/completions` endpoint. Tested model and flags:

  ```
  llama-server --port 9931 -ngl 99 -c 8192 -hf unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M
  ```

## Credits

The corporate-jargon detection list in [`buzzwords.js`](buzzwords.js) is adapted from [**bullshit.js**](https://github.com/mourner/bullshit.js) by [Volodymyr Agafonkin](https://github.com/mourner) (MIT License) — a bookmarklet that flags buzzword-heavy text on any page. Several entries in [`wordlist.js`](wordlist.js) Thank you to the bullshit.js project and its contributors for the excellent, term list this extension builds on.
