function updateBackendVisibility() {
  const isChromeAi = document.getElementById("aiBackend").value === "chrome-ai";
  document.getElementById("llamaFields").style.display = isChromeAi ? "none" : "block";
  document.getElementById("chromeAiHint").style.display = isChromeAi ? "block" : "none";
}

const SLOP_INTENSITY_LABELS = {
  1: "Light touch",
  2: "Noticeable",
  3: "Cringe (default)",
  4: "Extremely cringe",
  5: "Maximum chaos"
};

function updateSlopIntensityLabel() {
  const value = document.getElementById("slopIntensity").value;
  document.getElementById("slopIntensityLabel").textContent = SLOP_INTENSITY_LABELS[value];
}

chrome.storage.local.get(["endpoint", "model", "autoMode", "aiBackend", "showOriginalOnHover", "buzzwordStyle", "slopIntensity"]).then(
  ({ endpoint, model, autoMode, aiBackend, showOriginalOnHover, buzzwordStyle, slopIntensity }) => {
    document.getElementById("endpoint").value = endpoint || "http://localhost:9931/v1/chat/completions";
    document.getElementById("model").value = model || "local";
    document.getElementById("autoMode").value = autoMode || "off";
    document.getElementById("aiBackend").value = aiBackend || "chrome-ai";
    document.getElementById("showOriginalOnHover").checked = showOriginalOnHover !== false;
    document.getElementById("buzzwordStyle").value = buzzwordStyle || "highlight";
    document.getElementById("slopIntensity").value = slopIntensity || "3";
    updateSlopIntensityLabel();
    updateBackendVisibility();
  }
);

document.getElementById("aiBackend").addEventListener("change", updateBackendVisibility);
document.getElementById("slopIntensity").addEventListener("input", updateSlopIntensityLabel);

document.getElementById("save").addEventListener("click", async () => {
  const endpoint = document.getElementById("endpoint").value.trim();
  const model = document.getElementById("model").value.trim();
  const autoMode = document.getElementById("autoMode").value;
  const aiBackend = document.getElementById("aiBackend").value;
  const showOriginalOnHover = document.getElementById("showOriginalOnHover").checked;
  const buzzwordStyle = document.getElementById("buzzwordStyle").value;
  const slopIntensity = document.getElementById("slopIntensity").value;
  await chrome.storage.local.set({ endpoint, model, autoMode, aiBackend, showOriginalOnHover, buzzwordStyle, slopIntensity });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1500);
});
