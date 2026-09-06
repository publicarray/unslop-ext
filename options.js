function updateBackendVisibility() {
  const isChromeAi = document.getElementById("aiBackend").value === "chrome-ai";
  document.getElementById("llamaFields").style.display = isChromeAi ? "none" : "block";
  document.getElementById("chromeAiHint").style.display = isChromeAi ? "block" : "none";
}

chrome.storage.local.get(["endpoint", "model", "autoMode", "aiBackend", "showOriginalOnHover", "buzzwordStyle"]).then(
  ({ endpoint, model, autoMode, aiBackend, showOriginalOnHover, buzzwordStyle }) => {
    document.getElementById("endpoint").value = endpoint || "http://localhost:9931/v1/chat/completions";
    document.getElementById("model").value = model || "local";
    document.getElementById("autoMode").value = autoMode || "off";
    document.getElementById("aiBackend").value = aiBackend || "chrome-ai";
    document.getElementById("showOriginalOnHover").checked = showOriginalOnHover !== false;
    document.getElementById("buzzwordStyle").value = buzzwordStyle || "highlight";
    updateBackendVisibility();
  }
);

document.getElementById("aiBackend").addEventListener("change", updateBackendVisibility);

document.getElementById("save").addEventListener("click", async () => {
  const endpoint = document.getElementById("endpoint").value.trim();
  const model = document.getElementById("model").value.trim();
  const autoMode = document.getElementById("autoMode").value;
  const aiBackend = document.getElementById("aiBackend").value;
  const showOriginalOnHover = document.getElementById("showOriginalOnHover").checked;
  const buzzwordStyle = document.getElementById("buzzwordStyle").value;
  await chrome.storage.local.set({ endpoint, model, autoMode, aiBackend, showOriginalOnHover, buzzwordStyle });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1500);
});
