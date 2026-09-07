const MARK_CLASS = "unslop-marked";
const SWAP_CLASS = "unslop-swap-word";
const AI_CLASS = "unslop-ai-word";

function injectMarkStyle() {
  if (document.getElementById("unslop-style")) return;
  const style = document.createElement("style");
  style.id = "unslop-style";
  style.textContent =
    `.${MARK_CLASS} { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }\n` +
    `.${SWAP_CLASS}.${MARK_CLASS} { text-decoration-color: #3b82f6; }\n` +
    `.${AI_CLASS}.${MARK_CLASS} { text-decoration-color: #a855f7; }`;
  document.head.appendChild(style);
}

async function hoverEnabled() {
  const { showOriginalOnHover } = await chrome.storage.local.get("showOriginalOnHover");
  return showOriginalOnHover !== false;
}

function refreshAllMarks(enabled) {
  document.querySelectorAll("[data-unslop-original]").forEach((el) => {
    if (enabled) {
      injectMarkStyle();
      el.classList.add(MARK_CLASS);
      el.title = el.dataset.unslopOriginal;
    } else {
      el.classList.remove(MARK_CLASS);
      el.removeAttribute("title");
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.showOriginalOnHover) {
    refreshAllMarks(changes.showOriginalOnHover.newValue !== false);
  }
});

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement && node.parentElement.tagName;
      if (!tag || tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function matchCase(sample, replacement) {
  if (sample === sample.toUpperCase()) return replacement.toUpperCase();
  if (sample[0] === sample[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function buildPairs(direction) {
  const pairs = direction === "slopify"
    ? SLOP_PAIRS.map(([plain, slop]) => [plain, slop])
    : SLOP_PAIRS.map(([plain, slop]) => [slop, plain]).concat(GENERALIZED_UNSLOP_PATTERNS);
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

function buildSwapRegex(pairs) {
  // `from` is a regex fragment (as buzzwords.js already does), not an escaped literal -
  // this lets an entry match multiple word forms, e.g. "innovat(e|ion|ive|ing|or)s?".
  const alt = pairs.map(([from]) => from).join("|");
  return new RegExp(`\\b(?:${alt})\\b`, "gi");
}

function buildSwapMatchers(pairs) {
  // Each pair's own regex is tested individually against the matched text to resolve
  // which "to" replacement applies, since a combined alternation regex only tells us
  // *that* something matched, not *which* pair matched it.
  return pairs.map(([from, to]) => ({ re: new RegExp(`^(?:${from})$`, "i"), to }));
}

function resolveReplacement(matchers, matchedText) {
  for (const { re, to } of matchers) {
    if (re.test(matchedText)) return typeof to === "function" ? to(matchedText) : to;
  }
  return null;
}

function buildSafeCleanupPairs() {
  // Only a single matched WORD is safe to force-replace in an arbitrary AI-generated
  // sentence - it drops into the same grammatical slot regardless of how long the
  // replacement is. Multi-word matched PHRASES (e.g. "market-driven" -> "based on
  // what sells") often don't fit the surrounding sentence structure and produce
  // nonsense, so those are left to the AI's own judgment instead of being
  // force-substituted here.
  return buildPairs("unslopify").filter(([from]) => !from.includes(" "));
}

function stripSlopSegments(text) {
  const pairs = buildSafeCleanupPairs();
  const matchers = buildSwapMatchers(pairs);
  const regex = buildSwapRegex(pairs);
  const segments = [];
  let lastIndex = 0;
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text))) {
    const replacement = resolveReplacement(matchers, match[0]);
    if (replacement == null) {
      regex.lastIndex = match.index + 1;
      continue;
    }
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), dict: false });
    segments.push({ text: matchCase(match[0], replacement), dict: true });
    lastIndex = regex.lastIndex;
    if (regex.lastIndex === match.index) regex.lastIndex++;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), dict: false });
  return segments;
}

function tokenizeWithSource(segments) {
  const tokens = [];
  const dictFlags = [];
  for (const seg of segments) {
    for (const t of tokenize(seg.text)) {
      tokens.push(t);
      dictFlags.push(seg.dict);
    }
  }
  return { tokens, dictFlags };
}

function resetWordSwaps() {
  document.querySelectorAll(`span.${SWAP_CLASS}`).forEach((span) => {
    span.replaceWith(document.createTextNode(span.dataset.unslopOriginal));
  });
}

async function applyDirection(direction) {
  resetWordSwaps();
  if (direction === "reset") return;

  const pairs = buildPairs(direction);
  const matchers = buildSwapMatchers(pairs);
  const regex = buildSwapRegex(pairs);
  const enabled = await hoverEnabled();

  for (const node of textNodes(document.body)) {
    const text = node.nodeValue;
    regex.lastIndex = 0;
    let match;
    let lastIndex = 0;
    let any = false;
    const frag = document.createDocumentFragment();
    while ((match = regex.exec(text))) {
      const original = match[0];
      const to = resolveReplacement(matchers, original);
      if (to == null) {
        regex.lastIndex = match.index + 1;
        continue;
      }
      any = true;
      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const replacement = matchCase(original, to);
      const span = document.createElement("span");
      span.className = SWAP_CLASS;
      span.dataset.unslopOriginal = original;
      if (enabled) {
        injectMarkStyle();
        span.classList.add(MARK_CLASS);
        span.title = original;
      }
      span.textContent = replacement;
      frag.appendChild(span);
      lastIndex = regex.lastIndex;
    }
    if (!any) continue;
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(frag);
  }
}

function injectBuzzwordStyle() {
  if (document.getElementById("unslop-buzzword-style")) return;
  const style = document.createElement("style");
  style.id = "unslop-buzzword-style";
  style.textContent =
    ".unslop-buzzword-fade { opacity: 0.35; }\n" +
    ".unslop-buzzword-highlight { background: #fff3a0; color: #000; border-radius: 2px; padding: 0 1px; }\n" +
    ".unslop-buzzword-replace { color: #c00; font-weight: 600; }";
  document.head.appendChild(style);
}

function buildBuzzwordRegex() {
  return new RegExp(`\\b(?:${BUZZWORD_TERMS.join("|")})\\b`, "gi");
}

// Ported from github.com/mourner/bullshit.js's revealBullshit() (MIT License,
// Copyright (c) 2019 Vladimir Agafonkin) - conjugates "bullshit" to roughly match
// the matched word's tense/plurality (bullshitting/bullshits/bullshitted/etc).
function bullshitify(text) {
  const c = text.charAt(0);
  const last = text.length - 1;
  let word = `${c === c.toUpperCase() ? "B" : "b"}ullshit`;

  if (text.substr(last - 2) === "ing") {
    word += "ting";
  } else if (text.charAt(last - 1) !== "s" && text.charAt(last) === "s") {
    word += "s";
  } else if (text.charAt(last - 2) !== "e" && text.substr(last - 1) === "ed") {
    word += "ted";
  } else if (text.charAt(last - 2) !== "o" && text.charAt(last - 2) !== "e" && text.substr(last - 1) === "or") {
    word += "ter";
  } else if (text.charAt(last - 2) !== "o" && text.charAt(last - 2) !== "e" && text.substr(last - 1) === "er") {
    word += "ter";
  } else if (text.charAt(last - 3) !== "o" && text.charAt(last - 3) !== "e" && text.substr(last - 2) === "ors") {
    word += "ters";
  } else if (text.charAt(last - 3) !== "o" && text.charAt(last - 3) !== "e" && text.substr(last - 2) === "ers") {
    word += "ters";
  }
  return word;
}

function resetBuzzwordHighlights() {
  document.querySelectorAll("span.unslop-buzzword").forEach((span) => {
    span.replaceWith(document.createTextNode(span.dataset.unslopOriginal ?? span.textContent));
  });
}

function jargonIsFlagged() {
  return !!document.querySelector("span.unslop-buzzword");
}

async function toggleBuzzwordHighlights() {
  if (jargonIsFlagged()) {
    resetBuzzwordHighlights();
    return { ok: true, active: false, count: 0 };
  }

  const { buzzwordStyle } = await chrome.storage.local.get("buzzwordStyle");
  const style = buzzwordStyle || "highlight";
  const enabled = await hoverEnabled();
  injectBuzzwordStyle();
  const regex = buildBuzzwordRegex();
  let count = 0;

  for (const node of textNodes(document.body)) {
    const text = node.nodeValue;
    regex.lastIndex = 0;
    let match;
    let lastIndex = 0;
    let any = false;
    const frag = document.createDocumentFragment();
    while ((match = regex.exec(text))) {
      any = true;
      count++;
      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const span = document.createElement("span");
      span.className = `unslop-buzzword unslop-buzzword-${style}`;
      if (style === "replace") {
        span.dataset.unslopOriginal = match[0];
        span.textContent = matchCase(match[0], bullshitify(match[0]));
        if (enabled) {
          injectMarkStyle();
          span.classList.add(MARK_CLASS);
          span.title = match[0];
        }
      } else {
        span.textContent = match[0];
      }
      frag.appendChild(span);
      lastIndex = regex.lastIndex;
      if (regex.lastIndex === match.index) regex.lastIndex++;
    }
    if (!any) continue;
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(frag);
  }
  return { ok: true, active: true, count };
}

function pageText() {
  return document.body.innerText.slice(0, 8000);
}

function aiBlocks() {
  return Array.from(document.querySelectorAll("p, h1, h2, h3, h4, li, blockquote"))
    .filter((el) => {
      const len = el.innerText.trim().length;
      return len > 15 && len < 2000;
    })
    .slice(0, 40);
}

let myTabId = null;

async function getTabId() {
  if (myTabId == null) {
    const res = await chrome.runtime.sendMessage({ action: "whoami" });
    myTabId = res.tabId;
  }
  return myTabId;
}

async function setTaskForTab(tabId, taskEntry) {
  const { tasks = {} } = await chrome.storage.local.get("tasks");
  tasks[tabId] = taskEntry;
  await chrome.storage.local.set({ tasks, downloadProgress: null });
}

async function trackTask(kind, label, fn) {
  let tabId;
  try {
    tabId = await getTabId();
  } catch (e) {
    return { error: `Could not reach the extension background page: ${e.message}. Try reloading the extension.` };
  }
  await setTaskForTab(tabId, { kind, label, startTime: Date.now(), status: "running" });
  let result;
  try {
    result = await fn();
  } catch (e) {
    result = { error: e.message };
  }
  await setTaskForTab(tabId, { kind, label, startTime: Date.now(), status: result.error ? "error" : "done", result });
  return result;
}

function tokenize(text) {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

function diffTokens(a, b, bMeta) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", value: b[j], dict: bMeta && bMeta[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", value: a[i] });
      i++;
    } else {
      ops.push({ type: "insert", value: b[j], dict: bMeta && bMeta[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: "delete", value: a[i] }); i++; }
  while (j < m) { ops.push({ type: "insert", value: b[j], dict: bMeta && bMeta[j] }); j++; }
  return ops;
}

function buildDiffFragment(ops, enabled) {
  const frag = document.createDocumentFragment();
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      frag.appendChild(document.createTextNode(ops[i].value));
      i++;
      continue;
    }
    let delText = "", insText = "";
    let isDictChange = false;
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") {
        delText += ops[i].value;
      } else {
        insText += ops[i].value;
        if (ops[i].dict) isDictChange = true;
      }
      i++;
    }
    if (insText.trim()) {
      const span = document.createElement("span");
      const original = delText.trim() || "(added)";
      span.className = isDictChange ? SWAP_CLASS : AI_CLASS;
      span.dataset.unslopOriginal = original;
      if (enabled) {
        injectMarkStyle();
        span.classList.add(MARK_CLASS);
        span.title = original;
      }
      span.textContent = insText;
      frag.appendChild(span);
    } else if (insText) {
      frag.appendChild(document.createTextNode(insText));
    }
  }
  return frag;
}

async function doAiRewrite(direction) {
  const blocks = aiBlocks();
  if (!blocks.length) return { error: "No text blocks found on this page." };

  const texts = blocks.map((el) => el.dataset.unslopOriginal ?? el.innerText);

  const res = await chrome.runtime.sendMessage({ action: "aiRewrite", direction, texts });
  if (res.error) return res;

  const enabled = await hoverEnabled();
  let count = 0;
  res.rewritten.forEach((rawText, i) => {
    if (typeof rawText !== "string" || !rawText.trim()) return;
    const segments = direction === "unslopify" ? stripSlopSegments(rawText) : [{ text: rawText, dict: false }];
    const { tokens: newTokens, dictFlags } = tokenizeWithSource(segments);
    const original = texts[i];
    const ops = diffTokens(tokenize(original), newTokens, dictFlags);
    const frag = buildDiffFragment(ops, enabled);
    blocks[i].textContent = "";
    blocks[i].appendChild(frag);
    blocks[i].dataset.unslopOriginal = original;
    count++;
  });
  return { ok: true, count };
}

async function detect() {
  return trackTask("detect", "Checking...", () =>
    chrome.runtime.sendMessage({ action: "detectAI", text: pageText(), title: document.title })
  );
}

function resetAiRewrites() {
  aiBlocks().forEach((el) => {
    if (el.dataset.unslopOriginal != null) {
      el.innerText = el.dataset.unslopOriginal;
      delete el.dataset.unslopOriginal;
    }
  });
}

function resetAll() {
  resetWordSwaps();
  resetAiRewrites();
  resetBuzzwordHighlights();
}

chrome.storage.local.get("autoMode").then(({ autoMode }) => {
  if (autoMode === "slopify" || autoMode === "unslopify") applyDirection(autoMode);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "slopify" || msg.action === "unslopify") {
    applyDirection(msg.action);
    sendResponse({ ok: true });
  }
  if (msg.action === "reset") {
    resetAll();
    sendResponse({ ok: true });
  }
  if (msg.action === "aiSlopify" || msg.action === "aiUnslop") {
    const direction = msg.action === "aiSlopify" ? "slopify" : "unslopify";
    trackTask("rewrite", "Rewriting with AI...", () => doAiRewrite(direction)).then(sendResponse);
  }
  if (msg.action === "detect") {
    detect().then(sendResponse);
  }
  if (msg.action === "flagJargon") {
    toggleBuzzwordHighlights().then(sendResponse);
  }
  if (msg.action === "jargonStatus") {
    sendResponse({ active: jargonIsFlagged() });
    return;
  }
  return true;
});
