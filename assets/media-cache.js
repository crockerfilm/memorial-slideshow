// Persistent browser-side cache for the photos that live in Backblaze B2, so
// repeat page loads don't re-download every one of them from B2 every single
// time (slow, and on a flaky connection it leaves broken-image question marks
// all over the page).
//
// Loaded via importScripts() from coi-serviceworker.js -- that one service
// worker handles BOTH cross-origin isolation and this caching. Two separate
// service workers can't be used here: builder.html and index.html sit at the
// same origin and scope, so registering a second script URL would replace the
// first registration and the two pages would fight over which worker wins.
//
// Caching forever is safe because builder.html gives every upload a unique
// timestamped path (photo/1786673883496-img-0426.jpeg) -- a given URL's
// contents never change, it's only ever replaced by a brand new URL.

const MEDIA_CACHE = 'b2-media-v1';
const MEDIA_HOST_SUFFIX = 'backblazeb2.com';

function isCacheableMediaRequest(request){
  if(request.method !== 'GET') return false;
  // Photos only, deliberately. <video> and <audio> fetch byte ranges, which
  // come back as 206 Partial Content: Cache.put() rejects 206 outright, and
  // hand-rolling partial-content caching is a great way to break playback
  // and seeking in subtle ways. Videos and the background music therefore
  // stream straight from B2 exactly as they always have, while photos --
  // the bulk of the show, and the thing that was showing question marks --
  // are plain 200s that cache cleanly. `destination` is used rather than a
  // Range-header check because request headers aren't reliably readable on
  // the no-cors requests media elements make.
  if(request.destination !== 'image') return false;
  if(request.headers.has('range')) return false;
  let url;
  try{ url = new URL(request.url); }catch(e){ return false; }
  return url.hostname.endsWith(MEDIA_HOST_SUFFIX);
}

// The builder lists every photo at once (200+ thumbnails), and firing that
// many requests at Backblaze simultaneously makes a good number of them fail
// outright -- which is what leaves rows of broken-image icons on that page.
// One photo on its own always loads, so this is throughput, not correctness.
// Requests are therefore queued through a small number of slots; the rest
// wait their turn rather than being thrown at B2 and failing.
const MAX_CONCURRENT_FETCHES = 6;
const FETCH_TIMEOUT_MS = 20000;
let activeFetches = 0;
const fetchQueue = [];

function acquireSlot(){
  if(activeFetches < MAX_CONCURRENT_FETCHES){
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise(resolve => fetchQueue.push(resolve));
}

function releaseSlot(){
  const next = fetchQueue.shift();
  if(next) next();           // hand the slot straight to whoever is waiting
  else activeFetches--;
}

// A queued fetch that can't hold its slot forever. Without the timeout one
// stalled connection on venue wifi would park a slot permanently and slowly
// throttle everything behind it down to nothing.
async function queuedFetch(url){
  await acquireSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try{
    return await fetch(new Request(url, {
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    }));
  }finally{
    clearTimeout(timer);
    releaseSlot();
  }
}

// Returns a cached Response for this request, or null if we don't have one.
// `transform` re-applies the caller's COOP/COEP/CORP headers to the cached
// copy -- without them a cached cross-origin image would be blocked by COEP.
async function matchCachedMedia(request, transform){
  try{
    const cache = await caches.open(MEDIA_CACHE);
    // ignoreVary because B2 responds with `Vary: origin, ...`; the stored
    // copy was fetched with an Origin header and the <img> request that
    // later looks for it has none, so a Vary-respecting match would never
    // hit and this cache would silently do nothing at all.
    const hit = await cache.match(request.url, { ignoreVary: true });
    return hit ? (transform || (r => r))(hit) : null;
  }catch(e){
    return null; // storage disabled/full/private mode -- just use the network
  }
}

// Cache first, then the network. `transform` stamps on the caller's headers,
// including the Cross-Origin-Resource-Policy that lets a cross-origin photo
// through builder.html's COEP.
async function mediaResponse(request, transform){
  const pass = transform || (r => r);

  const cached = await matchCachedMedia(request, pass);
  if(cached) return cached;

  // Deliberately a fresh CORS request rather than a reuse of the page's
  // no-cors one, for two reasons. A no-cors response is opaque: its status
  // always reads 0, so caching one would mean happily storing a 404 or a 500
  // forever with no way to tell it from the real photo -- and its headers
  // can't be rewritten, so COEP on the builder page rejects it outright.
  // A CORS response is inspectable, cacheable, and can carry CORP. The
  // bucket allows cross-origin GETs from the site's own origin.
  // Two attempts: a photo that lost a race with 200 siblings usually comes
  // back fine a moment later, and a retry here is invisible to the page,
  // whereas a failure it can see is a broken image on screen.
  for(let attempt = 0; attempt < 2; attempt++){
    try{
      const res = await queuedFetch(request.url);
      if(res && res.status === 200){
        try{
          const cache = await caches.open(MEDIA_CACHE);
          // Not awaited: a full or unavailable cache should slow a later load
          // down, never hold up the photo being shown right now.
          cache.put(request.url, res.clone()).catch(() => {});
        }catch(e){ /* storage disabled or full -- serve it anyway */ }
        return pass(res);
      }
    }catch(e){ /* offline, CORS refused, or timed out -- retry, then give up */ }
    if(attempt === 0) await new Promise(r => setTimeout(r, 400));
  }

  // Last resort, byte for byte what this worker did before any caching
  // existed. If everything above fails, the photo is no worse off than it
  // was, and nothing here can leave a slide blank that would have filled.
  return pass(await fetch(request));
}
