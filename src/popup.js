async function loadSavedSettings() {
  const { overlayImage = '', overlayOpacity = 0.7 } = await chrome.storage.local.get(["overlayImage", "overlayOpacity"]);
  document.getElementById("imgUrl").value = overlayImage;
  document.getElementById("opacity").value = overlayOpacity;
}

document.addEventListener("DOMContentLoaded", loadSavedSettings);

document.getElementById("saveBtn").addEventListener("click", async () => {
  const url = document.getElementById("imgUrl").value.trim();
  const opacity = parseFloat(document.getElementById("opacity").value);
  if (!url) return alert("Please enter a valid image URL");
  await chrome.storage.local.set({ overlayImage: url, overlayOpacity: opacity });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/content.js"]
  });
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["overlayImage", "overlayOpacity"]);
  document.getElementById("imgUrl").value = "";
  document.getElementById("opacity").value = 0.7;
});