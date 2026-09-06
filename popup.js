async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (!/Receiving end does not exist/.test(e.message)) throw e;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["wordlist.js", "buzzwords.js", "content.js"] });
    } catch {
      throw new Error("This page doesn't allow extensions (e.g. chrome:// pages, the Web Store, or PDF viewer). Open a normal webpage and try again.");
    }
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

function renderError(resultEl, result) {
  resultEl.textContent = "";
  resultEl.append(result.error);
  if (result.link) {
    resultEl.append(document.createElement("br"));
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = result.link;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: result.link });
    });
    resultEl.append(a);
  }
  if (result.raw) {
    resultEl.append(document.createElement("br"));
    resultEl.append(`Raw response: ${result.raw.slice(0, 300)}`);
  }
}

function renderDone(resultEl, task) {
  const result = task.result;
  if (task.kind === "rewrite") {
    resultEl.textContent = `Rewrote ${result.count} block(s).`;
    return;
  }
  resultEl.textContent =
    `AI likelihood: ${result.ai_likelihood}%\n` +
    `Slop score: ${result.slop_score}%\n` +
    `${result.reason}\n\n` +
    `Unslopped title: ${result.unslopped_title}\n` +
    `Unslopped excerpt: ${result.unslopped_excerpt}`;
}

async function renderTask() {
  const resultEl = document.getElementById("result");
  const cancelBtn = document.getElementById("cancelAi");
  const tab = await activeTab();
  const { tasks = {}, downloadProgress } = await chrome.storage.local.get(["tasks", "downloadProgress"]);
  const task = tasks[tab.id];
  if (!task) {
    cancelBtn.hidden = true;
    return;
  }

  cancelBtn.hidden = task.status !== "running";

  if (task.status === "running") {
    const secs = Math.floor((Date.now() - task.startTime) / 1000);
    let status = `${task.label} (${secs}s)`;
    if (downloadProgress != null) {
      status += ` - downloading model: ${Math.round(downloadProgress * 100)}%`;
    } else if (secs >= 5) {
      status += " - still working, no response yet";
    }
    resultEl.textContent = status;
  } else if (task.status === "error") {
    renderError(resultEl, task.result);
  } else {
    renderDone(resultEl, task);
  }
}

setInterval(renderTask, 500);
document.addEventListener("DOMContentLoaded", renderTask);

document.getElementById("cancelAi").addEventListener("click", async () => {
  const tab = await activeTab();
  try {
    await chrome.runtime.sendMessage({ action: "cancelAI", tabId: tab.id });
  } catch (e) {
    document.getElementById("result").textContent = `Could not reach the extension background page: ${e.message}. Try reloading the extension.`;
  }
});

chrome.storage.local.get("aiBackend").then(({ aiBackend }) => {
  const backendLabel = (aiBackend || "chrome-ai") === "chrome-ai" ? "Chrome built-in AI" : "llama-server";
  document.getElementById("aiLabel").textContent = `AI rewrite (slower, uses ${backendLabel})`;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.aiBackend) {
    const backendLabel = (changes.aiBackend.newValue || "chrome-ai") === "chrome-ai" ? "Chrome built-in AI" : "llama-server";
    document.getElementById("aiLabel").textContent = `AI rewrite (slower, uses ${backendLabel})`;
  }
});

async function sendToContent(action) {
  const tab = await activeTab();
  try {
    await sendToTab(tab.id, { action });
  } catch (e) {
    document.getElementById("result").textContent = e.message;
  }
}

document.getElementById("slopify").addEventListener("click", () => sendToContent("slopify"));
document.getElementById("unslopify").addEventListener("click", () => sendToContent("unslopify"));
document.getElementById("reset").addEventListener("click", () => sendToContent("reset"));

document.getElementById("flagJargon").addEventListener("click", async () => {
  const tab = await activeTab();
  const resultEl = document.getElementById("result");
  try {
    const res = await sendToTab(tab.id, { action: "flagJargon" });
    resultEl.textContent = `Flagged ${res.count} jargon term(s).`;
  } catch (e) {
    resultEl.textContent = e.message;
  }
});

async function runTracked(action) {
  const tab = await activeTab();
  try {
    await sendToTab(tab.id, { action });
  } catch (e) {
    document.getElementById("result").textContent = e.message;
    return;
  }
  renderTask();
}

document.getElementById("aiSlopify").addEventListener("click", () => runTracked("aiSlopify"));
document.getElementById("aiUnslop").addEventListener("click", () => runTracked("aiUnslop"));
document.getElementById("detect").addEventListener("click", () => runTracked("detect"));
