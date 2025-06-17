(async () => {
    const { overlayImage, overlayOpacity = 0.7 } = await chrome.storage.local.get(["overlayImage", "overlayOpacity"]);
    if (!overlayImage) return;
  
    const existing = document.getElementById("guitar-overlay");
    if (existing) existing.remove();
  
    const youtubeVideo = document.querySelector('video');
    let videoHeight = 360;
    let videoRight = 20;
    let videoTop = 60;
    let containerWidth = 300;
    let containerHeight = 300;
  
    if (youtubeVideo) {
      const rect = youtubeVideo.getBoundingClientRect();
      videoHeight = rect.height;
      videoRight = window.innerWidth - rect.right;
      videoTop = rect.top;
      containerHeight = Math.max(100, rect.height - 100);
    }
  
    const container = document.createElement("div");
    container.id = "guitar-overlay";
    container.style.cssText = `
      position: fixed;
      top: ${videoTop + 10}px;
      right: ${videoRight + 20}px;
      z-index: 9999;
      display: inline-block;
      resize: both;
      overflow: hidden;
      border: 2px dashed rgba(0,0,0,0.1);
      height: ${containerHeight}px;
      width: ${containerWidth}px;
      background: rgba(255, 255, 255, 0.02);
    `;
  
    const img = document.createElement("img");
    img.src = overlayImage;
    img.style.pointerEvents = "none";
    img.style.userSelect = "none";
    img.style.borderRadius = "4px";
    img.style.display = "block";
    img.style.opacity = overlayOpacity.toString();
    img.style.height = "100%";
    img.style.width = "100%";
    img.style.objectFit = "contain";
  
    const dashedStyle = `
      position: absolute;
      left: 0;
      right: 0;
      height: 4px;
      background: repeating-linear-gradient(to right, rgba(255,255,255,0.9), rgba(255,255,255,0.9) 10px, transparent 10px, transparent 20px);
      animation: dash-fade 3s forwards;
      opacity: 1;
      border-radius: 2px;
    `;
  
    const topMarker = document.createElement("div");
    topMarker.style.cssText = dashedStyle + "top: 0;";
  
    const bottomMarker = document.createElement("div");
    bottomMarker.style.cssText = dashedStyle + "bottom: 0;";
  
    const closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.cssText = `
      position: absolute;
      top: 4px;
      right: 6px;
      font-size: 18px;
      background: rgba(0,0,0,0.5);
      color: white;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      cursor: pointer;
      z-index: 10000;
    `;
    closeButton.onclick = () => container.remove();
  
    const styleAnim = document.createElement("style");
    styleAnim.textContent = `
      @keyframes dash-fade {
        0% { opacity: 1; }
        90% { opacity: 1; }
        100% { opacity: 0; display: none; }
      }
    `;
  
    document.head.appendChild(styleAnim);
    container.appendChild(topMarker);
    container.appendChild(bottomMarker);
    container.appendChild(img);
    container.appendChild(closeButton);
    document.body.appendChild(container);
  
    container.style.cursor = "move";
    let isDragging = false;
    let offsetX, offsetY;
  
    container.addEventListener("mousedown", (e) => {
      if (e.target !== container) return;
      isDragging = true;
      offsetX = e.clientX - container.getBoundingClientRect().left;
      offsetY = e.clientY - container.getBoundingClientRect().top;
      container.style.cursor = "grabbing";
    });
  
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      container.style.left = `${e.clientX - offsetX}px`;
      container.style.top = `${e.clientY - offsetY}px`;
      container.style.right = "auto";
    });
  
    document.addEventListener("mouseup", () => {
      isDragging = false;
      container.style.cursor = "move";
    });
  })();