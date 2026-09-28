/* All decoding and user data stay on this device. No runtime dependencies except ZXing. */
const MAX_RAW_LENGTH = 8192;
const STORAGE_KEY = 'minifigure-scanner.v1';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
const ZXING_INTEGRITY = 'sha384-ylLhng89kD62+PVK1cjm4rAYg69zDlGrbbSfAE2Eb8Xqf8RoAQCMcRoUXZh7pAPC';

// Pure data and parsing functions are also imported by tests/parser-tests.html.
export function validateRegistry(data) {
  if (!data || !Array.isArray(data.series) || !data.series.length) throw new Error('Invalid series registry');
  const ids = new Set(), files = new Set();
  for (const series of data.series) {
    if (!series || !/^[a-z0-9-]+$/.test(series.id) || typeof series.name !== 'string' || !series.name.trim() ||
        !(series.setNumber === null || (typeof series.setNumber === 'string' && /^\d+$/.test(series.setNumber))) ||
        typeof series.dataFile !== 'string' || !/^data\/[a-z0-9-]+\.json$/.test(series.dataFile) ||
        ids.has(series.id) || files.has(series.dataFile)) throw new Error('Invalid or duplicate registry entry');
    ids.add(series.id); files.add(series.dataFile);
  }
  return data.series;
}

export function validateDatabase(data, series) {
  if (!data || data.id !== series.id || data.name !== series.name || data.setNumber !== series.setNumber ||
      typeof data.dataVersion !== 'string' || typeof data.lastVerified !== 'string' || !Array.isArray(data.mappings)) throw new Error('Invalid series database');
  const unique = new Map();
  for (const item of data.mappings) {
    if (!item || typeof item.code !== 'string' || !/^\d{7}$/.test(item.code) ||
        typeof item.character !== 'string' || !item.character.trim() || typeof item.region !== 'string' || !item.region.trim() ||
        (item.sourceGroup !== undefined && typeof item.sourceGroup !== 'string')) throw new Error('Invalid mapping');
    // Exact repeated rows collapse; contradictory rows remain to produce AMBIGUOUS_CODE.
    const mapping = { code: item.code, character: item.character, region: item.region, sourceGroup: item.sourceGroup || '' };
    unique.set(JSON.stringify(mapping), mapping);
  }
  return { ...data, mappings: [...unique.values()] };
}

export async function fetchJSON(path) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(path, { signal: abort.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Cannot load ${path}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export async function loadSeriesRegistry(base = './') {
  return validateRegistry(await fetchJSON(`${base}data/series.json`));
}
export async function loadSeriesDatabase(series, base = './') {
  return validateDatabase(await fetchJSON(`${base}${series.dataFile}`), series);
}
export async function loadAllSeriesDatabases(registry, base = './') {
  const results = await Promise.allSettled(registry.map(series => loadSeriesDatabase(series, base)));
  return { databases: results.filter(result => result.status === 'fulfilled').map(result => result.value),
    failures: results.flatMap((result, i) => result.status === 'rejected' ? [registry[i]] : []) };
}

function validRaw(raw) { return typeof raw === 'string' && raw.trim().length > 0 && raw.length <= MAX_RAW_LENGTH; }
function matchedCodes(raw, mappings) {
  if (!validRaw(raw)) return [];
  raw = raw.trim().replace(/^\]d[12]/i, '');
  // Letter prefixes/suffixes are allowed. Never match inside a longer digit run.
  return [...new Set(mappings.map(mapping => mapping.code))].filter(code =>
    /^\d{7}$/.test(code) && new RegExp(`(^|[^0-9])${code}(?=$|[^0-9])`).test(raw));
}
export function extractPackageCode(rawText, mappings) {
  const codes = matchedCodes(rawText, mappings);
  return codes.length === 1 ? codes[0] : null;
}
export function lookupCharacter(code, database) {
  return database.mappings.filter(mapping => mapping.code === code);
}
export function findCodeAcrossSeries(rawText, databases) {
  return databases.flatMap(database => {
    const codes = new Set(matchedCodes(rawText, database.mappings));
    return database.mappings.filter(mapping => codes.has(mapping.code)).map(mapping => ({ ...mapping,
      seriesId: database.id, series: database.name, setNumber: database.setNumber,
      dataVersion: database.dataVersion, lastVerified: database.lastVerified }));
  });
}
export function resolveScan(rawText, selectedId, databases) {
  if (!validRaw(rawText)) return { state: 'SCANNER_ERROR', message: 'Enter decoded text between 1 and 8,192 characters.' };
  const matches = findCodeAcrossSeries(rawText, databases);
  // Check all databases even if selected series matches: never hide a collision.
  if (matches.length > 1) return { state: 'AMBIGUOUS_CODE', matches };
  if (!matches.length) return { state: 'UNKNOWN_CODE' };
  return { state: matches[0].seriesId === selectedId ? 'FOUND' : 'DIFFERENT_SERIES', match: matches[0] };
}

const $ = id => document.getElementById(id);
const state = {
  registry: [], databases: [], failures: [], selected: null, last: null,
  history: [], collections: {}, storageAvailable: true, loading: false,
  stream: null, controls: null, video: null, session: 0, active: false, torch: false, hintTimer: null, libraryPromise: null
};
function text(id, value) { $(id).textContent = value; }
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function databaseFor(id) { return state.databases.find(database => database.id === id); }
function setLabel(series) { return series.setNumber ? `LEGO ${series.setNumber}` : 'Set number not supplied'; }
function cameraStatus(message, error = '') { text('status', message); $('status').dataset.state = error; }

async function initializeData() {
  if (state.loading) return;
  stopCamera(); state.loading = true;
  $('retry').hidden = true; text('load-status', 'Loading series and package codes…');
  $('load-status').hidden = false;
  try {
    state.registry = await loadSeriesRegistry();
    const loaded = await loadAllSeriesDatabases(state.registry);
    state.databases = loaded.databases; state.failures = loaded.failures;
    renderSeriesSelection();
    if (state.selected) {
      state.selected = state.registry.find(series => series.id === state.selected.id) || null;
      if (state.selected) renderScanner(); else changeSeries();
    }
    if (state.failures.length) throw new Error('Some databases unavailable');
    $('load-status').hidden = true;
  } catch (_) {
    text('load-status', 'DATABASE_LOAD_ERROR · Could not load all package codes. Check your connection and retry. Identification pauses until all series are available so conflicting matches cannot be missed.');
    $('retry').hidden = false;
  } finally {
    state.loading = false;
    updateLookupControls();
  }
}
function updateLookupControls() {
  const unavailable = state.loading || !state.selected || !databaseFor(state.selected.id) || state.failures.length > 0;
  $('start').disabled = Boolean(unavailable || state.active);
  $('find').disabled = Boolean(unavailable);
}
function renderSeriesSelection() {
  const cards = $('series-cards'); cards.replaceChildren();
  for (const series of state.registry) {
    const database = databaseFor(series.id);
    const card = element('button', undefined, 'series-card'); card.type = 'button';
    card.setAttribute('aria-label', `Select ${series.name}`);
    card.append(element('strong', series.name), element('span', setLabel(series)),
      element('span', database ? `${new Set(database.mappings.map(mapping => mapping.character)).size} characters · ${database.mappings.length} package codes` : 'Database unavailable'),
      element('b', 'Select →'));
    card.addEventListener('click', () => selectSeries(series.id)); cards.append(card);
  }
}
function resetResult() {
  state.last = null;
  $('result').className = 'result';
  text('result-label', 'THE BIG REVEAL'); text('result-icon', '?'); text('result-title', 'Who’s in your box?');
  text('result-description', 'Start a scan or enter a code below.');
  ['result-code','raw-block','switch-series','add-collection','again','result-change'].forEach(id => $(id).hidden = true);
  $('raw').value = ''; $('code').value = ''; text('copy-status', ''); renderDetails();
}
function selectSeries(id, preserveResult = false) {
  const series = state.registry.find(item => item.id === id);
  if (!series) return;
  stopCamera(); state.selected = series;
  if (!preserveResult) resetResult();
  renderScanner();
  $('selected-title').focus({ preventScroll: true });
  $('selected').scrollIntoView({ block: 'start' });
}
function changeSeries() {
  stopCamera(); state.selected = null; resetResult();
  ['selected','workspace','scanner-details','collection-section'].forEach(id => $(id).hidden = true);
  $('series-picker').hidden = false;
  $('picker-title').focus({ preventScroll: true }); $('series-picker').scrollIntoView({ block: 'start' });
}
function renderScanner() {
  $('series-picker').hidden = true;
  ['selected','workspace','scanner-details','collection-section'].forEach(id => $(id).hidden = false);
  text('selected-title', state.selected.name); text('selected-set', setLabel(state.selected));
  const database = databaseFor(state.selected.id);
  text('coverage', !database ? 'Database unavailable. Retry loading above.' : !database.mappings.length ?
    'Package code data for this series has not been added yet.' :
    `${database.mappings.length} published codes · ${[...new Set(database.mappings.map(mapping => mapping.region))].join(' · ')}. Other production batches may be unknown.`);
  cameraStatus('Point the camera at the square Data Matrix code on the bottom of the box.');
  renderCollection(); renderDetails(); updateLookupControls();
}

function handleDecodedBarcode(raw, format = 'DATA_MATRIX') {
  if (!state.selected) return;
  stopCamera('Code processed. Camera off.');
  const outcome = state.loading || state.failures.length || !databaseFor(state.selected.id) ?
    { state: 'DATABASE_LOAD_ERROR' } : resolveScan(raw, state.selected.id, state.databases);
  state.last = { ...outcome, raw, format, selectedAtScan: state.selected.name };
  if (outcome.match) saveScanHistory(outcome.match);
  renderResult(); renderDetails();
}
function renderUnknown(last) {
  const messages = {
    UNKNOWN_CODE: ['UNKNOWN PACKAGE CODE', 'This code is not currently in our database. It may be from a different region, factory, or production batch.'],
    AMBIGUOUS_CODE: ['AMBIGUOUS CODE', 'This text matches more than one mapping. Scan a single box or enter only its package code. No character has been guessed.'],
    DATABASE_LOAD_ERROR: ['DATABASE LOAD ERROR', 'Not all series databases are available. Retry loading the databases, then scan or enter the code again.'],
    SCANNER_ERROR: ['CHECK THE INPUT', last.message || 'The scanner could not read this input. Try again.']
  };
  const [title, description] = messages[last.state];
  text('result-label', last.format === 'DATA_MATRIX' ? 'DATA MATRIX DETECTED' : 'MANUAL LOOKUP');
  text('result-icon', '?'); text('result-title', title);
  text('result-description', `${description} Selected series: ${state.selected.name}.`);
  $('result').className = `result ${last.state === 'UNKNOWN_CODE' ? 'unknown' : last.state === 'AMBIGUOUS_CODE' ? 'ambiguous' : 'error'}`;
  $('raw-block').hidden = false; $('raw').value = last.raw; text('copy-status', '');
}
function renderResult() {
  const last = state.last;
  if (!last) return;
  ['result-code','raw-block','switch-series','add-collection'].forEach(id => $(id).hidden = true);
  $('again').hidden = false; $('result-change').hidden = false;
  if (last.match) {
    const match = last.match;
    $('result').className = 'result found';
    text('result-label', last.state === 'DIFFERENT_SERIES' ? 'Different Series Detected' : '✓ FOUND!');
    text('result-icon', '✓'); text('result-title', match.character);
    text('result-description', `${match.series} · ${setLabel(match)} · ${match.region}${match.sourceGroup ? ` · ${match.sourceGroup}` : ''}`);
    text('result-code', `Package Code · ${match.code}`); $('result-code').hidden = false;
    $('switch-series').hidden = last.state !== 'DIFFERENT_SERIES';
    text('switch-series', `Switch to ${match.series}`);
    $('add-collection').hidden = false; updateCollectionButton();
  } else renderUnknown(last);
  $('result').dataset.state = last.state;
  $('result').focus({ preventScroll: true }); $('result').scrollIntoView({ block: 'nearest' });
}
function renderDetails() {
  const last = state.last, match = last?.match, database = match ? databaseFor(match.seriesId) : databaseFor(state.selected?.id);
  const details = {
    'Selected series': state.selected?.name || 'None',
    'Series at scan': last?.selectedAtScan || '—',
    'Raw decoded text': last?.raw || '—',
    'Extracted package code': match?.code || (last?.state === 'AMBIGUOUS_CODE' ? 'Multiple matches' : 'No known code'),
    'Barcode format': last?.format || '—', Character: match?.character || '—', Region: match?.region || '—',
    'Source group': match?.sourceGroup || 'Not supplied',
    'Database version': database?.dataVersion || '—', 'Last verified': database?.lastVerified || '—',
    Result: last?.state || 'Waiting for scan'
  };
  $('details-list').replaceChildren();
  for (const [label, value] of Object.entries(details)) $('details-list').append(element('dt', label), element('dd', value));
}

function loadLocalData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.history = Array.isArray(saved.history) ? saved.history.filter(item => item &&
      ['character','series','seriesId','code','region','date'].every(key => typeof item[key] === 'string') &&
      /^\d{7}$/.test(item.code) && Number.isFinite(Date.parse(item.date))).slice(0, 20) : [];
    if (saved.collections && typeof saved.collections === 'object' && !Array.isArray(saved.collections)) {
      state.collections = Object.fromEntries(Object.entries(saved.collections).filter(([id, names]) =>
        /^[a-z0-9-]+$/.test(id) && Array.isArray(names) && names.every(name => typeof name === 'string')));
    }
  } catch (_) { storageError(); }
}
function storageError() {
  state.storageAvailable = false;
  text('storage-status', 'Browser storage is unavailable or invalid. Changes remain available for this page session, but may not survive a reload.');
}
function persistLocalData() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ history: state.history, collections: state.collections })); }
  catch (_) { storageError(); }
}
function saveScanHistory(match) {
  const item = { character: match.character, series: match.series, seriesId: match.seriesId,
    setNumber: match.setNumber, code: match.code, region: match.region, date: new Date().toISOString() };
  state.history = [item, ...state.history].slice(0, 20); persistLocalData(); renderHistory();
}
function renderHistory() {
  $('history-list').replaceChildren();
  $('history-empty').hidden = state.history.length > 0; $('clear-history').disabled = !state.history.length;
  for (const scan of state.history) {
    const item = element('li', undefined, 'history-item');
    const date = element('time', new Date(scan.date).toLocaleString()); date.dateTime = scan.date;
    item.append(element('strong', scan.character), element('span', `${scan.series} · ${setLabel(scan)}`),
      element('span', `${scan.code} · ${scan.region}`), date);
    $('history-list').append(item);
  }
}
function collectionNames(id) { return Object.hasOwn(state.collections, id) ? state.collections[id] : []; }
function collected(id, character) { return collectionNames(id).includes(character); }
function setCollected(id, character, value) {
  const names = new Set(collectionNames(id));
  if (value) names.add(character); else names.delete(character);
  state.collections = { ...state.collections, [id]: [...names] };
  persistLocalData(); renderCollection(); updateCollectionButton();
}
function updateCollectionButton() {
  const match = state.last?.match;
  if (!match) return;
  const already = collected(match.seriesId, match.character);
  text('add-collection', already ? '✓ In your collection' : 'Add to Collection'); $('add-collection').disabled = already;
}
function renderCollection() {
  if (!state.selected) return;
  text('collection-title', `${state.selected.name} Collection`);
  const names = [...new Set((databaseFor(state.selected.id)?.mappings || []).map(mapping => mapping.character))];
  text('collection-count', `${names.filter(name => collected(state.selected.id, name)).length} / ${names.length} collected`);
  const list = $('collection-list'); list.replaceChildren();
  if (!names.length) { list.append(element('p', 'A checklist will appear when character mappings are added.', 'status')); return; }
  for (const name of names) {
    const label = element('label', undefined, 'collection-item');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = collected(state.selected.id, name);
    checkbox.addEventListener('change', () => {
      // Update the count in place to preserve keyboard focus on this checkbox.
      const chosen = new Set(collectionNames(state.selected.id));
      if (checkbox.checked) chosen.add(name); else chosen.delete(name);
      state.collections = { ...state.collections, [state.selected.id]: [...chosen] }; persistLocalData();
      text('collection-count', `${names.filter(item => chosen.has(item)).length} / ${names.length} collected`); updateCollectionButton();
    });
    label.append(checkbox, element('span', name)); list.append(label);
  }
}

function loadLibrary() {
  if (window.ZXingBrowser?.BrowserDatamatrixCodeReader) return Promise.resolve();
  if (state.libraryPromise) return state.libraryPromise;
  state.libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timeout); script.remove(); state.libraryPromise = null; reject(new Error('SCANNER_LOAD')); };
    const timeout = setTimeout(fail, 15000);
    script.src = ZXING_URL; script.integrity = ZXING_INTEGRITY; script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timeout); if (window.ZXingBrowser?.BrowserDatamatrixCodeReader) resolve(); else fail(); };
    script.onerror = fail; document.head.append(script);
  });
  return state.libraryPromise;
}
function safelyStop(controls) {
  try { Promise.resolve(controls?.stop()).catch(() => {}); } catch (_) { /* Tracks are stopped independently below. */ }
}
function stopCamera(message) {
  state.session++; state.active = false; clearTimeout(state.hintTimer);
  safelyStop(state.controls); state.controls = null;
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null;
  if (state.video) { state.video.srcObject = null; state.video.remove(); state.video = null; }
  $('placeholder').hidden = false; $('start').hidden = false; $('stop').hidden = true;
  $('torch').hidden = true; $('torch').disabled = false; $('camera-choice').hidden = true;
  state.torch = false; $('torch').setAttribute('aria-pressed', 'false'); text('torch', 'Flashlight off');
  text('camera-state', 'Camera off'); updateLookupControls();
  if (message) cameraStatus(message);
}
function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return ['CAMERA_PERMISSION_DENIED', 'Camera access is needed to scan the box. Allow camera access in your browser settings, or enter the package code manually.'];
  if (['NotFoundError','NotReadableError','OverconstrainedError'].includes(error.name)) return ['CAMERA_NOT_AVAILABLE', 'The camera is unavailable or busy. Close other camera apps and try again, or enter the code manually.'];
  return ['SCANNER_ERROR', error.message === 'SCANNER_LOAD' ? 'The scanner library could not load. Check your connection and retry. Manual lookup still works.' : 'The scanner could not start. Open this page directly in Safari or Chrome, or enter the code manually.'];
}
async function startCamera(deviceId) {
  stopCamera();
  if (!state.selected) return;
  if (state.loading || state.failures.length || !databaseFor(state.selected.id)) { cameraStatus('Reload the databases before scanning.', 'DATABASE_LOAD_ERROR'); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { cameraStatus('Camera access requires HTTPS or localhost and a supported browser. Manual lookup is available.', 'CAMERA_NOT_AVAILABLE'); return; }
  const token = state.session; state.active = true;
  $('start').disabled = true; $('stop').hidden = false; text('camera-state', 'Starting…'); cameraStatus('Preparing scanner…');
  try {
    await loadLibrary(); if (token !== state.session) return;
    cameraStatus('Allow camera access when prompted.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 1280 }, height: { ideal: 720 }
    }});
    if (token !== state.session) { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (token === state.session) stopCamera('Camera disconnected. Start Scanner to retry.'); });
    // Each session owns its video node, preventing delayed old cleanup from
    // detaching the preview of a newer session after rapid stop/restart.
    const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('aria-label', 'Live rear camera preview');
    state.video = video; $('viewfinder').prepend(video); $('placeholder').hidden = true; $('start').hidden = true;
    const controls = await scanDataMatrix(stream, video, token);
    if (token !== state.session) { safelyStop(controls); return; }
    state.controls = controls; text('camera-state', 'Camera live');
    cameraStatus('Point the camera at the square Data Matrix code on the bottom of the box.');
    const capabilities = track.getCapabilities?.() || {}; $('torch').hidden = !capabilities.torch;
    if (capabilities.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    state.hintTimer = setTimeout(() => { if (token === state.session) cameraStatus('Still looking. Try more light, move slightly farther away, or choose a different rear camera.'); }, 18000);
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (token !== state.session) return;
      $('camera').replaceChildren();
      devices.forEach((device, i) => { const option = element('option', device.label || `Camera ${i + 1}`); option.value = device.deviceId; $('camera').append(option); });
      $('camera').value = track.getSettings().deviceId || deviceId || ''; $('camera-choice').hidden = devices.length < 2;
    } catch (_) { /* Enumeration is optional; the camera remains usable. */ }
  } catch (error) {
    if (token !== state.session) return;
    stopCamera(); const [code, message] = cameraError(error); cameraStatus(message, code);
  }
}
async function scanDataMatrix(stream, video, token) {
  const reader = new window.ZXingBrowser.BrowserDatamatrixCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 500 });
  return reader.decodeFromStream(stream, video, (result, error, controls) => {
    if (token !== state.session) { safelyStop(controls); return; }
    if (result) {
      safelyStop(controls); handleDecodedBarcode(result.getText());
    } else if (error && !['NotFoundException','ChecksumException','FormatException'].includes(error.getKind?.() || error.name)) {
      safelyStop(controls); stopCamera(); cameraStatus('Scanning stopped unexpectedly. Tap Start Scanner to retry.', 'SCANNER_ERROR');
    }
  });
}
async function toggleTorch() {
  const token = state.session, track = state.stream?.getVideoTracks()[0]; if (!track) return;
  $('torch').disabled = true;
  try {
    await track.applyConstraints({ advanced: [{ torch: !state.torch }] }); if (token !== state.session) return;
    state.torch = !state.torch; $('torch').setAttribute('aria-pressed', String(state.torch)); text('torch', `Flashlight ${state.torch ? 'on' : 'off'}`);
  } catch (_) { if (token === state.session) cameraStatus('Flashlight unavailable. Try brighter lighting.'); }
  finally { if (token === state.session) $('torch').disabled = false; }
}
async function copyRaw() {
  try { await navigator.clipboard.writeText($('raw').value); text('copy-status', 'Copied to clipboard.'); }
  catch (_) { $('raw').focus(); $('raw').select(); text('copy-status', 'Copy is unavailable. The raw text is selected; use your device’s Copy command.'); }
}
function initializeApp() {
  loadLocalData(); renderHistory();
  $('start').addEventListener('click', () => startCamera());
  $('stop').addEventListener('click', () => stopCamera('Camera stopped. Tap Start Scanner when ready.'));
  $('again').addEventListener('click', () => { $('scanner-title').scrollIntoView({ block: 'start' }); startCamera(); });
  $('camera').addEventListener('change', () => startCamera($('camera').value));
  $('torch').addEventListener('click', toggleTorch);
  $('lookup').addEventListener('submit', event => { event.preventDefault(); handleDecodedBarcode($('code').value, 'Manual entry'); });
  ['change-series','result-change'].forEach(id => $(id).addEventListener('click', changeSeries));
  $('switch-series').addEventListener('click', () => {
    if (!state.last?.match) return;
    selectSeries(state.last.match.seriesId, true); state.last.state = 'FOUND'; renderResult(); renderDetails();
  });
  $('add-collection').addEventListener('click', () => {
    const match = state.last?.match; if (match) setCollected(match.seriesId, match.character, true);
  });
  $('clear-history').addEventListener('click', () => { state.history = []; persistLocalData(); renderHistory(); });
  $('copy').addEventListener('click', copyRaw);
  $('retry').addEventListener('click', initializeData);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.active) stopCamera('Camera paused while this page was hidden. Tap Start Scanner to resume.'); });
  window.addEventListener('pagehide', () => stopCamera());
  initializeData();
}
// Importing the pure functions in the test page must never initialize a camera or app.
if (typeof document !== 'undefined' && $('app')) initializeApp();
