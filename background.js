const EXAMPLE_SLOP_WORDS = [
  "leverage", "synergy", "seamless", "enterprise", "innovative", "innovation", "cutting-edge",
  "unlock", "empower", "game-changing", "robust", "streamlined", "best-in-class",
  "holistic", "revolutionary", "next-generation", "market-driven"
];

function extractJson(raw) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    return { error: "Could not parse model response", raw };
  }
}

const DETECT_SCHEMA = {
  type: "object",
  properties: {
    ai_likelihood: { type: "number" },
    slop_score: { type: "number" },
    reason: { type: "string" },
    unslopped_title: { type: "string" },
    unslopped_excerpt: { type: "string" }
  },
  required: ["ai_likelihood", "slop_score", "reason", "unslopped_title", "unslopped_excerpt"]
};

const REWRITE_SCHEMA = {
  type: "object",
  properties: {
    rewritten: { type: "array", items: { type: "string" } }
  },
  required: ["rewritten"]
};

async function callLocalLLM(userContent, signal, maxTokens) {
  const { endpoint, model } = await chrome.storage.local.get(["endpoint", "model"]);
  const url = endpoint || "http://localhost:9931/v1/chat/completions";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: model || "local",
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "user", content: userContent }]
      })
    });
  } catch (e) {
    if (e.name === "AbortError") return { error: "Cancelled." };
    return { error: `Could not reach local LLM at ${url}. Is llama-server running? (${e.message})` };
  }

  if (!res.ok) {
    const body = await res.text();
    return { error: `Local LLM error ${res.status}: ${body.slice(0, 200)}` };
  }

  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

async function callChromeAI(userContent, schema, signal) {
  if (typeof LanguageModel === "undefined") {
    return {
      error: "Chrome built-in AI (Gemini Nano) isn't available in this browser. Enable the flag below, restart Chrome, then check chrome://components for 'Optimization Guide On Device Model' and let it download. Not supported in Brave or other Chromium forks that strip Google's on-device model.",
      link: "chrome://flags/#prompt-api-for-chrome-extensions"
    };
  }

  try {
    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      return { error: "Gemini Nano reports unavailable on this device. Check chrome://components for 'Optimization Guide On Device Model' and let it download." };
    }
    if (availability === "downloading" || availability === "downloadable") {
      chrome.storage.local.set({ downloadProgress: 0 });
    }

    const session = await LanguageModel.create({
      signal,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          chrome.storage.local.set({ downloadProgress: e.loaded });
        });
      }
    });
    let raw;
    try {
      raw = await session.prompt(
        `${userContent}\n\nRespond with JSON only, no markdown code fences.`,
        schema ? { responseConstraint: schema, signal } : { signal }
      );
    } finally {
      session.destroy();
    }
    return extractJson(raw);
  } catch (e) {
    if (e.name === "AbortError") return { error: "Cancelled." };
    return { error: `Chrome built-in AI error: ${e.message}` };
  }
}

const controllers = new Map();
const HARD_TIMEOUT_MS = 120000;

async function callLLM(userContent, { schema, tabId, maxTokens } = {}) {
  const { aiBackend } = await chrome.storage.local.get("aiBackend");
  const controller = new AbortController();
  if (tabId != null) controllers.set(tabId, controller);
  const timer = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);
  try {
    const result = (aiBackend || "chrome-ai") === "chrome-ai"
      ? await callChromeAI(userContent, schema, controller.signal)
      : await callLocalLLM(userContent, controller.signal, maxTokens);
    if (result.error === "Cancelled." && controller.signal.reason !== "user") {
      return { error: `Timed out after ${HARD_TIMEOUT_MS / 1000}s with no response.` };
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (tabId != null) controllers.delete(tabId);
  }
}

function detectAI(text, title, tabId) {
  return callLLM(
    `Analyze this article for: (1) likelihood it is AI-generated (0-100), (2) clickbait/marketing-slop score (0-100), (3) a short "unslopped" rewrite of the title and first paragraph in plain, direct language. Respond as JSON with keys ai_likelihood, slop_score, reason, unslopped_title, unslopped_excerpt.\n\nTitle: ${title}\n\nText:\n${text}`,
    { schema: DETECT_SCHEMA, tabId, maxTokens: 2000 }
  );
}

async function aiRewrite(direction, texts, tabId) {
  const instruction = direction === "slopify"
    ? "Rewrite each string to sound like corporate marketing copy and gen Z click bait: ai buzzword-heavy jargon (leverage, synergy, seamless, game-changing, etc), vague and inflated, while keeping roughly the same length and meaning."
    : `You are a skilled human editor. Rewrite each string the way a smart, direct person would actually say it out loud, cutting corporate buzzwords, marketing fluff, and clickbait phrasing entirely. Prioritize natural, human-sounding phrasing over matching the original length or sentence structure - restructure the sentence completely if that reads better.

Example:
Input: "Our enterprise-grade platform empowers teams to seamlessly leverage cutting-edge AI to unlock unprecedented growth."
Output: "Our platform helps teams use AI to grow faster."

Avoid buzzwords and jargon like: ${EXAMPLE_SLOP_WORDS.join(", ")}, and similar vague corporate language. Only say what the original actually says - do not invent your own marketing framing, credibility claims, or hedge phrases (e.g. don't add things like "for serious teams" or "trusted by professionals" if the original didn't say that).`;

  const estimatedTokens = Math.ceil(texts.join("").length / 3) + 800;

  const result = await callLLM(
    `${instruction}\n\nRespond as JSON with key "rewritten": an array of strings, same length and order as the input array, one rewritten string per input string. Do not merge, skip, or reorder entries.\n\nInput array (JSON): ${JSON.stringify(texts)}`,
    { schema: REWRITE_SCHEMA, tabId, maxTokens: Math.min(estimatedTokens, 8000) }
  );

  if (result.error) return result;
  if (!Array.isArray(result.rewritten) || result.rewritten.length !== texts.length) {
    return { error: "The AI backend returned a malformed or mismatched-length array." };
  }
  return result;
}

async function clearTaskForTab(tabId) {
  const { tasks = {} } = await chrome.storage.local.get("tasks");
  if (tasks[tabId]) {
    delete tasks[tabId];
    await chrome.storage.local.set({ tasks });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  controllers.get(tabId)?.abort();
  controllers.delete(tabId);
  clearTaskForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") clearTaskForTab(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "whoami") {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }
  if (msg.action === "detectAI") {
    detectAI(msg.text, msg.title, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg.action === "aiRewrite") {
    aiRewrite(msg.direction, msg.texts, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg.action === "cancelAI") {
    const controller = controllers.get(msg.tabId);
    if (controller) {
      controller.abort("user");
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
    return;
  }
});
