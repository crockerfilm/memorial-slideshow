// TEST-MODE MOCK BACKEND
// Mimics just enough of the supabase-js query builder API for this app to
// run entirely in-browser with no real backend. Data is stored in
// IndexedDB (a real, if temporary, on-device database) rather than plain
// JS memory, specifically so that builder.html and index.html -- two
// separate page loads -- can both see the same uploaded files and slide
// order. It persists across reloads, and clears only if you clear this
// device's browser storage for the page. This is for trying out the
// upload/reorder/caption/playback flow before wiring up real Supabase --
// it is not where real event data should live long-term.

(function(){
  const DB_NAME = 'memorial-slideshow-test';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if(!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function idbGet(store, key){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  function idbSet(store, key, value){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function idbDelete(store, key){
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  const DEFAULT_SETTINGS = {
    id: 1,
    title: 'Patrick Lawrence DeLaere Jr.',
    subtitle: 'Celebrating the life of',
    dates: 'September 18, 1969 – July 6, 2026',
    closing_message: 'Thank you for celebrating a life well lived.',
    music_path: '',
    loop_enabled: true,
    random_order: false
  };

  async function getSettings(){
    const s = await idbGet('meta', 'settings');
    return s || { ...DEFAULT_SETTINGS };
  }
  async function patchSettings(payload){
    const cur = await getSettings();
    const next = { ...cur, ...payload };
    await idbSet('meta', 'settings', next);
    return next;
  }
  async function getSlides(){
    const s = await idbGet('meta', 'slides');
    return s || [];
  }
  async function saveSlides(arr){
    await idbSet('meta', 'slides', arr);
  }

  function uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }

  class MockQuery {
    constructor(table){
      this.table = table;
      this.state = {};
    }
    select(cols){ this.state.op = 'select'; this.state.cols = cols; return this; }
    order(col, opts){ this.state.orderCol = col; this.state.orderAsc = !opts || opts.ascending !== false; return this; }
    eq(col, val){ this.state.eqCol = col; this.state.eqVal = val; return this; }
    single(){ this.state.single = true; return this; }
    update(payload){ this.state.op = 'update'; this.state.payload = payload; return this; }
    delete(){ this.state.op = 'delete'; return this; }
    insert(payload){ this.state.op = 'insert'; this.state.payload = payload; return this; }

    async _run(){
      const s = this.state;

      if(this.table === 'settings'){
        if(s.op === 'update'){
          await patchSettings(s.payload);
          return { data: null, error: null };
        }
        const data = await getSettings();
        return { data, error: null };
      }

      if(this.table === 'slides'){
        let arr = await getSlides();

        if(s.op === 'insert'){
          // Supports both a single object and an array (bulk import uses arrays).
          const payloads = Array.isArray(s.payload) ? s.payload : [s.payload];
          const rows = payloads.map(p => ({
            id: uuid(), caption: '', audio_enabled: true, filename: '',
            created_at: new Date().toISOString(), ...p
          }));
          arr.push(...rows);
          await saveSlides(arr);
          return { data: rows, error: null };
        }
        if(s.op === 'update'){
          const row = arr.find(r => r[s.eqCol] === s.eqVal);
          if(row) Object.assign(row, s.payload);
          await saveSlides(arr);
          return { data: null, error: null };
        }
        if(s.op === 'delete'){
          arr = arr.filter(r => r[s.eqCol] !== s.eqVal);
          await saveSlides(arr);
          return { data: null, error: null };
        }
        // select
        if(s.orderCol){
          arr = [...arr].sort((a,b) => s.orderAsc ? a[s.orderCol]-b[s.orderCol] : b[s.orderCol]-a[s.orderCol]);
        }
        return { data: arr, error: null };
      }

      return { data: null, error: { message: 'Unknown table in mock backend: ' + this.table } };
    }

    then(resolve, reject){ this._run().then(resolve, reject); }
    catch(reject){ return this._run().catch(reject); }
  }

  function createMockClient(){
    return {
      from(table){ return new MockQuery(table); },
      storage: {
        from(bucket){
          return {
            async upload(path, file, opts){
              await idbSet('files', path, file); // File/Blob objects store natively in IndexedDB
              return { data: { path }, error: null };
            },
            async remove(paths){
              for(const p of paths) await idbDelete('files', p);
              return { data: null, error: null };
            }
          };
        }
      }
    };
  }

  // Resolves a stored file into a fresh object URL. Must be called fresh
  // in whichever document needs it -- object URLs don't carry over between
  // separate page loads, only the underlying Blob (via IndexedDB) does.
  async function mockPublicUrl(path){
    const blob = await idbGet('files', path);
    if(!blob) return '';
    return URL.createObjectURL(blob);
  }

  window.createMockClient = createMockClient;
  window.__mockPublicUrlAsync = mockPublicUrl;

  // Optional escape hatch for testing: clears all test-mode data.
  window.__clearMockData = async function(){
    const db = await openDb();
    await Promise.all(['meta','files'].map(store => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    })));
  };
})();
