const SONGSTERR = 'https://www.songsterr.com';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SONGSTERR_SEARCH') {
    handleSearch(msg.query).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true; // async response
  }
  if (msg.type === 'SONGSTERR_VIDEO_POINTS') {
    handleVideoPoints(msg.songId, msg.revisionId).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'SONGSTERR_TAB_CHORDS') {
    handleTabChords(msg.songId, msg.revisionId, msg.tracks, msg.slug).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

async function handleSearch(query) {
  const res = await fetch(`${SONGSTERR}/?pattern=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Songsterr returned ${res.status}`);
  const html = await res.text();

  const slugMatches = [...html.matchAll(/href="\/a\/wsa\/([^"]+?-s(\d+))(?:t\d+)?"/g)];
  if (!slugMatches.length) throw new Error('No songs found on Songsterr');

  const slug = slugMatches[0][1];
  const songId = parseInt(slugMatches[0][2]);

  const metaRes = await fetch(`${SONGSTERR}/api/meta/${songId}`);
  if (!metaRes.ok) throw new Error(`Metadata failed for song ${songId}`);
  const meta = await metaRes.json();

  return {
    id: songId,
    slug,
    title: meta.title || slug,
    artist: meta.artist || '',
    revisionId: meta.revisionId,
    tracks: meta.tracks || [],
    youtubeVideos: (meta.videos || []).map(v => v.videoId)
  };
}

async function handleVideoPoints(songId, revisionId) {
  if (!revisionId) throw new Error(`revisionId missing for song ${songId}`);
  const res = await fetch(`${SONGSTERR}/api/video-points/${songId}/${revisionId}/list`);
  if (!res.ok) throw new Error(`video-points ${res.status}`);
  return await res.json();
}

async function handleTabChords(songId, revisionId, tracks, slug) {
  // Try __NEXT_DATA__ from Songsterr page HTML
  if (slug) {
    try {
      const res = await fetch(`${SONGSTERR}/a/wsa/${slug}`);
      if (res.ok) {
        const html = await res.text();
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
        if (m) {
          const nextData = JSON.parse(m[1]);
          const pp = nextData?.props?.pageProps;
          console.log('[ChordShade] __NEXT_DATA__ pageProps keys:', pp && Object.keys(pp).slice(0, 20));
          return { data: pp, source: 'nextdata' };
        } else {
          console.log('[ChordShade] no __NEXT_DATA__ found in page');
        }
      }
    } catch (e) { console.log('[ChordShade] page fetch error:', e.message); }
  }
  return null;
}
