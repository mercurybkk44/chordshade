(async () => {
  document.getElementById('chordshade-sync')?.remove();
  window._chordSyncInterval && clearInterval(window._chordSyncInterval);

  const { chordSync } = await chrome.storage.local.get(['chordSync']);
  if (!chordSync?.active || !chordSync.videoPoints?.length) return;

  const { videoPoints, chords, title, artist } = chordSync;
  const totalMeasures = videoPoints.length;

  // ── Overlay ────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'chordshade-sync';
  overlay.style.cssText = `
    position: fixed;
    top: 80px;
    right: 28px;
    z-index: 9999;
    background: rgba(10, 10, 20, 0.88);
    color: white;
    padding: 14px 18px 16px;
    border-radius: 14px;
    font-family: -apple-system, sans-serif;
    min-width: 130px;
    text-align: center;
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(10px);
    cursor: move;
    user-select: none;
    transition: transform 0.12s ease;
  `;

  overlay.innerHTML = `
    <div id="cs-song" style="font-size:10px;color:#6b7280;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${title}</div>
    <div id="cs-chord" style="font-size:54px;font-weight:700;line-height:1;color:#f9fafb;letter-spacing:-1px">–</div>
    <div id="cs-next" style="font-size:12px;color:#6b7280;margin-top:6px">next –</div>
    <div id="cs-measure" style="font-size:10px;color:#374151;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">measure –</div>
  `;

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    position:absolute;top:6px;right:8px;
    background:none;border:none;color:#4b5563;
    font-size:15px;cursor:pointer;padding:0;line-height:1;
  `;
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    clearInterval(window._chordSyncInterval);
    chrome.storage.local.remove(['chordSync']);
  });
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  // ── Draggable ──────────────────────────────────────────────
  let isDragging = false, ox = 0, oy = 0;
  overlay.addEventListener('mousedown', e => {
    if (e.target === closeBtn) return;
    isDragging = true;
    ox = e.clientX - overlay.getBoundingClientRect().left;
    oy = e.clientY - overlay.getBoundingClientRect().top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    overlay.style.left = `${e.clientX - ox}px`;
    overlay.style.top = `${e.clientY - oy}px`;
    overlay.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => isDragging = false);

  // ── Sync loop ──────────────────────────────────────────────
  function getMeasureAt(currentTime) {
    let m = 0;
    for (let i = 0; i < videoPoints.length; i++) {
      if (currentTime >= videoPoints[i]) m = i;
      else break;
    }
    return m;
  }

  function animateChordChange(el) {
    el.style.transform = 'scale(1.18)';
    el.style.color = '#e94560';
    setTimeout(() => {
      el.style.transform = 'scale(1)';
      el.style.color = '#f9fafb';
    }, 180);
  }

  let lastMeasure = -1;

  console.log('[ChordShade] videoPoints sample:', videoPoints?.slice?.(0, 5) ?? videoPoints);
  console.log('[ChordShade] chords sample:', chords?.slice?.(0, 5) ?? chords);

  window._chordSyncInterval = setInterval(() => {
    const video = document.querySelector('video');
    if (!video) return;
    const measure = getMeasureAt(video.currentTime);
    if (measure === lastMeasure) return;
    lastMeasure = measure;

    const chordEl = document.getElementById('cs-chord');
    const nextEl  = document.getElementById('cs-next');
    const measureEl = document.getElementById('cs-measure');
    if (!chordEl) return;

    if (chords?.length) {
      const current = chords[measure] || '?';
      const next    = chords[measure + 1] || '–';
      if (chordEl.textContent !== current) {
        chordEl.textContent = current;
        animateChordChange(chordEl);
      }
      nextEl.textContent = `next  ${next}`;
    } else {
      // videoPoints confirmed working — chord data pending API verification
      chordEl.style.fontSize = '24px';
      chordEl.textContent = `Bar ${measure + 1}`;
      nextEl.textContent = 'chord data unavailable';
    }

    measureEl.textContent = `measure  ${measure + 1} / ${totalMeasures}`;
  }, 100);
})();
