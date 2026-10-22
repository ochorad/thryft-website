// Thryft public profile pages (storefront / vendor / market / user).
// Loaded by /404.html; renders into #profile-root based on location.pathname.
// Mirrors the iOS app's StoreView / PopupView / EventView / UserProfileView.
const firebaseConfig = {
  apiKey: 'AIzaSyDH-H-a0MX_WsjwLLumAsKaYhwSWOC3T84',
  authDomain: 'vintagefindr-65c73.firebaseapp.com',
  projectId: 'vintagefindr-65c73',
  storageBucket: 'vintagefindr-65c73.appspot.com',
  messagingSenderId: '544675196910',
  appId: '1:544675196910:web:a1475495b688c5ae51e8ff',
};
// Firebase is loaded lazily so the skeleton renders immediately and CDN failures hit catches.
let fb = null;
function loadFirebase() {
  fb ||= Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]).then(([app, fs]) => ({ ...fs, db: fs.getFirestore(app.initializeApp(firebaseConfig)) }))
    .catch((e) => { fb = null; throw e; });
  return fb;
}

// Leaflet is loaded lazily, only on pages that show a map.
let leaflet = null;
function loadLeaflet() {
  leaflet ||= (async () => {
    // Stylesheet first (reused on retry, never duplicated); a CSS failure still lets the script run.
    let css = document.getElementById('pf-leaflet-css');
    if (!css) {
      css = document.createElement('link');
      css.id = 'pf-leaflet-css';
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      css.crossOrigin = '';
      const loaded = new Promise((res) => { css.onload = res; css.onerror = res; });
      document.head.append(css);
      await loaded;
    }
    if (window.L) return window.L;
    document.getElementById('pf-leaflet-js')?.remove(); // failed earlier attempt
    await new Promise((resolve, reject) => {
      const js = document.createElement('script');
      js.id = 'pf-leaflet-js';
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      js.crossOrigin = '';
      js.onload = resolve;
      js.onerror = () => reject(new Error('leaflet failed to load'));
      document.head.append(js);
    });
    return window.L;
  })().catch((e) => { leaflet = null; throw e; });
  return leaflet;
}

// Apple MapKit JS. The production token is origin-locked to MAPKIT_HOST. On localhost an unrestricted
// dev token is read from the git-ignored mapkit-dev-token.js (never commit it); other hosts use Leaflet.
const MAPKIT_HOST = 'www.officialthryft.com';
const MAPKIT_TOKEN = 'eyJraWQiOiI2QTJEWDUzTTNEIiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiIyWVc1MkpUQ0FMIiwiaWF0IjoxNzkyNjMxNTQ3LCJvcmlnaW4iOiJ3d3cub2ZmaWNpYWx0aHJ5ZnQuY29tIiwic2NvcGUiOiJtYXBraXRfanMifQ.G0B7RBTRREJ-IxKWnCEQKl93uaknydB-5VsSGgrDhDG4XoMBU90CLomqLwcoPkdAGjYbARDBu0wZNfNkZUblzg';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
let devTokenP = null;
function getMapKitToken() {
  if (location.hostname === MAPKIT_HOST) return Promise.resolve(MAPKIT_TOKEN);
  if (!LOCAL_HOSTS.includes(location.hostname)) return Promise.resolve(null);
  devTokenP ||= import('./mapkit-dev-token.js').then((m) => m.default || null, () => null);
  return devTokenP;
}
let mapkitP = null;
let mapkitBroken = false; // set once MapKit fails to load or reports an error (e.g. Unauthorized)
const mapkitErrorHandlers = new Set();
function loadMapKit() {
  mapkitP ||= (async () => {
    if (!window.mapkit?.Map) {
      document.getElementById('pf-mapkit-js')?.remove(); // failed earlier attempt
      await new Promise((resolve, reject) => {
        window.pfMapKitReady = resolve;
        setTimeout(() => reject(new Error('mapkit load timed out')), 8000);
        const js = document.createElement('script');
        js.id = 'pf-mapkit-js';
        js.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js';
        js.crossOrigin = 'anonymous';
        js.async = true;
        js.dataset.callback = 'pfMapKitReady';
        js.dataset.libraries = 'map,annotations';
        js.onerror = () => reject(new Error('mapkit failed to load'));
        document.head.append(js);
      });
    }
    await window.mapkit.loadedLibraries;
    if (!window.mapkit.pfInited) {
      window.mapkit.pfInited = true;
      window.mapkit.addEventListener('error', (e) => {
        console.warn('mapkit error', e?.status);
        mapkitBroken = true;
        mapkitErrorHandlers.forEach((fn) => fn());
      });
      const token = await getMapKitToken();
      window.mapkit.init({ authorizationCallback: (done) => done(token) });
    }
    return window.mapkit;
  })().catch((e) => { mapkitP = null; throw e; });
  return mapkitP;
}

const APP_STORE_URL = 'https://apps.apple.com/us/app/thryft-find-vintage-easy/id6502410266';

// ---------------------------------------------------------------- routing

const ALIASES = {
  s: 's', store: 's', v: 'v', vendor: 'v', popup: 'v',
  m: 'm', market: 'm', event: 'm', u: 'u', user: 'u',
};

/** Returns { kind: 's'|'v'|'m'|'u', id } or null. */
export function route(pathname) {
  const m = pathname.match(/^\/(s|v|m|u|store|vendor|popup|market|event|user)\/([^/]+)\/?$/);
  if (!m) return null;
  let id = m[2];
  try { id = decodeURIComponent(id); } catch (_) { /* keep raw */ }
  return { kind: ALIASES[m[1]], id };
}

const KINDS = {
  s: { collection: 'stores', label: 'Storefront', noun: 'store', gone: "This storefront isn't on Thryft anymore." },
  v: { collection: 'popups', label: 'Vendor', noun: 'vendor', gone: "This vendor isn't on Thryft anymore." },
  m: { collection: 'events', label: 'Market', noun: 'market', gone: "This market isn't on Thryft anymore." },
  u: { collection: 'publicProfiles', label: 'User', noun: 'profile', gone: "This profile isn't on Thryft anymore." },
};

/** Route of the page currently mounted (used by the deep links). */
let current = null;

// ---------------------------------------------------------------- DOM helpers

/** el('div', {class:'x', href:'..', onclick: fn}, child|string, ...) — strings become text nodes. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Only http(s) URLs are allowed for links and images. Returns '' otherwise. */
function safeUrl(u) {
  if (typeof u !== 'string') return '';
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (_) { return ''; }
}
const STORAGE_BASE = 'https://firebasestorage.googleapis.com/v0/b/vintagefindr-65c73.appspot.com/o/';
/** http(s) URL or Firebase Storage path -> loadable URL; '' for placeholders/invalid values. */
function storageUrl(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) {
    const u = safeUrl(t);
    if (!u) return '';
    try { if (/(^|\.)castlewoodassistedliving\.com$/i.test(new URL(u).hostname)) return ''; } catch (_) { return ''; }
    return u;
  }
  if (t === 'images/DefaultThryftProfile.png') return '';
  if (/^[\w\-./]+$/.test(t) && !t.includes('..')) return `${STORAGE_BASE}${encodeURIComponent(t)}?alt=media`;
  return '';
}
/**
 * Sets `node`'s background image once it is known to load. On failure calls
 * onFail(node) (e.g. remove the node); with no image the node is left as-is.
 */
function withBg(node, url, onFail) {
  const u = storageUrl(url);
  if (!u) { if (onFail) onFail(node); return node; }
  const probe = new Image();
  probe.onload = () => {
    node.style.backgroundImage = `url("${u.replace(/["()\\\s]/g, encodeURIComponent)}")`;
    node.classList.add('pf-loaded');
    if (node.classList.contains('pf-avatar')) node.textContent = '';
  };
  probe.onerror = () => { if (onFail) onFail(node); };
  probe.src = u;
  return node;
}
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const arr = (v) => (Array.isArray(v) ? v : []);
const pad = (n) => String(n).padStart(2, '0');
/** Handle from a raw value: strips @, and takes the last path segment if a URL / contains '/'. */
const stripAt = (h) => {
  let t = str(h);
  if (t.includes('/')) t = t.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  return t.replace(/^@/, '');
};
function initials(name) {
  const parts = str(name).replace(/^@/, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatar(url, name, cls = '') {
  return withBg(el('div', { class: `pf-avatar ${cls}`.trim() }, initials(name)), url);
}
/** Square thumbnail: gray placeholder (with an icon) until the image loads. */
function thumb(url, cls, iconName = 'image') {
  const n = el('div', { class: `pf-thumb ${cls || ''}`.trim() }, icon(iconName, 18));
  return withBg(n, url);
}
const placeOf = (d) => [str(d.city), str(d.state)].filter(Boolean).join(', ');
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Work that needs the real DOM (maps, text measurement); reset on each mount.
let afterMountQueue = [];
let layoutHooks = [];
const afterMount = (fn) => afterMountQueue.push(fn);
const onLayout = (fn) => layoutHooks.push(fn);
const runLayout = () => layoutHooks.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
let maps = [];

// ---------------------------------------------------------------- icons (inline SVG)

const S = (inner) => `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const F = (inner) => `<g fill="currentColor">${inner}</g>`;
const ICONS = {
  chevL: S('<path d="M15 5l-7 7 7 7"/>'),
  chevR: S('<path d="M9 5l7 7-7 7"/>'),
  chevD: S('<path d="M5 9l7 7 7-7"/>'),
  chevU: S('<path d="M5 15l7-7 7 7"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  star: S('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  check: S('<circle cx="12" cy="12" r="9.2"/><path d="M7.8 12.4l2.9 2.9 5.5-5.9"/>'),
  more: F('<circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/>'),
  loc: F('<path d="M21 3L3 10.6l7.4 2.9L13.4 21z"/>'),
  pin: S('<path d="M12 21.5s-6.8-5.8-6.8-11.4a6.8 6.8 0 0 1 13.6 0c0 5.6-6.8 11.4-6.8 11.4z"/><circle cx="12" cy="10.2" r="2.4"/>'),
  phone: F('<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/>'),
  instagram: '<g fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/></g><circle cx="17.2" cy="6.8" r="1.3" fill="currentColor"/>',
  facebook: F('<path d="M13.5 21v-8.2h2.8l.5-3.3h-3.3V7.4c0-.9.4-1.7 1.8-1.7h1.6V2.9s-1.2-.2-2.4-.2c-2.6 0-4.2 1.6-4.2 4.4v2.4H7.4v3.3h2.8V21z"/>'),
  tiktok: F('<path d="M16.6 2h-3.2v13.2a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .8.1V9.2a6 6 0 0 0-.8-.1 6 6 0 1 0 6 6V8.6a7.4 7.4 0 0 0 4.3 1.4V6.8A4.3 4.3 0 0 1 16.6 2z"/>'),
  depop: '<text x="12" y="17.5" text-anchor="middle" font-size="16" font-weight="800" fill="currentColor" font-family="-apple-system,Helvetica,Arial,sans-serif">d</text>',
  globe: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>'),
  image: S('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 16"/>'),
  calendar: S('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>'),
  trophy: S('<path d="M8 4h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6H4.5c0 3 1.5 4.6 3.8 4.9M16 6h3.5c0 3-1.5 4.6-3.8 4.9M12 13.2V17M8.5 20h7M10 17h4"/>'),
  shirt: F('<path stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M8.2 2.8L2 5.9l2.1 5 2.3-.9V21h11.2V10l2.3.9 2.1-5-6.2-3.1c-.6 1.6-2.1 2.6-3.8 2.6s-3.2-1-3.8-2.6z"/>'),
};
/** Static, trusted SVG markup only (never data from Firestore). */
function icon(name, size = 20, cls = '') {
  const s = el('span', { class: `pf-ico ${cls}`.trim(), 'aria-hidden': 'true' });
  s.style.width = s.style.height = `${size}px`;
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" focusable="false">${ICONS[name] || ''}</svg>`;
  return s;
}

// ---------------------------------------------------------------- dates

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  return null;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtMonthDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
function occKey(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
/** "8AM" / "2:30PM" — minutes are omitted when 00 (EventView.formattedMarketTime). */
function fmtShortTime(d) {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? ':' + pad(m) : ''}${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
/** Display-string times ("10:00AM") -> "10AM"; unknown formats are returned as-is. */
function normTime(s) {
  const m = str(s).match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (!m) return str(s);
  return `${Number(m[1])}${m[2] && m[2] !== '00' ? ':' + m[2] : ''}${m[3].toUpperCase()}M`;
}

/**
 * Mirrors Event.swift: occurrences pair `dates` with `times` by index and fall
 * back to the single `date`/`timeStart`/`timeEnd`. Returns [{date,start,end}] sorted.
 */
function occurrences(ev) {
  const dates = arr(ev.dates).map(toDate).filter(Boolean);
  const times = arr(ev.times);
  let list;
  if (dates.length) {
    list = dates.map((d, i) => ({ date: d, start: toDate(times[i]?.start), end: toDate(times[i]?.end) }));
  } else {
    const d = toDate(ev.date);
    list = d ? [{ date: d, start: null, end: null }] : [];
  }
  return list.sort((a, b) => a.date - b.date);
}
/** Future occurrences (today counts), per Event.futureOccurrenceDates. */
function upcoming(ev) {
  const today = startOfDay(new Date());
  return occurrences(ev).filter((o) => startOfDay(o.date) >= today);
}
/** [start, end] display strings for an occurrence, or null (EventView hoursText + dates/times pairing). */
function hoursParts(ev, o) {
  const a = o?.start || toDate(ev.timeStart);
  const b = o?.end || toDate(ev.timeEnd);
  if (a && b) return [fmtShortTime(a), fmtShortTime(b)];
  const sa = str(ev.timeStart); const sb = str(ev.timeEnd);
  return sa && sb ? [normTime(sa), normTime(sb)] : null;
}
function timeAgo(date) {
  const now = new Date();
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / 864e5);
  let years = now.getFullYear() - date.getFullYear();
  let months = years * 12 + now.getMonth() - date.getMonth();
  if (now.getDate() < date.getDate()) months -= 1;
  years = Math.floor(months / 12);
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''} ago`;
  if (years > 0) return plural(years, 'year');
  if (months > 0) return plural(months, 'month');
  if (days >= 7) return plural(Math.floor(days / 7), 'week');
  if (days <= 0) return 'Today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ---------------------------------------------------------------- data

/** Throws on errors; resolves null when the doc doesn't exist. */
async function fetchDocStrict(col, id) {
  const { db, doc, getDoc } = await loadFirebase();
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
/** Like fetchDocStrict but treats errors as "missing" (for secondary lookups). */
async function fetchDoc(col, id) {
  try {
    return await fetchDocStrict(col, id);
  } catch (e) {
    console.warn('fetch failed', col, id, e);
    return null;
  }
}
/** Batched `documentId() in [...]` reads (30 per query); missing/failed ids come back as {id,_missing:true}. */
async function fetchMany(col, ids, cap) {
  const unique = [...new Set(ids)].slice(-cap); // keep the newest
  if (!unique.length) return [];
  const found = new Map();
  try {
    const { db, query, collection, where, documentId, getDocs } = await loadFirebase();
    const chunks = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(query(collection(db, col), where(documentId(), 'in', chunk)));
        snap.docs.forEach((s) => found.set(s.id, { id: s.id, ...s.data() }));
      } catch (e) { console.warn('batch fetch failed', col, e); }
    }));
  } catch (e) { console.warn('batch fetch failed', col, e); }
  return unique.map((id) => found.get(id) || { id, _missing: true });
}
/**
 * Single source for been-to counts (publicProfiles doc): distinct valid map entries,
 * falling back to the *_been_to numbers when a map is absent. Used for the stats row AND badges.
 */
function beenCounts(p) {
  const n = (map, num) => (map && typeof map === 'object' ? parseBeenTo(map).length : Number(num) || 0);
  return {
    stores: n(p?.beenToStores, p?.stores_been_to),
    markets: n(p?.beenToEvents, p?.events_been_to),
    vendors: n(p?.beenToPopups, p?.popups_been_to),
  };
}
/** Badge tier input: stores + markets (vendors excluded). */
function placeCount(p) {
  if (!p) return 0;
  const c = beenCounts(p);
  return c.stores + c.markets;
}
async function fetchReviews(col, id) {
  try {
    const { db, query, collection, orderBy, limit, getDocs } = await loadFirebase();
    const q = query(collection(db, col, id, 'reviews'), orderBy('date', 'desc'), limit(50));
    const snap = await getDocs(q);
    const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const uids = [...new Set(reviews.map((r) => r.userId).filter(Boolean))];
    const profiles = {};
    (await fetchMany('publicProfiles', uids, 100)).forEach((p) => { if (!p._missing) profiles[p.id] = p; });
    reviews.forEach((r) => {
      const p = profiles[r.userId];
      r._known = !!p;
      r._name = str(p?.username) ? '@' + stripAt(p.username) : str(p?.display_name) || 'Thryft user';
      r._avatar = p?.profile_url;
      r._badge = p ? badgeFor(placeCount(p)) : null;
    });
    return reviews;
  } catch (e) {
    console.warn('reviews failed', e);
    return [];
  }
}
/**
 * Events a storefront vends at. The app writes a store's raw id into `events/{id}.vendors`
 * (EventViewModel arrayUnion(rawId)); `store_{id}` only appears inside `vendorsByDate`, which isn't
 * queryable by value. So: query `vendors array-contains id`, plus any ids on `store.events`.
 */
async function fetchStoreEvents(d) {
  const byId = new Map();
  try {
    const { db, query, collection, where, limit, getDocs } = await loadFirebase();
    const snap = await getDocs(query(collection(db, 'events'), where('vendors', 'array-contains', d.id), limit(30)));
    snap.docs.forEach((s) => byId.set(s.id, { id: s.id, ...s.data() }));
  } catch (e) {
    console.warn('store events lookup failed', e);
  }
  const missing = strList(d.events).filter((id) => !byId.has(id));
  (await fetchMany('events', missing, 20)).forEach((e) => { if (!e._missing) byId.set(e.id, e); });
  return [...byId.values()];
}

// ---------------------------------------------------------------- badges (ThriftBadge.swift)

const BADGES = [
  { max: 9, icon: '🥉', label: 'Rack Rookie' },
  { max: 24, icon: '🥈', label: 'Style Apprentice' },
  { max: 49, icon: '🥇', label: 'Vintage Veteran' },
  { max: 99, icon: '💎', label: 'Thrift Legend' },
  { max: Infinity, icon: '👑', label: 'Vintage Icon' },
];
const badgeFor = (total) => BADGES.find((b) => total <= b.max);
function badgePill(badge, compact = false) {
  return el('span', { class: 'pf-badge' + (compact ? ' pf-badge--sm' : '') },
    el('span', { class: 'pf-badge__i' }, badge.icon), badge.label);
}

// ---------------------------------------------------------------- app prompt (modal + deep link)

/** Anchor that deep-links into the app (iOS) or goes to the App Store. */
function appLink(label, review, cls) {
  const { kind, id } = current;
  const a = el('a', { class: cls || null, href: APP_STORE_URL }, label);
  if (isIOS()) {
    let timer = null;
    const cancel = () => {
      clearTimeout(timer); timer = null;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('blur', cancel);
    };
    const onVis = () => { if (document.hidden) cancel(); };
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      cancel(); // clear any previous attempt
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', cancel);
      window.addEventListener('blur', cancel);
      timer = setTimeout(() => { cancel(); window.location.href = APP_STORE_URL; }, 2000);
      window.location.href = `vintagefindr://${kind}/${encodeURIComponent(id)}${review ? '?review=1' : ''}`;
    });
  }
  return a;
}
function lockScroll(on) { document.documentElement.classList.toggle('pf-lock', on); }

/** The one shared "this needs the app" bottom sheet. */
function openAppSheet(copy, review = false) {
  const prevFocus = document.activeElement;
  const close = () => {
    back.remove(); lockScroll(false);
    document.removeEventListener('keydown', onKey);
    if (prevFocus?.focus) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const later = el('button', { class: 'pf-sheet__later', type: 'button', onclick: close }, 'Not now');
  const sheet = el('div', { class: 'pf-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Get the Thryft app' },
    el('div', { class: 'pf-sheet__grab' }),
    el('h2', { class: 'pf-sheet__title' }, 'Get the Thryft app'),
    el('p', { class: 'pf-sheet__copy' }, copy),
    appLink('Open in Thryft', review, 'pf-btn'),
    later);
  const back = el('div', { class: 'pf-overlay', onclick: (e) => { if (e.target === back) close(); } }, sheet);
  document.body.append(back);
  lockScroll(true);
  document.addEventListener('keydown', onKey);
  later.focus();
}

// ---------------------------------------------------------------- lightbox + toast

function openLightbox(urls, start = 0) {
  const list = urls.filter(Boolean);
  if (!list.length) return;
  let i = Math.min(Math.max(start, 0), list.length - 1);
  const prevFocus = document.activeElement;
  const img = el('img', { class: 'pf-lb__img', alt: '' });
  const show = () => { img.src = list[i]; prev.hidden = next.hidden = list.length < 2; };
  const step = (n) => { i = (i + n + list.length) % list.length; show(); };
  const close = () => {
    box.remove(); lockScroll(false);
    document.removeEventListener('keydown', onKey);
    if (prevFocus?.focus) prevFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && list.length > 1) step(-1);
    else if (e.key === 'ArrowRight' && list.length > 1) step(1);
  };
  const xBtn = el('button', { class: 'pf-lb__btn pf-lb__x', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close', 22));
  const prev = el('button', { class: 'pf-lb__btn pf-lb__prev', type: 'button', 'aria-label': 'Previous', onclick: (e) => { e.stopPropagation(); step(-1); } }, icon('chevL', 24));
  const next = el('button', { class: 'pf-lb__btn pf-lb__next', type: 'button', 'aria-label': 'Next', onclick: (e) => { e.stopPropagation(); step(1); } }, icon('chevR', 24));
  const box = el('div', { class: 'pf-lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer', onclick: (e) => { if (e.target !== img && !e.target.closest('.pf-lb__btn')) close(); } },
    img, xBtn, prev, next);
  document.body.append(box);
  lockScroll(true);
  document.addEventListener('keydown', onKey);
  show();
  xBtn.focus();
}

let toastTimer = null;
function toast(msg) {
  document.querySelector('.pf-toast')?.remove();
  const t = el('div', { class: 'pf-toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2200);
}
async function copyLink() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
  } catch (_) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = url; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (__) { /* ignore */ }
    ta.remove();
  }
  toast('Link copied');
}
async function shareLink(title) {
  if (navigator.share) {
    try { await navigator.share({ title, url: location.href }); } catch (_) { /* cancelled */ }
  } else {
    await copyLink();
  }
}

// ---------------------------------------------------------------- maps

const MAP_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const MAP_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const coords = (d) => {
  const lat = Number(d.latitude); const lng = Number(d.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
/** Non-interactive Leaflet map with the Thryft green dot (fallback path). Returns { refresh, destroy }. */
async function leafletMap(box, c, zoom) {
  const L = await loadLeaflet();
  const m = L.map(box, {
    zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
    boxZoom: false, keyboard: false, touchZoom: false, tap: false, attributionControl: true,
  }).setView([c.lat, c.lng], zoom);
  L.tileLayer(MAP_TILES, { subdomains: 'abcd', maxZoom: 19, attribution: MAP_ATTR }).addTo(m);
  L.marker([c.lat, c.lng], {
    icon: L.divIcon({ className: 'pf-dot-wrap', html: '<span class="pf-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    interactive: false, keyboard: false,
  }).addTo(m);
  return { refresh: () => m.invalidateSize(), destroy: () => m.remove() };
}
/** Non-interactive Apple MapKit JS map with the Thryft green dot. Returns { refresh, destroy }. */
async function appleMap(box, c, zoom) {
  const mk = await loadMapKit();
  if (mapkitBroken) throw new Error('mapkit unavailable');
  const map = new mk.Map(box, {
    center: new mk.Coordinate(c.lat, c.lng),
    cameraDistance: zoom >= 15 ? 800 : 1500, // roughly Leaflet zoom 15 / 14
    isScrollEnabled: false, isZoomEnabled: false, isRotationEnabled: false, isPitchEnabled: false,
    showsCompass: mk.FeatureVisibility.Hidden, showsZoomControl: false, showsMapTypeControl: false,
    showsScale: mk.FeatureVisibility.Hidden, showsPointsOfInterest: true,
    colorScheme: mk.Map.ColorSchemes.Light, mapType: mk.Map.MapTypes.Standard,
  });
  const dot = new mk.Annotation(new mk.Coordinate(c.lat, c.lng), () => el('span', { class: 'pf-dot' }), {
    // MapKit anchors bottom-centre; shift by half the 26px dot to centre it.
    anchorOffset: new DOMPoint(0, 13), enabled: false, selected: false,
  });
  map.addAnnotation(dot);
  return { refresh() { /* MapKit resizes itself */ }, destroy: () => map.destroy() };
}
/** Non-interactive map (MapKit on production, Leaflet elsewhere or on failure); initialised after the node is mounted. */
function mapBox(c, zoom, cls) {
  const box = el('div', { class: `pf-map ${cls || ''}`.trim(), 'aria-hidden': 'true' });
  const entry = { refresh() {}, destroy() {} };
  maps.push(entry);
  const useLeaflet = async () => {
    try {
      Object.assign(entry, await leafletMap(box, c, zoom));
    } catch (e) {
      console.warn('map failed', e);
      box.classList.add('pf-map--fail');
    }
  };
  afterMount(async () => {
    if (mapkitBroken || !(await getMapKitToken())) return useLeaflet();
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      mapkitErrorHandlers.delete(fallback);
      try { entry.destroy(); } catch (_) { /* ignore */ }
      entry.refresh = () => {}; entry.destroy = () => {};
      box.replaceChildren();
      useLeaflet();
    };
    mapkitErrorHandlers.add(fallback);
    try {
      const apple = await appleMap(box, c, zoom);
      if (fellBack) apple.destroy(); else Object.assign(entry, apple);
    } catch (e) {
      console.warn('mapkit failed, falling back', e);
      fallback();
    }
  });
  return box;
}
function mapsHref(d, c) {
  const name = str(d.name) || str(d.address) || 'Thryft';
  const addr = [str(d.address), placeOf(d)].filter(Boolean).join(', ');
  if (isApple()) {
    return c ? `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${c.lat},${c.lng}`
      : `https://maps.apple.com/?q=${encodeURIComponent(addr || name)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c ? `${c.lat},${c.lng}` : addr || name)}`;
}

// ---------------------------------------------------------------- US state codes (USStateLookup)

const STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};
const stateCode = (s) => {
  const t = str(s).split(',')[0].trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_CODES[t.toLowerCase()] || '';
};

// ---------------------------------------------------------------- shared UI pieces

const sectionTitle = (text) => el('h2', { class: 'pf-h' }, text);
const sec = (title, ...body) => el('section', { class: 'pf-sec' }, title && sectionTitle(title), body);
const card = (cls, ...children) => el('div', { class: `pf-card ${cls || ''}`.trim() }, children);

/** Frosted-glass circular header button. */
function glassBtn(iconName, label, onclick, cls = '') {
  return el('button', { class: `pf-gbtn ${cls}`.trim(), type: 'button', 'aria-label': label, onclick }, icon(iconName, 22));
}

/**
 * Full-bleed header (ProfileHeroHeaderView): background, star/(more) buttons,
 * name pill (optionally with a flyer thumbnail) and the "been here" button.
 */
function heroHeader({ bg, title, kind, flyer, more }) {
  const noun = KINDS[kind].noun;
  const top = el('div', { class: 'pf-hero__row pf-hero__row--top' },
    el('div', { class: 'pf-hero__right' },
      more && moreMenu(title),
      glassBtn('star', 'Favorite', () => openAppSheet(`Save this ${noun} to your favorites in the Thryft app.`))));
  let pill;
  if (flyer) {
    const sub = el('span', { class: 'pf-pill__sub' }, 'Tap to expand flyer');
    pill = el('button', { class: 'pf-namepill pf-namepill--flyer', type: 'button', 'aria-label': `${title} — expand flyer`, onclick: () => openLightbox([flyer]) },
      withBg(el('span', { class: 'pf-flyer' }, icon('image', 16)), flyer),
      el('span', { class: 'pf-pill__txt' }, el('span', { class: 'pf-pill__name' }, title), sub));
  } else {
    pill = el('div', { class: 'pf-namepill' }, el('span', { class: 'pf-pill__name' }, title));
  }
  const bottom = el('div', { class: 'pf-hero__row pf-hero__row--bottom' },
    pill, glassBtn('check', 'Been here', () => openAppSheet('Mark that you have been here in the Thryft app.')));
  return el('header', { class: 'pf-hero' }, bg, el('div', { class: 'pf-hero__ui' }, top, bottom));
}
function moreMenu(title) {
  const menu = el('div', { class: 'pf-menu', role: 'menu' });
  menu.hidden = true;
  const item = (label, fn) => el('button', { class: 'pf-menu__item', type: 'button', role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, label);
  menu.append(item('Share', () => shareLink(title)), item('Copy link', copyLink));
  const btn = glassBtn('more', 'More options', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  btn.setAttribute('aria-haspopup', 'menu');
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true; });
  return el('div', { class: 'pf-more-wrap' }, btn, menu);
}
/** Hero background: map when coordinates exist, otherwise image or cream gradient. */
function heroBg({ image, c, allowMap = true }) {
  if (image) return withBg(el('div', { class: 'pf-hero__bg pf-hero__img' }), image);
  if (allowMap && c) return mapBox(c, 14, 'pf-hero__bg');
  return el('div', { class: 'pf-hero__bg pf-hero__empty' });
}

/** Segmented glass tab bar + panels. `defs` = [{id,label,node}]. */
function tabs(defs) {
  const ids = defs.map((t) => t.id);
  const bar = el('div', { class: 'pf-tabs', role: 'tablist' });
  const buttons = {};
  const panels = {};
  const select = (id, fromUser) => {
    ids.forEach((k) => {
      const on = k === id;
      buttons[k].classList.toggle('is-on', on);
      buttons[k].setAttribute('aria-selected', on ? 'true' : 'false');
      buttons[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (fromUser) {
      try { history.replaceState(null, '', `${location.pathname}${location.search}#${id}`); } catch (_) { /* ignore */ }
    }
    maps.forEach((m) => m.refresh());
    runLayout();
  };
  defs.forEach((t) => {
    buttons[t.id] = el('button', { class: 'pf-tab', type: 'button', role: 'tab', id: `pf-tab-${t.id}`, 'aria-controls': `pf-panel-${t.id}`,
      onclick: () => select(t.id, true),
      onkeydown: (e) => {
        const j = ids.indexOf(t.id) + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
        if (j !== ids.indexOf(t.id) && ids[j]) { select(ids[j], true); buttons[ids[j]].focus(); }
      } }, t.label);
    panels[t.id] = el('div', { class: 'pf-panel', role: 'tabpanel', id: `pf-panel-${t.id}`, 'aria-labelledby': `pf-tab-${t.id}` }, t.node);
    bar.append(buttons[t.id]);
  });
  const wanted = location.hash.replace('#', '');
  select(ids.includes(wanted) ? wanted : ids[0], false);
  return { bar: el('div', { class: 'pf-col pf-tabs-wrap' }, bar), panels: Object.values(panels) };
}

/** Standard page: header, tab bar, then the panels (and the ?review=1 banner). */
function page(hero, tabSet, review) {
  const banner = review && el('div', { class: 'pf-banner' }, 'Been here? Leave a review in the Thryft app.');
  return [hero, tabSet.bar, el('main', { class: 'pf-col pf-main' }, banner, tabSet.panels)];
}

// -- tags, location chip, description

const tag = (text, loc) => el('span', { class: 'pf-tag' + (loc ? ' pf-tag--loc' : '') }, loc && icon('loc', 12), text);
/** Location pill; with extra cities it shows "City, ST +N" and expands to one pill per city on tap. */
function locationChip(primary, extras = []) {
  if (!primary) return null;
  const row = el('div', { class: 'pf-chiprow' });
  let open = false;
  const draw = () => {
    row.replaceChildren();
    if (open && extras.length) [primary, ...extras].forEach((t) => row.append(tag(t, true)));
    else row.append(tag(extras.length ? `${primary} +${extras.length}` : primary, true));
  };
  if (extras.length) {
    row.classList.add('is-tap');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.addEventListener('click', () => { open = !open; draw(); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open = !open; draw(); } });
  }
  draw();
  return row;
}
/** White card: description (4-line clamp + Read More), location pill, tags. */
function descriptionCard(text, chip, tags) {
  const t = str(text);
  const p = el('p', { class: 'pf-desc' + (t ? '' : ' pf-desc--empty') }, t || 'No description added yet.');
  const more = el('button', { class: 'pf-more', type: 'button' }, 'Read More');
  more.hidden = true;
  more.addEventListener('click', () => {
    const open = p.classList.toggle('pf-desc--open');
    more.textContent = open ? 'Show Less' : 'Read More';
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  if (t) {
    onLayout(() => {
      if (p.classList.contains('pf-desc--open') || !p.clientHeight) return;
      more.hidden = p.scrollHeight <= p.clientHeight + 1;
    });
  }
  const tagList = strList(tags);
  return card('pf-card--desc', p, more, chip,
    tagList.length > 0 && el('div', { class: 'pf-tags' }, tagList.map((x) => tag(x))));
}

// -- connect tiles

function connectSection(d) {
  const tiles = [];
  const add = (cls, ico, label, href, size = 26) => {
    if (!href) return;
    tiles.push(el('a', { class: `pf-social pf-social--${cls}`, href, target: '_blank', rel: 'noopener', 'aria-label': label }, icon(ico, size)));
  };
  const digits = str(d.phone).replace(/\D/g, '');
  add('phone', 'phone', 'Call', digits && `tel:${digits}`, 24);
  const ig = stripAt(d.instagram_username), fbk = stripAt(d.facebook_username),
    tt = stripAt(d.tiktok_username), dp = stripAt(d.depop_username);
  add('instagram', 'instagram', 'Instagram', ig && `https://www.instagram.com/${encodeURIComponent(ig)}`);
  add('facebook', 'facebook', 'Facebook', fbk && `https://www.facebook.com/${encodeURIComponent(fbk)}`);
  add('tiktok', 'tiktok', 'TikTok', tt && `https://www.tiktok.com/@${encodeURIComponent(tt)}`);
  add('depop', 'depop', 'Depop', dp && `https://www.depop.com/${encodeURIComponent(dp)}`);
  let web = str(d.website);
  if (web && !/^https?:\/\//i.test(web)) web = 'https://' + web;
  add('website', 'globe', 'Website', safeUrl(web), 24);
  return tiles.length ? sec('CONNECT', el('div', { class: 'pf-socials' }, tiles)) : null;
}

// -- upcoming markets list (store / vendor)

function marketsSection(events) {
  const items = events.map((e) => ({ e, next: upcoming(e)[0] })).filter((x) => x.next)
    .sort((a, b) => a.next.date - b.next.date).slice(0, 5);
  if (!items.length) return sec('UPCOMING MARKETS ATTENDING', el('p', { class: 'pf-plain' }, 'No upcoming markets yet.'));
  return sec('UPCOMING MARKETS ATTENDING', card('pf-list',
    items.map(({ e, next }) => {
      const hp = hoursParts(e, next);
      const when = fmtDay(next.date) + (hp ? `  •  ${hp[0]} – ${hp[1]}` : '');
      return el('a', { class: 'pf-lrow', href: `/m/${encodeURIComponent(e.id)}` },
        thumb(strList(e.image_url)[0], 'pf-thumb--42', 'calendar'),
        el('div', { class: 'pf-lrow__txt' }, el('b', {}, str(e.name) || 'Market'), el('span', {}, when)),
        icon('chevR', 14, 'pf-chev'));
    })));
}

// -- location card

function locationSection(d, { venue, addr }) {
  const c = coords(d);
  if (!venue && !addr && !c) return null;
  const href = mapsHref(d, c);
  const row = el('a', { class: 'pf-locrow', href, target: '_blank', rel: 'noopener' },
    icon('pin', 22, 'pf-locrow__pin'),
    el('div', { class: 'pf-locrow__txt' }, el('b', {}, venue || addr), venue && addr && el('span', {}, addr)),
    icon('chevR', 14, 'pf-chev'));
  const map = c && el('a', { class: 'pf-locmap', href, target: '_blank', rel: 'noopener', 'aria-label': 'Open in Maps', tabindex: '-1' }, mapBox(c, 15, 'pf-map--small'));
  return sec('LOCATION', card('pf-card--flush', row, map));
}
const addressLine = (d) => [str(d.address), placeOf(d)].filter(Boolean).join(', ');

// -- gallery tab

function galleryPanel(d) {
  const urls = strList(d.image_url).map(storageUrl).filter(Boolean);
  if (!urls.length) return el('p', { class: 'pf-plain pf-plain--c' }, 'No photos yet.');
  return el('div', { class: 'pf-grid' }, urls.map((u, i) => {
    const img = el('img', { src: u, alt: '', loading: 'lazy' });
    img.onload = () => img.classList.add('is-in');
    img.onerror = () => img.remove();
    return el('button', { class: 'pf-gtile', type: 'button', 'aria-label': `Photo ${i + 1}`, onclick: () => openLightbox(urls, i) }, icon('image', 28), img);
  }));
}

// -- reviews tab

function shirts(rating, size, interactive) {
  const r = Math.round(Number(rating) || 0);
  const wrap = el('span', { class: 'pf-shirts' + (interactive ? ' pf-shirts--tap' : ''), 'aria-label': interactive ? null : `${r} of 5` });
  for (let i = 1; i <= 5; i++) {
    const s = icon('shirt', size, i <= r ? 'is-on' : '');
    if (interactive) {
      const b = el('button', { class: 'pf-shirtbtn', type: 'button', 'aria-label': `Rate ${i} out of 5`, onclick: () => openAppSheet('Rate your visit in the Thryft app.', true) }, s);
      wrap.append(b);
    } else wrap.append(s);
  }
  return wrap;
}
function emptyReviews() {
  return el('div', { class: 'pf-empty' },
    el('div', { class: 'pf-empty__e', 'aria-hidden': 'true' }, '🤩'),
    el('h3', {}, 'New on Thryft!'),
    el('p', {}, 'No ratings yet. Be the first to share what you think.'));
}
function reviewCard(r) {
  const date = toDate(r.date);
  const name = r._name || 'Thryft user';
  const who = r._known && r.userId ? el('a', { class: 'pf-rev__name', href: `/u/${encodeURIComponent(r.userId)}` }, name) : el('span', { class: 'pf-rev__name' }, name);
  const text = str(r.text);
  const words = text.split(/\s+/).filter(Boolean);
  const body = el('p', { class: 'pf-rev__text' });
  let open = false;
  const toggle = el('button', { class: 'pf-rev__more', type: 'button' }, 'More');
  const draw = () => {
    body.textContent = open || words.length <= 30 ? text : words.slice(0, 30).join(' ') + '…';
    toggle.textContent = open ? 'Less' : 'More';
  };
  toggle.addEventListener('click', () => { open = !open; draw(); });
  if (text) draw(); else { body.textContent = 'No written note.'; body.classList.add('is-none'); }
  const imgs = strList(r.image_urls).map(storageUrl).filter(Boolean);
  return el('article', { class: 'pf-card pf-rev' },
    el('div', { class: 'pf-rev__head' },
      avatar(r._avatar, name, 'pf-avatar--46'),
      el('div', { class: 'pf-rev__who' }, who, r._badge && badgePill(r._badge, true))),
    el('div', { class: 'pf-rev__rate' }, shirts(r.rating, 22), date && el('span', {}, timeAgo(date))),
    body, words.length > 30 && toggle,
    imgs.length > 0 && el('div', { class: 'pf-rev__imgs' }, imgs.map((u, i) =>
      withBg(el('button', { class: 'pf-thumb pf-thumb--84', type: 'button', 'aria-label': 'Review photo', onclick: () => openLightbox(imgs, i) }, icon('image', 18)), u))));
}
function reviewsPanel(d, reviews) {
  const prompt = card('pf-prompt',
    el('h3', {}, 'How was it?'),
    el('p', {}, 'Tap a shirt to rate your visit'),
    shirts(0, 40, true));
  const count = Number(d.reviews) || reviews.length;
  const avg = Number(d.rating) || (reviews.length ? reviews.reduce((a, r) => a + (Number(r.rating) || 0), 0) / reviews.length : 0);
  const summary = count > 0 && avg > 0 && card('pf-sum',
    el('b', {}, avg.toFixed(1)),
    el('div', {}, shirts(avg, 16), el('span', {}, `${count} ${count === 1 ? 'rating' : 'ratings'}`)));
  return el('div', { class: 'pf-stack' }, prompt, reviews.length ? [summary, reviews.map(reviewCard)] : emptyReviews());
}

// ---------------------------------------------------------------- per-entity renderers

const heroImageOf = (d) => [d.hero_image_url, ...strList(d.image_url)].map(storageUrl).find(Boolean) || '';
const firstImageOf = (d) => strList(d.image_url).map(storageUrl).find(Boolean) || '';

async function renderStore(d, r) {
  const [reviews, events] = await Promise.all([fetchReviews('stores', d.id), fetchStoreEvents(d)]);
  // Cities the storefront vends in, excluding its own address city (StoreOverviewTabContent.vendingCityLabels).
  const own = `${str(d.city).toLowerCase()}|${(stateCode(d.state) || str(d.state)).toLowerCase()}`;
  const seen = new Set([own]);
  const extras = [];
  arr(d.vending_cities).forEach((c) => {
    const city = str(c?.city); const st = str(c?.state);
    const key = `${city.toLowerCase()}|${st.toLowerCase()}`;
    if (!city || !st || seen.has(key)) return;
    seen.add(key); extras.push(`${city}, ${st}`);
  });
  const chip = str(d.city) ? locationChip(placeOf(d), extras) : null;
  const overview = el('div', { class: 'pf-stack' },
    descriptionCard(d.description, chip, d.store_tags),
    marketsSection(events),
    connectSection(d),
    locationSection(d, { addr: addressLine(d) }));
  const c = coords(d);
  const hero = heroHeader({
    kind: 's', title: str(d.name) || 'Storefront',
    bg: heroBg({ image: storageUrl(d.hero_image_url) || (c ? '' : firstImageOf(d)), c }),
  });
  const t = tabs([
    { id: 'overview', label: 'Overview', node: overview },
    { id: 'gallery', label: 'Gallery', node: galleryPanel(d) },
    { id: 'reviews', label: 'Reviews', node: reviewsPanel(d, reviews) },
  ]);
  return { name: str(d.name), desc: str(d.description), image: heroImageOf(d), nodes: page(hero, t, r.review) };
}

async function renderVendor(d, r) {
  const [reviews, events] = await Promise.all([
    fetchReviews('popups', d.id),
    fetchMany('events', strList(d.events), 10),
  ]);
  let extras = strList(d.additional_cities).map((s) => s.trim());
  if (!extras.length) {
    const own = str(d.city).toLowerCase();
    extras = arr(d.vending_cities).map((c) => [str(c?.city), str(c?.state)].filter(Boolean).join(', '))
      .filter((s) => s && s.split(',')[0].trim().toLowerCase() !== own);
  }
  const chip = str(d.city) ? locationChip(placeOf(d), extras) : null;
  const overview = el('div', { class: 'pf-stack' },
    descriptionCard(d.description, chip, d.vendor_tags),
    marketsSection(events.filter((e) => !e._missing)),
    connectSection(d));
  const hero = heroHeader({
    kind: 'v', title: str(d.name) || 'Vendor',
    bg: heroBg({ image: heroImageOf(d), allowMap: false }),
  });
  const t = tabs([
    { id: 'overview', label: 'Overview', node: overview },
    { id: 'gallery', label: 'Gallery', node: galleryPanel(d) },
    { id: 'reviews', label: 'Reviews', node: reviewsPanel(d, reviews) },
  ]);
  return { name: str(d.name), desc: str(d.vendor_tagline) || str(d.description), image: heroImageOf(d), nodes: page(hero, t, r.review) };
}

/**
 * Resolve roster refs ("vendor_<id>", "store_<id>", or plain IDs/names) into `cache` (ref -> item|null),
 * batching reads per collection. Already-cached refs are skipped.
 */
async function resolveRefs(refs, cache) {
  const looksLikeId = (x) => /^[A-Za-z0-9]{15,}$/.test(x);
  const todo = [...new Set(refs)].filter((x) => !cache.has(x)).slice(0, 150);
  const popupIds = new Set(); const storeIds = new Set();
  todo.forEach((ref) => {
    if (ref.startsWith('vendor_')) popupIds.add(ref.slice(7));
    else if (ref.startsWith('store_')) storeIds.add(ref.slice(6));
    else if (looksLikeId(ref)) popupIds.add(ref);
  });
  const popups = new Map((await fetchMany('popups', [...popupIds], 150)).filter((x) => !x._missing).map((x) => [x.id, x]));
  // Unprefixed legacy IDs not found in popups may be stores.
  todo.forEach((ref) => { if (!ref.startsWith('vendor_') && !ref.startsWith('store_') && looksLikeId(ref) && !popups.has(ref)) storeIds.add(ref); });
  const stores = new Map((await fetchMany('stores', [...storeIds], 150)).filter((x) => !x._missing).map((x) => [x.id, x]));
  todo.forEach((ref) => {
    let item = null;
    if (ref.startsWith('vendor_')) { const id = ref.slice(7); item = popups.has(id) ? { kind: 'v', id, data: popups.get(id) } : null; }
    else if (ref.startsWith('store_')) { const id = ref.slice(6); item = stores.has(id) ? { kind: 's', id, data: stores.get(id) } : null; }
    else if (!looksLikeId(ref)) item = { name: ref };
    else if (popups.has(ref)) item = { kind: 'v', id: ref, data: popups.get(ref) };
    else if (stores.has(ref)) item = { kind: 's', id: ref, data: stores.get(ref) };
    cache.set(ref, item);
  });
}

async function renderMarket(d, r) {
  const occ = occurrences(d);
  const up = upcoming(d);
  const choices = up.length ? up : occ.slice(-1);
  const byDate = d.vendorsByDate && typeof d.vendorsByDate === 'object' ? d.vendorsByDate : {};
  const hasByDate = Object.keys(byDate).length > 0;
  const refsFor = (key) => (hasByDate ? strList(byDate[key]) : strList(d.vendors)).slice(0, 100);
  const resolved = new Map(); // ref -> item|null, filled lazily per selected date
  // Resolved, displayable vendors for a date: the single count behind VENDORS and CONFIRMED.
  const itemsFor = (key) => refsFor(key).map((ref) => resolved.get(ref)).filter(Boolean);

  let sel = choices[0] || null;
  const selKey = () => (sel ? occKey(sel.date) : '');
  const [reviews] = await Promise.all([fetchReviews('events', d.id), resolveRefs(refsFor(selKey()), resolved)]);

  // -- stat tiles (NEXT DATE / HOURS / VENDORS)
  const stats = el('div', { class: 'pf-stats3' });
  const drawStats = () => {
    const date = sel?.date || toDate(d.date);
    const hp = hoursParts(d, sel);
    const count = itemsFor(selKey()).length;
    const tile = (value, label) => el('div', { class: 'pf-stat3' }, el('b', {}, value), el('span', {}, label));
    stats.replaceChildren(
      tile(date ? fmtMonthDay(date) : 'TBD', up.length ? 'NEXT DATE' : 'LAST DATE'),
      tile(hp ? `${hp[0]}-${hp[1]}` : '—', 'HOURS'),
      tile(String(count), 'VENDORS'));
  };

  // -- upcoming date tiles (only for markets with a dates[] list, like the app)
  let datesSec = null;
  const hasUpcomingDates = arr(d.dates).map(toDate).filter(Boolean).some((x) => startOfDay(x) >= startOfDay(new Date()));
  const tileBtns = [];
  if (hasUpcomingDates && up.length) {
    const select = async (o) => {
      sel = o;
      tileBtns.forEach(([b, oo]) => { b.classList.toggle('is-on', oo === o); b.setAttribute('aria-pressed', oo === o ? 'true' : 'false'); });
      await resolveRefs(refsFor(occKey(o.date)), resolved);
      if (sel !== o) return; // a newer tap won
      drawStats(); drawVendors();
    };
    const row = el('div', { class: 'pf-dates' }, up.map((o) => {
      const b = el('button', { class: 'pf-date', type: 'button', onclick: () => select(o),
        'aria-label': fmtDay(o.date) },
      el('span', { class: 'pf-date__m' }, o.date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()),
      el('span', { class: 'pf-date__d' }, String(o.date.getDate())));
      tileBtns.push([b, o]);
      return b;
    }));
    datesSec = sec('UPCOMING DATES', row);
  }

  // -- vendors tab
  const vendors = el('div', { class: 'pf-stack' });
  let showAll = false;
  const drawVendors = () => {
    const items = itemsFor(selKey());
    const shown = showAll ? items : items.slice(0, 4);
    const list = items.length ? card('pf-vlist',
      shown.map((it) => {
        if (!it.data) return el('div', { class: 'pf-vrow' }, el('div', { class: 'pf-lrow__txt' }, el('b', {}, it.name)));
        const label = it.kind === 's' ? 'Store' : 'Vendor';
        return el('a', { class: 'pf-vrow', href: `/${it.kind}/${encodeURIComponent(it.id)}` },
          thumb(firstImageOf(it.data) , 'pf-thumb--42'),
          el('div', { class: 'pf-lrow__txt' }, el('b', {}, str(it.data.name) || label), placeOf(it.data) && el('span', {}, placeOf(it.data))),
          el('span', { class: `pf-type pf-type--${it.kind === 's' ? 'store' : 'vendor'}` }, label),
          icon('chevR', 14, 'pf-chev'));
      }),
      items.length > 4 && el('button', { class: 'pf-showmore', type: 'button', onclick: () => { showAll = !showAll; drawVendors(); } },
        showAll ? 'Show Less' : 'Show More', icon(showAll ? 'chevU' : 'chevD', 14))) : null;
    vendors.replaceChildren(
      sec(`CONFIRMED · ${items.length}`,
        items.length ? list : el('p', { class: 'pf-plain pf-plain--c' }, "The event owner hasn't added any vendor information to Thryft yet. Please check their social media for updates.")),
      el('button', { class: 'pf-btn pf-btn--block', type: 'button', onclick: () => openAppSheet('Request to join this market as a vendor in the Thryft app.') }, 'Request to Join as Vendor'));
  };
  drawStats();
  drawVendors();
  tileBtns.forEach(([b, o]) => { b.classList.toggle('is-on', o === sel); b.setAttribute('aria-pressed', o === sel ? 'true' : 'false'); });

  // -- overview
  const mapUrl = storageUrl(d.vendorMapUrl);
  const vendorMap = mapUrl && (() => {
    const img = el('img', { src: mapUrl, alt: 'Vendor map', loading: 'lazy' });
    const holder = el('button', { class: 'pf-vmap', type: 'button', 'aria-label': 'Expand vendor map', onclick: () => openLightbox([mapUrl]) }, img);
    const s = sec('VENDOR MAP', holder);
    img.onerror = () => s.remove();
    return s;
  })();
  const venue = str(d.venueName);
  const overview = el('div', { class: 'pf-stack' },
    stats,
    descriptionCard(d.description, str(d.city) ? locationChip(placeOf(d)) : null, d.market_tags),
    datesSec,
    vendorMap,
    connectSection(d),
    locationSection(d, { venue, addr: addressLine(d) }));

  const c = coords(d);
  const flyer = storageUrl(d.flyerUrl) || firstImageOf(d);
  const hero = heroHeader({
    kind: 'm', title: str(d.name) || 'Market', flyer, more: true,
    bg: heroBg({ image: storageUrl(d.hero_image_url), c }),
  });
  const t = tabs([
    { id: 'overview', label: 'Overview', node: overview },
    { id: 'vendors', label: 'Vendors', node: vendors },
    { id: 'reviews', label: 'Reviews', node: reviewsPanel(d, reviews) },
  ]);
  return { name: str(d.name), desc: str(d.description), image: storageUrl(d.flyerUrl) || heroImageOf(d), nodes: page(hero, t, r.review) };
}

// -- user profile

const RATING_LABELS = { 5: 'Must Visit', 4: 'Good', 3: 'Okay', 2: 'Decent' };
/** publicProfiles beenTo map -> [{id,rating,date,text}] (entries need rating, date, text, like BeenToEntry). */
function parseBeenTo(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map).map(([id, e]) => {
    const date = toDate(e?.date);
    if (!e || typeof e.rating !== 'number' || !date || typeof e.text !== 'string') return null;
    return { id, rating: e.rating, date, text: e.text };
  }).filter(Boolean);
}
function beenShirts(rating) {
  const r = Math.min(5, Math.max(0, Math.round(rating)));
  const wrap = el('span', { class: 'pf-shirts pf-shirts--row' });
  for (let i = 1; i <= 5; i++) wrap.append(icon('shirt', 14, i <= r ? 'is-on' : ''));
  return el('span', { class: 'pf-beenrate' }, wrap, el('span', {}, `· ${RATING_LABELS[r] || 'Skip It'}`));
}
function beenRow(item) {
  const { data, entry, kind } = item;
  const isEvent = kind === 'm';
  const eventDate = isEvent ? (toDate(data.date) || occurrences(data)[0]?.date) : null;
  const dateLabel = eventDate ? fmtMonthDay(eventDate) : '';
  const sub = isEvent ? [dateLabel, placeOf(data)].filter(Boolean).join(' · ') : placeOf(data);
  return el('a', { class: 'pf-card pf-been', href: `/${kind}/${encodeURIComponent(data.id)}` },
    thumb(firstImageOf(data), 'pf-thumb--60'),
    el('div', { class: 'pf-been__txt' },
      el('b', {}, str(data.name) || (isEvent ? 'Market' : 'Store')),
      sub && el('span', { class: 'pf-been__sub' }, sub),
      beenShirts(entry.rating),
      str(entry.text) && el('i', {}, `“${str(entry.text)}”`)));
}

async function renderUser(d, r) {
  const handle = str(d.username) ? '@' + stripAt(d.username) : '';
  const display = str(d.display_name);
  const title = handle || display || 'Thryft user';
  const place = placeOf(d);

  const entries = { stores: parseBeenTo(d.beenToStores), popups: parseBeenTo(d.beenToPopups), events: parseBeenTo(d.beenToEvents) };
  const { stores: nStores, markets: nMarkets, vendors: nVendors } = beenCounts(d);
  const badge = badgeFor(placeCount(d)); // same function as the review-card badges

  // Hydrate the newest entries of each kind (same collections the app reads).
  const newest = (list) => [...list].sort((a, b) => b.date - a.date).slice(0, 40);
  const hydrate = async (col, list) => {
    const docs = await fetchMany(col, newest(list).map((e) => e.id), 40);
    const byId = new Map(docs.filter((x) => !x._missing).map((x) => [x.id, x]));
    return list.filter((e) => byId.has(e.id)).map((e) => ({ id: e.id, entry: e, data: byId.get(e.id) }));
  };
  const [stores, popups, events] = await Promise.all([
    hydrate('stores', entries.stores), hydrate('popups', entries.popups), hydrate('events', entries.events)]);
  const marketItems = events.map((x) => ({ ...x, kind: 'm', col: 'events' }));
  const storeItems = [...stores.map((x) => ({ ...x, kind: 's', col: 'stores' })), ...popups.map((x) => ({ ...x, kind: 'v', col: 'popups' }))];

  // "Top Rated" uses the helpful count on this user's own review; loaded lazily on first use.
  const helpful = new Map();
  let helpfulLoad = null;
  const KIND_OF = { stores: 's', popups: 'v', events: 'm' };
  // ONE collection-group query for all of this user's reviews (needs the reviews.userId CG index).
  const loadHelpful = () => {
    helpfulLoad ||= (async () => {
      try {
        const { db, query, collectionGroup, where, getDocs } = await loadFirebase();
        const snap = await getDocs(query(collectionGroup(db, 'reviews'), where('userId', '==', d.id)));
        snap.docs.forEach((s) => {
          const parent = s.ref.parent.parent; // stores/{id} | popups/{id} | events/{id}
          const kind = parent && KIND_OF[parent.parent.id];
          if (kind) helpful.set(`${kind}:${parent.id}`, Number(s.data().helpful) || 0);
        });
        return true;
      } catch (e) {
        console.warn('top-rated lookup failed; keeping Recent order', e);
        return false;
      }
    })();
    return helpfulLoad;
  };
  const sorted = (list, mode) => [...list].sort((a, b) => {
    if (mode === 'top') {
      const diff = (helpful.get(`${b.kind}:${b.id}`) || 0) - (helpful.get(`${a.kind}:${a.id}`) || 0);
      if (diff) return diff;
    }
    return b.entry.date - a.entry.date;
  });

  let mode = 'recent';
  const content = el('div', { class: 'pf-been-list' });
  const draw = () => {
    const m = sorted(marketItems, mode); const s = sorted(storeItems, mode);
    content.replaceChildren();
    if (!m.length && !s.length) {
      content.append(el('p', { class: 'pf-plain pf-plain--c pf-plain--tall' }, "Hasn't rated a store or market yet."));
      return;
    }
    if (m.length) content.append(el('h2', { class: 'pf-h' }, `MARKETS · ${m.length}`), m.map(beenRow));
    if (s.length) content.append(el('h2', { class: 'pf-h' + (m.length ? ' pf-h--gap' : '') }, `STORES · ${s.length}`), s.map(beenRow));
  };
  const chip = (id, label, ico) => {
    const b = el('button', { class: 'pf-sort', type: 'button', 'aria-pressed': id === mode ? 'true' : 'false', onclick: async () => {
      mode = id;
      chips.forEach(([k, n]) => { n.classList.toggle('is-on', k === id); n.setAttribute('aria-pressed', k === id ? 'true' : 'false'); });
      if (id === 'top' && !(await loadHelpful())) {
        mode = 'recent';
        chips.forEach(([k, n]) => { n.classList.toggle('is-on', k === mode); n.setAttribute('aria-pressed', k === mode ? 'true' : 'false'); });
      }
      draw();
    } }, icon(ico, 14), label);
    b.classList.toggle('is-on', id === mode);
    return b;
  };
  const chips = [['recent', chip('recent', 'Recent', 'clock')], ['top', chip('top', 'Top Rated', 'trophy')]];
  draw();

  const stat = (n, label) => el('div', { class: 'pf-ustat' }, el('b', {}, n), el('span', {}, label));
  const divider = () => el('i', { class: 'pf-udiv', 'aria-hidden': 'true' });

  const nodes = [
    el('div', { class: 'pf-col pf-utop' },
      el('h1', { class: 'pf-utop__title' }, 'Profile')),
    el('main', { class: 'pf-col pf-uhead' },
      avatar(d.profile_url, display || handle, 'pf-avatar--110'),
      el('h2', { class: 'pf-uname' }, title),
      str(d.title) && el('p', { class: 'pf-utitle' }, str(d.title)),
      place && el('p', { class: 'pf-uloc' }, icon('loc', 12), place),
      badgePill(badge),
      el('div', { class: 'pf-ustats' }, stat(nStores, 'Stores Been To'), divider(), stat(nMarkets, 'Markets Been To'), divider(), stat(nVendors, 'Vendors Met')),
      el('div', { class: 'pf-usorts' }, chips.map(([, n]) => n)),
      content),
  ];
  return { name: title, desc: str(d.title) || `${title} on Thryft`, image: storageUrl(d.profile_url), nodes };
}

const RENDERERS = { s: renderStore, v: renderVendor, m: renderMarket, u: renderUser };

// ---------------------------------------------------------------- chrome

function topBar() {
  return el('header', { class: 'pf-bar' },
    el('a', { href: '/', 'aria-label': 'Thryft home' }, el('img', { src: '/images/thryft-wordmark.png', alt: 'Thryft' })),
    el('a', { class: 'pf-pill-btn', href: APP_STORE_URL }, 'Get the app'));
}
function ctaBar(review) {
  return el('div', { class: 'pf-cta' },
    el('div', { class: 'pf-cta__in' }, appLink(review ? 'Leave a review in Thryft' : 'Open in Thryft', review, 'pf-btn pf-btn--block')));
}
function skeleton() {
  return el('div', {},
    el('div', { class: 'pf-skel', style: 'height:300px;border-radius:0' }),
    el('div', { class: 'pf-col', style: 'margin-top:16px' },
      el('div', { class: 'pf-skel', style: 'height:56px;border-radius:999px' }),
      el('div', { class: 'pf-skel', style: 'height:140px;margin-top:16px' }),
      el('div', { class: 'pf-skel', style: 'height:100px;margin-top:16px' })));
}
function notFound(message) {
  return el('div', { class: 'pf-notfound' },
    el('h1', {}, 'Not found'), el('p', {}, message),
    el('a', { class: 'pf-pill-btn', href: APP_STORE_URL }, 'Download Thryft'),
    el('p', { style: 'margin-top:20px' }, el('a', { class: 'pf-link', href: '/' }, 'Back to home')));
}
function setMeta(name, desc, image) {
  const title = `${name} — Thryft`;
  document.title = title;
  const set = (sel, attr, key, val) => {
    let m = document.head.querySelector(sel);
    if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.append(m); }
    m.setAttribute('content', val);
  };
  const d = (desc || `${name} on Thryft`).slice(0, 200);
  set('meta[name="description"]', 'name', 'description', d);
  set('meta[property="og:title"]', 'property', 'og:title', title);
  set('meta[property="og:description"]', 'property', 'og:description', d);
  set('meta[property="og:type"]', 'property', 'og:type', 'website');
  set('meta[property="og:url"]', 'property', 'og:url', location.href);
  if (image) set('meta[property="og:image"]', 'property', 'og:image', image);
}

// ---------------------------------------------------------------- mount

export async function mount(r, root) {
  document.documentElement.classList.add('is-profile');
  const site = document.getElementById('site-css');
  if (site) site.disabled = true; // marketing CSS is dark-theme; profile.css takes over
  const review = ['s', 'v', 'm'].includes(r.kind) && new URLSearchParams(location.search).get('review') === '1';
  current = { kind: r.kind, id: r.id };
  afterMountQueue = []; layoutHooks = []; maps = [];
  root.replaceChildren(skeleton());
  try {
    let data;
    try {
      data = await fetchDocStrict(KINDS[r.kind].collection, r.id);
    } catch (e) {
      console.error(e);
      document.title = 'Thryft';
      root.replaceChildren(topBar(), notFound("We couldn't load this page. Check your connection and try again."));
      return;
    }
    if (!data) {
      document.title = 'Not found — Thryft';
      root.replaceChildren(topBar(), notFound(KINDS[r.kind].gone));
      return;
    }
    const view = await RENDERERS[r.kind](data, { review });
    setMeta(view.name || KINDS[r.kind].label, view.desc, view.image);
    root.replaceChildren(...view.nodes.filter(Boolean), ctaBar(review));
    window.addEventListener('resize', runLayout);
    runLayout();
    afterMountQueue.forEach((fn) => fn());
    afterMountQueue = [];
    if (document.fonts?.ready) document.fonts.ready.then(runLayout);
  } catch (e) {
    console.error(e);
    root.replaceChildren(topBar(), notFound('Something went wrong loading this page.'));
  }
}
