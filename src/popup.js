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

async function getTabChords(songId, revisionId, tracks, slug) {
  const result = await bgMessage({ type: 'SONGSTERR_TAB_CHORDS', songId, revisionId, tracks, slug }).catch(() => null);
  if (!result?.data) return null;
  return extractChordsFromTab(result.data);
}

// ── Tab → Chord conversion ─────────────────────────────────────
const STRING_OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_TEMPLATES = {
  '':     [0, 4, 7],
  'm':    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7':   [0, 3, 7, 10],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim':  [0, 3, 6],
};

function notesToChordName(notes) {
  if (!notes?.length) return null;
  const pcs = [...new Set(notes.map(n => (STRING_OPEN_MIDI[6 - n.string] + n.fret) % 12))];
  if (pcs.length < 2) return null;

  let best = null, bestScore = 0;
  for (let root = 0; root < 12; root++) {
    if (!pcs.includes(root)) continue;
    const intervals = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b);
    for (const [quality, tmpl] of Object.entries(CHORD_TEMPLATES)) {
      const matched = tmpl.filter(t => intervals.includes(t)).length;
      const score = matched / tmpl.length;
      if (score >= 0.66 && score > bestScore) {
        bestScore = score;
        best = NOTE_NAMES[root] + quality;
      }
    }
  }
  return best;
}

function extractChordsFromTab(tabData) {
  if (!tabData?.tracks) return null;
  const track = tabData.tracks.find(t =>
    t.name?.toLowerCase().includes('guitar') || t.instrument?.id < 30
  ) || tabData.tracks[0];
  if (!track?.measures) return null;

  return track.measures.map(measure => {
    const notes = (measure.beats || []).flatMap(b =>
      (b.notes || [])
        .filter(n => n.fret !== undefined && n.string !== undefined)
        .map(n => ({ string: n.string, fret: n.fret }))
    );
    return notesToChordName(notes);
  });
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
    func: () => document.title.replace(' - YouTube', '').trim()
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
      getTabChords(foundSong.id, foundSong.revisionId, foundSong.tracks, foundSong.slug)
    ]);

    // API returns array of video entries; each has a .points array of timestamps
    let videoPoints = [];
    if (Array.isArray(videoPointsRaw)) {
      const entry = videoPointsRaw.find(v => v.videoId === ytVideoId) || videoPointsRaw[0];
      videoPoints = entry?.points || [];
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
    setStatus(`✓ Sync active — ${videoPoints.length} measures`, 'found');
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
