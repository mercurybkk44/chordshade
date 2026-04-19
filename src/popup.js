// ── Tab switching ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Songsterr API — via background service worker (avoids popup CSP) ──
function bgMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res?.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

async function searchSongsterr(query) {
  return bgMessage({ type: 'SONGSTERR_SEARCH', query });
}

async function getVideoPoints(songId, revisionId) {
  return bgMessage({ type: 'SONGSTERR_VIDEO_POINTS', songId, revisionId });
}

async function getTrackChords({ songId, revisionId, image, tracks }) {
  // Try ranked candidates; the top track may be a lead/solo with no chord markings.
  const candidates = rankGuitarTracks(tracks);
  for (const partId of candidates) {
    const trackData = await bgMessage({
      type: 'SONGSTERR_TRACK_NOTES', songId, revisionId, image, partId
    }).catch(() => null);
    const chords = extractChordsFromTrack(trackData);
    if (chords && chords.some(Boolean)) return chords;
  }
  return null;
}

// ── Track → Chord per measure ──────────────────────────────────
// Songsterr embeds chord name directly at the beat: beat.chord.text.
// A measure may have no chord marking (continuation) — carry over previous.
function extractChordsFromTrack(track) {
  if (!track?.measures) return null;
  let last = null;
  return track.measures.map(measure => {
    for (const voice of measure.voices || []) {
      for (const beat of voice.beats || []) {
        if (beat.chord?.text) { last = beat.chord.text; return last; }
      }
    }
    return last;
  });
}

// Rank guitar tracks by views — Songsterr users vote the canonical track up.
// Returns an array of track indices to try in order; getTrackChords falls
// through to the next candidate if the first has no chord markings.
function rankGuitarTracks(tracks) {
  const guitars = tracks
    .map((t, i) => ({ ...t, idx: i }))
    .filter(t => !t.isVocalTrack && !t.isEmpty)
    .filter(t =>
      (t.instrumentId >= 24 && t.instrumentId <= 31) ||
      (t.name || '').toLowerCase().includes('guitar')
    );
  if (!guitars.length) return tracks.map((_, i) => i);
  guitars.sort((a, b) => (b.views || 0) - (a.views || 0));
  return guitars.map(t => t.idx);
}

// ── YouTube title parser ───────────────────────────────────────
function parseYouTubeTitle(title) {
  // Strip notification count e.g. "(252) Eagles - Hotel California..."
  const clean = title.replace(/^\(\d+\)\s*/, '').trim();
  // Extract "Artist - Song" and drop trailing (Official Audio), [Official Video] etc.
  const m = clean.match(/^(.+?)\s*[-–]\s*(.+?)(?:\s*[\(\[|]|$)/);
  return m ? `${m[1]} ${m[2]}`.trim() : clean;
}

// ── Auto-detect panel init ─────────────────────────────────────
let foundSong = null;

async function getYouTubeTitle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('youtube.com/watch')) return null;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.title
      .replace(/^\(\d+\)\s*/, '')    // strip YouTube notification counter
      .replace(/\s*-\s*YouTube\s*$/, '')
      .trim()
  });
  return results?.[0]?.result || null;
}

async function initAutoPanel() {
  const { chordSync } = await chrome.storage.local.get(['chordSync']);
  if (chordSync?.active) {
    document.getElementById('syncBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'block';
    setStatus('Sync is active', 'found');
    document.getElementById('result-box').style.display = 'block';
    document.getElementById('result-title').textContent = chordSync.title;
    document.getElementById('result-artist').textContent = `by ${chordSync.artist}`;
  }

  const title = await getYouTubeTitle();
  if (title) {
    document.getElementById('yt-detect').style.display = 'block';
    document.getElementById('detected-title').textContent = title;
    window._ytTitle = title;
  } else {
    document.getElementById('no-yt').style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  initAutoPanel();
});

// ── Search ─────────────────────────────────────────────────────
document.getElementById('searchBtn').addEventListener('click', async () => {
  if (!window._ytTitle) return setStatus('No YouTube video detected', 'error');
  setStatus('Searching Songsterr...', 'loading');

  try {
    const query = parseYouTubeTitle(window._ytTitle);
    foundSong = await searchSongsterr(query);
    if (!foundSong) return setStatus('Not found on Songsterr', 'error');

    document.getElementById('result-box').style.display = 'block';
    document.getElementById('result-title').textContent = foundSong.title;
    document.getElementById('result-artist').textContent = `by ${foundSong.artist}`;
    document.getElementById('syncBtn').style.display = 'block';

    // Check if current YouTube video is synced in Songsterr
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const ytVideoId = new URL(tab.url).searchParams.get('v');
    const isSynced = foundSong.youtubeVideos?.includes(ytVideoId);
    setStatus(isSynced ? '✓ Found! This video has perfect timing sync' : '✓ Found! Ready to sync', 'found');
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
  }
});

// ── Enable sync ────────────────────────────────────────────────
document.getElementById('syncBtn').addEventListener('click', async () => {
  if (!foundSong) return;
  setStatus('Fetching timing data...', 'loading');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const ytVideoId = new URL(tab.url).searchParams.get('v');

    const [videoPointsRaw, chords] = await Promise.all([
      getVideoPoints(foundSong.id, foundSong.revisionId),
      getTrackChords({
        songId: foundSong.id,
        revisionId: foundSong.revisionId,
        image: foundSong.image,
        tracks: foundSong.tracks
      })
    ]);

    // API returns array of video entries; each has a .points array of timestamps.
    // If this YouTube video isn't in the list, timing will be approximate.
    let videoPoints = [];
    let timingMatched = false;
    if (Array.isArray(videoPointsRaw)) {
      const matched = videoPointsRaw.find(v => v.videoId === ytVideoId);
      const entry = matched || videoPointsRaw[0];
      videoPoints = entry?.points || [];
      timingMatched = Boolean(matched);
    }

    await chrome.storage.local.set({
      chordSync: {
        active: true,
        songId: foundSong.id,
        revisionId: foundSong.revisionId,
        title: foundSong.title,
        artist: foundSong.artist,
        videoPoints,
        chords: chords || null
      }
    });

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/chord-sync.js'] });

    document.getElementById('syncBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'block';
    const chordNote = chords?.some(Boolean) ? '' : ' (no chord data — showing bars)';
    const timingNote = timingMatched ? '' : ' • timing approx';
    setStatus(`✓ Sync active — ${videoPoints.length} measures${timingNote}${chordNote}`, 'found');
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error');
  }
});

// ── Stop sync ──────────────────────────────────────────────────
document.getElementById('stopBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['chordSync']);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.getElementById('chordshade-sync')?.remove();
      window._chordSyncInterval && clearInterval(window._chordSyncInterval);
    }
  });

  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('syncBtn').style.display = foundSong ? 'block' : 'none';
  setStatus('Sync stopped');
});

function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// ── Manual mode ────────────────────────────────────────────────
async function loadSavedSettings() {
  const { overlayImage = '', overlayOpacity = 0.7 } =
    await chrome.storage.local.get(['overlayImage', 'overlayOpacity']);
  document.getElementById('imgUrl').value = overlayImage;
  document.getElementById('opacity').value = overlayOpacity;
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const url = document.getElementById('imgUrl').value.trim();
  const opacity = parseFloat(document.getElementById('opacity').value);
  if (!url) return alert('Please enter a valid image URL');
  await chrome.storage.local.set({ overlayImage: url, overlayOpacity: opacity });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['overlayImage', 'overlayOpacity']);
  document.getElementById('imgUrl').value = '';
  document.getElementById('opacity').value = 0.7;
});
