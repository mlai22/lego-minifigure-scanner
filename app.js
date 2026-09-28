/* Static, device-local Data Matrix scanner. No frames or scan data are uploaded. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries(['start','stop','torch','video','placeholder','status','camera-state','camera-choice','camera','result','result-label','result-icon','result-title','result-description','result-code','again','lookup','code','code-list','coverage-count','data-status','retry-data'].map(id => [id, $(id)]));
  const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
  const ZXING_INTEGRITY = 'sha384-ylLhng89kD62+PVK1cjm4rAYg69zDlGrbbSfAE2Eb8Xqf8RoAQCMcRoUXZh7pAPC';
  let mappings = null, dataPromise = null, libraryPromise = null;
  let stream = null, controls = null, session = 0, active = false, torchOn = false;
  let hintTimer = null;
  const status = (message) => { ui.status.textContent = message; };

  // Only the leading element ID is a package identifier. Never search arbitrary
  // numbers inside a payload, or truncate a longer number into a matching ID.
  function packageCode(raw) {
    const text = raw.trim().replace(/^\]d[12]/i, '');
    const match = text.match(/^(\d{7})(?=$|[\s\x1d\x1e])/);
    return match ? match[1] : null;
  }

  function validateData(data) {
    if (data.schemaVersion !== 1 || data.series !== '71053' || !Array.isArray(data.minifigures) || !data.minifigures.length) throw new Error('Invalid code data');
    const index = new Map();
    for (const figure of data.minifigures) {
      if (typeof figure.name !== 'string' || !figure.name.trim() || !Array.isArray(figure.codes) || !figure.codes.length) throw new Error('Invalid character');
      for (const code of figure.codes) {
        if (typeof code.value !== 'string' || !/^\d{7}$/.test(code.value) || typeof code.region !== 'string' || index.has(code.value)) throw new Error('Invalid or duplicate mapping');
        index.set(code.value, { name: figure.name, region: code.region });
      }
    }
    return index;
  }

  function loadData() {
    if (mappings) return Promise.resolve(mappings);
    if (dataPromise) return dataPromise;
    ui['retry-data'].hidden = true;
    ui['data-status'].textContent = 'Loading code list…';
    dataPromise = (async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch('./data/minifigures.json', { signal: abort.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Data unavailable');
        const index = validateData(await response.json());
        mappings = index;
        ui['code-list'].replaceChildren();
        for (const [code, figure] of index) {
          const row = document.createElement('tr');
          for (const value of [figure.name, code]) {
            const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
          }
          ui['code-list'].append(row);
        }
        ui['coverage-count'].textContent = `${index.size} published codes`;
        ui['data-status'].textContent = 'North American codes loaded. Other regions and batches may not be recognized.';
        return index;
      } catch (error) {
        ui['data-status'].textContent = 'The code list could not load. Check your connection and retry.';
        ui['retry-data'].hidden = false;
        throw error;
      } finally { clearTimeout(timeout); dataPromise = null; }
    })();
    return dataPromise;
  }

  function loadLibrary() {
    if (window.ZXingBrowser?.BrowserDatamatrixCodeReader) return Promise.resolve();
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => { clearTimeout(timeout); script.remove(); libraryPromise = null; reject(new Error('SCANNER_LOAD')); };
      const timeout = setTimeout(fail, 15000);
      script.src = ZXING_URL; script.integrity = ZXING_INTEGRITY; script.crossOrigin = 'anonymous';
      script.onload = () => { clearTimeout(timeout); if (window.ZXingBrowser?.BrowserDatamatrixCodeReader) resolve(); else fail(); };
      script.onerror = fail;
      document.head.append(script);
    });
    return libraryPromise;
  }

  function safelyStop(control) {
    try { Promise.resolve(control?.stop()).catch(() => {}); } catch (_) { /* Track cleanup below is authoritative. */ }
  }

  function stopCamera(message) {
    session++; active = false; clearTimeout(hintTimer);
    safelyStop(controls); controls = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; ui.video.srcObject = null; ui.video.hidden = true;
    ui.placeholder.hidden = false; ui.start.hidden = false; ui.start.disabled = false;
    ui.stop.hidden = true; ui.torch.hidden = true; ui.torch.disabled = false;
    ui['camera-choice'].hidden = true;
    torchOn = false; ui.torch.setAttribute('aria-pressed', 'false'); ui.torch.textContent = 'Flashlight off';
    ui['camera-state'].textContent = 'Camera off';
    if (message) status(message);
  }

  function showResult(label, title, description, code, found = false) {
    ui.result.className = `result ${found ? 'found' : 'unknown'}`;
    ui['result-label'].textContent = label;
    ui['result-icon'].textContent = found ? '✓' : '?';
    ui['result-title'].textContent = title;
    ui['result-description'].textContent = description;
    ui['result-code'].textContent = code ? `Package code · ${code}` : '';
    ui['result-code'].hidden = !code;
    ui.again.hidden = false;
    ui.result.focus({ preventScroll: true });
    ui.result.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }

  function identify(raw) {
    const code = packageCode(raw);
    if (!code) {
      showResult('CHECK THE CODE', 'That isn’t a package code', 'Use the first 7-digit number from decoded Data Matrix text. A retail barcode or printed batch number cannot identify the character.');
      return;
    }
    const figure = mappings.get(code);
    if (figure) {
      showResult('LOOK WHO’S INSIDE', figure.name, `${figure.region} · Shrek Series 71053. Matched to a published community code.`, code, true);
    } else {
      showResult('CODE READ · NO MATCH', 'A little mystery remains', 'This code is not in the current Shrek list. It may belong to another region, production batch, or series. No character has been guessed.', code);
    }
  }

  function cameraError(error) {
    if (error.message === 'SCANNER_LOAD') return 'The scanner library could not load. Check your connection and try again, or use manual lookup.';
    const messages = {
      NotAllowedError: 'Camera access was denied. Allow camera access in your browser’s site settings, then tap Start camera.',
      PermissionDeniedError: 'Allow camera access in your browser’s site settings, then try again.',
      NotFoundError: 'No camera was found. Use manual code lookup on this device.',
      NotReadableError: 'The camera is busy or unavailable. Close other camera apps and try again.',
      OverconstrainedError: 'That camera is unavailable. Try starting the camera again.',
      SecurityError: 'Camera access is blocked. Open this page directly in Safari or Chrome over HTTPS.'
    };
    return messages[error.name] || 'The camera could not start. Try again, or open this page directly in Safari or Chrome. Manual lookup is still available.';
  }

  async function startCamera(deviceId) {
    stopCamera();
    if (!window.isSecureContext) { status('Camera access needs HTTPS. Open the secure version of this site, or use manual lookup.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { status('This browser cannot access a camera. Open the site in Safari or Chrome, or use manual lookup.'); return; }
    const token = session; active = true;
    ui.start.disabled = true; ui.stop.hidden = false;
    ui['camera-state'].textContent = 'Starting…'; status('Preparing the scanner…');
    try {
      try { await loadData(); } catch (_) { throw new Error('DATA_LOAD'); }
      await loadLibrary();
      if (token !== session) return;
      status('Allow camera access when prompted.');
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 1280 }, height: { ideal: 720 }
      }});
      if (token !== session) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      const track = acquired.getVideoTracks()[0];
      track.addEventListener('ended', () => { if (token === session) stopCamera('Camera disconnected. Tap Start camera to retry.'); });
      ui.video.hidden = false; ui.placeholder.hidden = true;
      ui.start.hidden = true;
      const reader = new window.ZXingBrowser.BrowserDatamatrixCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 500 });
      const scanning = await reader.decodeFromStream(acquired, ui.video, (result, error, callbackControls) => {
        if (token !== session) { safelyStop(callbackControls); return; }
        if (result) {
          safelyStop(callbackControls);
          stopCamera('Code read. Camera stopped to save battery.');
          identify(result.getText());
        } else if (error && !['NotFoundException','ChecksumException','FormatException'].includes(error.getKind?.() || error.name)) {
          safelyStop(callbackControls);
          stopCamera('The scanner stopped unexpectedly. Tap Start camera to try again.');
        }
      });
      if (token !== session) { safelyStop(scanning); return; }
      controls = scanning;
      ui['camera-state'].textContent = 'Camera live';
      status('Point at the square Data Matrix code. Hold steady while it focuses.');
      const capabilities = track.getCapabilities?.() || {};
      ui.torch.hidden = !capabilities.torch;
      if (capabilities.focusMode?.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      hintTimer = setTimeout(() => { if (token === session) status('Still looking. Move slightly farther away, improve the light, or try a different rear camera below.'); }, 18000);
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
        if (token !== session) return;
        ui.camera.replaceChildren();
        devices.forEach((device, i) => {
          const option = document.createElement('option'); option.value = device.deviceId; option.textContent = device.label || `Camera ${i + 1}`; ui.camera.append(option);
        });
        ui.camera.value = track.getSettings().deviceId || deviceId || '';
        ui['camera-choice'].hidden = devices.length < 2;
      } catch (_) { /* Scanning still works if camera enumeration is blocked. */ }
    } catch (error) {
      if (token !== session) return;
      stopCamera(error.message === 'DATA_LOAD' ? 'The character list could not load. Check your connection and try again.' : cameraError(error));
    }
  }

  ui.start.addEventListener('click', () => startCamera());
  ui.stop.addEventListener('click', () => stopCamera('Camera stopped. Tap Start camera when you’re ready.'));
  ui.again.addEventListener('click', () => { $('scanner-title').scrollIntoView({ block: 'start' }); startCamera(); });
  ui.camera.addEventListener('change', () => startCamera(ui.camera.value));
  ui.torch.addEventListener('click', async () => {
    const token = session, track = stream?.getVideoTracks()[0];
    if (!track) return;
    ui.torch.disabled = true;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      if (token !== session) return;
      torchOn = !torchOn; ui.torch.setAttribute('aria-pressed', String(torchOn)); ui.torch.textContent = `Flashlight ${torchOn ? 'on' : 'off'}`;
    } catch (_) { if (token === session) status('Flashlight is unavailable on this camera. Try brighter lighting.'); }
    finally { if (token === session) ui.torch.disabled = false; }
  });
  ui.lookup.addEventListener('submit', async (event) => {
    event.preventDefault();
    stopCamera('Camera off. Looking up your code.');
    const raw = ui.code.value, token = session;
    try { await loadData(); if (token === session) { identify(raw); status('Lookup complete.'); } }
    catch (_) { if (token === session) showResult('CONNECTION NEEDED', 'Couldn’t load the code list', 'Check your connection and submit your code again.'); }
  });
  ui['retry-data'].addEventListener('click', () => { loadData().catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) stopCamera('Camera paused when you left the page. Tap Start camera to resume.'); });
  window.addEventListener('pagehide', () => stopCamera());
  loadData().catch(() => {});
})();
