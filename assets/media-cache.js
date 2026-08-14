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

// Photos, video and the background music. Cache.put() rejects a 206 outright,
// so what's stored is always the whole file, fetched in one plain 200 request;
// the byte ranges that <video> and <audio> ask for are then cut from that
// stored copy by serveRangeFromCached below.
const CACHEABLE_DESTINATIONS = ['image', 'video', 'audio'];

// A single file is never allowed to eat the whole storage quota. Well clear of
// anything in this album (the one video is ~40MB) but a guard against someone
// later uploading something enormous and pushing everything else out.
const MAX_CACHEABLE_BYTES = 400 * 1024 * 1024;

function isCacheableMediaRequest(request){
  if(request.method !== 'GET') return false;
  if(!CACHEABLE_DESTINATIONS.includes(request.destination)) return false;
  let url;
  try{ url = new URL(request.url); }catch(e){ return false; }
  return url.hostname.endsWith(MEDIA_HOST_SUFFIX);
}

// Parses one "bytes=" range against a known total size. Returns null for
// anything unusual -- multiple ranges, a non-bytes unit, a range that starts
// past the end -- so those go to the network untouched instead of being
// answered by hand from a guess.
function parseByteRange(header, total){
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if(!m) return null;
  const rawStart = m[1], rawEnd = m[2];
  let start, end;
  if(rawStart === ''){
    if(rawEnd === '') return null;
    const lastN = parseInt(rawEnd, 10);        // "bytes=-500" -> final 500 bytes
    if(!Number.isFinite(lastN) || lastN <= 0) return null;
    start = Math.max(0, total - lastN);
    end = total - 1;
  }else{
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? total - 1 : parseInt(rawEnd, 10);
  }
  if(!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if(start < 0 || start >= total || end < start) return null;
  if(end >= total) end = total - 1;
  return { start: start, end: end };
}

// Builds the 206 Partial Content response a media element expects, cutting the
// bytes out of the stored full copy. Safari in particular refuses to play a
// video at all if range requests aren't honoured, so this has to be a real 206
// with a correct Content-Range -- never the whole file with a 200.
async function serveRangeFromCached(cached, rangeHeader, transform){
  const blob = await cached.blob();
  const range = parseByteRange(rangeHeader, blob.size);
  if(!range) return null;
  const slice = blob.slice(range.start, range.end + 1);
  const headers = new Headers();
  const type = cached.headers.get('Content-Type');
  if(type) headers.set('Content-Type', type);
  headers.set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + blob.size);
  headers.set('Content-Length', String(slice.size));
  headers.set('Accept-Ranges', 'bytes');
  const res = new Response(slice, { status: 206, statusText: 'Partial Content', headers: headers });
  return (transform || (r => r))(res);
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
    if(!hit) return null;

    const rangeHeader = request.headers.get('range');
    if(rangeHeader) return await serveRangeFromCached(hit, rangeHeader, transform);

    // A video or audio request with no range header we can read: pass it to the
    // network rather than answering with the full file. Handing a plain 200 to
    // an element that asked for a range is the one thing that could break
    // playback outright, and streaming from B2 is only slower, never broken.
    if(request.destination !== 'image') return null;

    return (transform || (r => r))(hit);
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

  // Video and audio on a miss: streamed straight from B2, exactly as before.
  // The element asked for a byte range, and this worker has no business
  // answering that with a fetch of its own -- the whole file under a 200 is
  // precisely what breaks playback. populateMediaCache fills the cache in the
  // background instead, so the *next* load can be served as proper 206s.
  if(request.destination !== 'image') return pass(await fetch(request));

  // Deliberately a fresh CORS request rather than a reuse of the page's
  // no-cors one, for two reasons. A no-cors response is opaque: its status
  // always reads 0, so caching one would mean happily storing a 404 or a 500
  // forever with no way to tell it from the real photo -- and its headers
  // can't be rewritten, so COEP on the builder page rejects it outright.
  // A CORS response is inspectable, cacheable, and can carry CORP. The
  // bucket allows cross-origin GETs from the site's own origin.
  try{
    const res = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
    if(res && res.status === 200){
      try{
        const cache = await caches.open(MEDIA_CACHE);
        // Not awaited: a full or unavailable cache should slow a later load
        // down, never hold up the photo being shown right now.
        cache.put(request.url, res.clone()).catch(() => {});
      }catch(e){ /* storage disabled or full -- serve it anyway */ }
      return pass(res);
    }
  }catch(e){ /* offline, or CORS not allowed from this origin -- fall through */ }

  // Last resort, byte for byte what this worker did before any caching
  // existed. If everything above fails, the photo is no worse off than it
  // was, and nothing here can leave a slide blank that would have filled.
  return pass(await fetch(request));
}

// Downloads a whole file once, in the background, so later range requests can
// be cut from it. A playing video fires a burst of range requests, so this
// keeps its own in-flight set -- without it, each one would kick off its own
// 40MB download before the first had a chance to land.
const mediaFillsInFlight = new Set();

async function populateMediaCache(request){
  const url = request.url;
  if(mediaFillsInFlight.has(url)) return;
  mediaFillsInFlight.add(url);
  try{
    const cache = await caches.open(MEDIA_CACHE);
    if(await cache.match(url, { ignoreVary: true })) return;
    const res = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
    if(!res || res.status !== 200) return;
    const size = parseInt(res.headers.get('Content-Length') || '0', 10);
    if(size > MAX_CACHEABLE_BYTES) return;
    await cache.put(url, res);
  }catch(e){
    // Offline, CORS not allowed from this origin, quota full -- all fine. The
    // file just keeps streaming from B2 the way it does today.
  }finally{
    mediaFillsInFlight.delete(url);
  }
}
