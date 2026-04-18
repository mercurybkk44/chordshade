const SONGSTERR = 'https://www.songsterr.com';
const CDN_WITH_IMG = ['dqsljvtekg760', 'd34shlm8p2ums2', 'd3cqchs6g3b5ew'];
const CDN_NO_IMG   = ['d3rrfvx08uyjp1', 'dodkcbujl0ebx', 'dj1usja78sinh'];
const CDN_STAGE    = 'd3d3l6a6rcgkaf';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const dispatch = {
    SONGSTERR_SEARCH:       () => handleSearch(msg.query),
    SONGSTERR_VIDEO_POINTS: () => handleVideoPoints(msg.songId, msg.revisionId),
    SONGSTERR_TRACK_NOTES:  () => handleTrackNotes(msg),
  }[msg.type];
  if (!dispatch) return;
  dispatch().then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
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
    image: meta.image || null,
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

function trackNotesUrl({ songId, revisionId, image, partId, attempt = 0 }) {
  if (image && image.endsWith('-stage')) {
    return `https://${CDN_STAGE}.cloudfront.net/${songId}/${revisionId}/${image}/${partId}.json`;
  }
  if (image) {
    const host = CDN_WITH_IMG[attempt % CDN_WITH_IMG.length];
    return `https://${host}.cloudfront.net/${songId}/${revisionId}/${image}/${partId}.json`;
  }
  const host = CDN_NO_IMG[attempt % CDN_NO_IMG.length];
  return `https://${host}.cloudfront.net/part/${revisionId}/${partId}`;
}

async function handleTrackNotes({ songId, revisionId, image, partId }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = trackNotesUrl({ songId, revisionId, image, partId, attempt });
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastErr = new Error(`CDN ${res.status} at ${url}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Track notes fetch failed');
}
