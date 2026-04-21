/* 
Still needed

- Sounding overlay
     Need to replot using metpy endpoint with snd_overlay=True
 */


// ─── STATE ───────────────────────────────────────────────────────────────────

// Load saved theme on page load
let currentTheme = localStorage.getItem('theme');
if (!currentTheme) {currentTheme = 'light'}

let sondes = [];         // [{lat, lon, pres[], temp[], dewp[], wspd[], id}]
let markers = [];
//let cachedSet = new Set();
let selectedIdx = -1;
let map;
let mapLats = [];
let mapLons = [];

//let allCampaigns = [];
//let currentFlights = [];
let selectedFlights = new Set();
let loadedFlightIds = new Set();

let precomputing = false
let precomputeInterval = null;
let isStopping = false;
let pc_finish = false;

RT_MODE = true;
let lastRtUpdate = null;
let fnamesRt = [];
let sondes_rt = []; // persistant cache for real time sonde info
let markers_rt = [];

// Planview plotting variables
let sondes_interp = [];

const WORKER_URL      = 'https://aoml-dropsonde-proxy.newj25.workers.dev';
const METPY_SERVER    = 'https://sounding-plotter.onrender.com';  // 'http://localhost:5000'; //  
const REALTIME_SERVER = 'https://realtime-dropsonde-server.onrender.com'; // 'http://localhost:3000'; //
let   metpyAvailable  = null;  // checked on first use
const LOCAL_PROXY_URL = 'http://localhost:8765';
let _lastWorkingProxy = null;


// ─── STATUS ──────────────────────────────────────────────────────────────────
function setStatus(msg, cls='idle') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status-badge ' + cls;
}


//#######################################################
//############# Adjust Menus and Text Boxes #############
//#######################################################

// Function to populate file dropdown menu
function populate_file_dropdown(files) {
    const file_dropdown = document.getElementById('file-dropdown');
    files.forEach(file => {
          const opt = document.createElement('option');
          opt.value = file;
          opt.textContent = file;
          file_dropdown.appendChild(opt);
    });
}

// Function to update data file dropdown menu
function reset_file_dropdown() {
    const file_dropdown = document.getElementById('file-dropdown');
    //file_dropdown.value = "";  // reset to default option
    file_dropdown.innerHTML = '<option value="">-- Select a File --</option>';
    
    //clear: file_dropdown.value = "";  // reset to default option
    /*if (cond == "reset") {
        file_dropdown.innerHTML = '<option value="">-- Select a file --</option>';
    }
    if (cond == "error") {
        file_dropdown.innerHTML = '<option value="">-- No files found --</option>';
    }
    */
}

// Function to clear sounding overlay dropdown menu
function reset_overlay_dropdown() {
    const overlay_dropdown = document.getElementById("overlay-dropdown");
    overlay_dropdown.value = "None";  // reset to default option
}

// Function to remove points on Map
function reset_map_points() {
	Plotly.restyle("map", {
		lat: [[]],
		lon: [[]]
	}, [0]);
}

// Function to clear url input text box
function clearInput() {
	document.getElementById('url-input').value = "";
}

//Functon to reset state variables
function reset_state_vars() {
	sondes = [];
	markers = [];
	selectedIdx = -1;
	map;
	mapLats = [];
	mapLons = [];
	
	allCampaigns = [];
	currentFlights = [];
	selectedFlights = new Set();
	loadedFlightIds = new Set();

	precomputing = false
	precomputeInterval = null;
	isStopping = false;
}

// Function to reset data browser
function resetDataBrowser() {
  // Clear all checked flights
  selectedFlights.clear();
  // Uncheck "select all" checkbox
  const selAll = document.getElementById('br-sel-all');
  if (selAll) selAll.checked = false;
  // Clear filter text
  const filterInput = document.getElementById('br-filter');
  if (filterInput) filterInput.value = '';
  // Re-render list with no selections
  renderFlightList(currentFlights);
  // Update count badge
  updateSelCount();
}

// Function to reset planview plotting interface
function reset_planview() {
    const variableSelect = document.getElementById('variableSelect');
	const slider = document.getElementById('heightSlider')
	const input = document.getElementById('heightInput')
	const [defaultHeight, nearestIdx] = getHeight(1000);
	if (availableHeights.length) {
		slider.value = availableHeights.indexOf(defaultHeight);
		input.value = defaultHeight;
	}
	slider.disabled = true;
	input.disabled = true;
    variableSelect.innerHTML = '<option value="">-- Select Variable --</option>';
    variableSelect.disabled = true;
	sondes_interp = [];
	update_marker_colors();
	Plotly.restyle('map', {
		'marker.showscale': [false]
	});
}

// Function to reset loader interface
function reset_loader() {
	render_cache_btns("hide");
	if (loader_text) {loader_text.style.display = "none";}
	if (loader_cont) {loader_cont.style.display = "none";}
}

// Function to reset map
function reset_app() {
	clearInput();
	clearPlot();
	//console.log(precomputing)
	if (precomputing) {stop_precompute();} // stop precomputing plots if ongoing
	//stop_precompute();
	reset_state_vars();
	reset_file_dropdown();
	reset_map_points();
	resetDataBrowser();
	reset_planview();
	reset_loader();
	setStatus("IDLE");
    Plotly.relayout('map', {
        'mapbox.center': { lat: 40, lon: -100 },
        'mapbox.zoom': 3
    });
}

// Function for plot clear button click
function clearPlot() {
    // Change to blank plot
    const img = document.getElementById('plot-img');
    img.src = "blank_plot.png";
    
    // Reset dropdown
    const dropdown = document.getElementById("file-dropdown");
    dropdown.value = "";  // reset to default option
    
    // Reset sounding overlay dropdown
    reset_overlay_dropdown();
    
    // Reset plot markers
	selectedIdx = -1
	update_marker_colors();
    //highlight_marker([], [])
}

function savePlot() {
  const img = document.getElementById('plot-img');
  const url = img.src;

  const sonde = selectedIdx >= 0 ? sondes[selectedIdx] : null;
  const name = sonde ? sonde.id.split('::').pop().replace(/_PQC$/,'') : 'sounding';

  const link = document.createElement('a');
  link.href = url;
  link.download = name + '_skewtlogp.png';
  link.click();
  setStatus('SAVED: ' + link.download, 'ok');
}


//#######################################################
//################## Loading Animation ##################
//#######################################################

const loadingOverlay = document.getElementById("loader");

// Function to show loading animation
function showLoading(container) {
    // Append overlay to the container dynamically
    container.appendChild(loadingOverlay);
    loadingOverlay.style.display = "flex";
}

// Function to hide loading animation
function hideLoading() {
    loadingOverlay.style.display = "none";
}


//#######################################################
//################## AOML DATA BROWSER ##################
//#######################################################
const BASE_URL = 'https://www.aoml.noaa.gov/ftp/hrd/data/dropsonde/';

function openBrowser() {
  document.getElementById('browser-overlay').classList.add('open');
  if (allCampaigns.length === 0) fetchCampaignList();
}
function closeBrowser() {
  document.getElementById('browser-overlay').classList.remove('open');
}

async function fetchCampaignList() {
  const brStatus = document.getElementById('br-status');
  brStatus.textContent = 'Fetching campaign list…';
  try {
    const html = await proxyFetch(BASE_URL);
    const links = [...html.matchAll(/href="([A-Za-z][^"/]*\/)"/g)].map(m => m[1]);
    allCampaigns = links.filter(l => !l.includes('..')).map(name => {
      const clean = name.replace(/\/$/, '');
      const yearMatch = clean.match(/(\d{2})$/);
      const yr2 = yearMatch ? parseInt(yearMatch[1]) : null;
      const fullYear = yr2 != null ? (yr2 >= 96 ? 1900+yr2 : 2000+yr2) : null;
      const prefix = clean.replace(/\d+$/, '');
      return { name: clean, prefix, year: fullYear, url: BASE_URL + clean + '/' };
    });
    const years = [...new Set(allCampaigns.map(c=>c.year).filter(Boolean))].sort((a,b)=>b-a);
    const yrSel = document.getElementById('br-year');
    yrSel.innerHTML = '<option value="">-- Year --</option>' +
      years.map(y=>`<option value="${y}">${y}</option>`).join('');
    brStatus.textContent = `${allCampaigns.length} campaigns`;
  } catch(e) {
    brStatus.textContent = 'Fetch failed';
    let proxyMsg;
    if (e.needsProxy && !e.workerConfigured) {
      proxyMsg = `<b style="color:#f5a623;">No proxy configured.</b><br>Set <code style="background:#111;padding:1px 5px;border-radius:3px;color:#8cf;">WORKER_URL</code> in the HTML or run <code style="background:#111;padding:1px 5px;border-radius:3px;color:#8cf;">python3 proxy.py</code>.`;
    } else if (e.needsProxy && e.workerConfigured) {
      proxyMsg = `<b style="color:#f5a623;">Worker not responding.</b><br>
        The worker URL is set but all fetches failed. Possible causes:<br>
        &bull; Worker code not deployed (still showing Cloudflare placeholder)<br>
        &bull; Worker script has an error<br>
        &bull; Network / firewall blocking the request<br><br>
        <b>Test your worker directly:</b><br>
        <a href="${WORKER_URL}/health" target="_blank" style="color:#4af;">${WORKER_URL}/health</a> &nbsp;→ should show <code style="color:#8cf;">ok</code><br><br>
        <a href="${WORKER_URL}/proxy?url=${encodeURIComponent(BASE_URL)}" target="_blank" style="color:#4af;">Click here to test a live data fetch</a> &nbsp;→ should show AOML HTML<br><br>
        If those links don't work, re-deploy <code style="background:#111;padding:1px 5px;border-radius:3px;color:#8cf;">worker.js</code> to your Cloudflare Worker.`;
    } else {
      proxyMsg = `<b>Fetch error:</b> ${e.message}`;
    }
    document.getElementById('br-flight-list').innerHTML =
      `<div style="color:#c88;font-family:monospace;font-size:11px;grid-column:1/-1;line-height:1.9;padding:8px 0;">${proxyMsg}</div>`;
    console.error('fetchCampaignList error:', e.message);
  }
}

function browseYear() {
  const yr = parseInt(document.getElementById('br-year').value);
  const campaigns = allCampaigns.filter(c => c.year === yr);
  const campSel = document.getElementById('br-campaign');
  campSel.innerHTML = '<option value="">-- Campaign --</option>' +
    campaigns.map(c=>`<option value="${encodeURIComponent(c.url)}">${c.name}</option>`).join('');
  currentFlights = [];
  renderFlightList([]);
}

async function browseCampaign() {
  const encoded = document.getElementById('br-campaign').value;
  if (!encoded) return;
  const campUrl = decodeURIComponent(encoded);
  const brStatus = document.getElementById('br-status');
  brStatus.textContent = 'Fetching flights…';
  document.getElementById('br-flight-list').innerHTML =
    '<div style="color:#445;font-family:monospace;font-size:11px;grid-column:1/-1;padding:12px 0;">Scanning operproc directory…</div>';
  try {
    const opUrl = campUrl.replace(/\/+$/, '') + '/operproc/';
    const html = await proxyFetch(opUrl);
    // Match both NETCDF and DFRD (FRD ascii) files; prefer NETCDF when both exist
    //const allLinks = [...html.matchAll(/href="([^"]*_(NETCDF|DFRD|FRD)\.tar\.gz)"/gi)].map(m=>m[1]);
	const allLinks = [...html.matchAll(/href="([^"]*(?:[_\.](?:netcdf|d?frd))\.tar\.gz)"/gi)].map(m => m[1]);
	
    // Group by flight id, prefer NETCDF
    const byFlight = {};
    allLinks.forEach(href => {
      const fn = href.split('/').pop();
      const isNC = fn.includes('_NETCDF');
      const id = fn.replace('_NETCDF.tar.gz','').replace('_DFRD.tar.gz','');
      if (!byFlight[id] || isNC) byFlight[id] = { href, isNC };
    });
    const links = Object.values(byFlight).map(v => v.href);
    currentFlights = links.map(href => {
      const filename = href.split('/').pop();
      //const id = filename.replace('_NETCDF.tar.gz','');
	  let id = filename.slice(0,10); // get only flight id
	  id = id.replace(/\.$/, ''); // remove trailing period (for fights before 2010)
      let url;
      if (href.startsWith('http')) url = href;
      else if (href.startsWith('/')) url = 'https://www.aoml.noaa.gov' + href;
      else url = opUrl.replace(/\/+$/, '') + '/' + filename;
      const dateStr = id.slice(0,8);
      const typeId = id.slice(8);
      const aircraftMap = {H:'NOAA42', I:'NOAA43', N:'NOAA49'};
      const isFRD = filename.toLowerCase().includes('frd');
      return { id, url, filename, isFRD,
        date: `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`,
        aircraft: aircraftMap[typeId[0].toUpperCase()]||typeId[0], typeId,
        loaded: loadedFlightIds.has(id) };
    });
    selectedFlights.clear();
    document.getElementById('br-sel-all').checked = false;
    brStatus.textContent = `${currentFlights.length} flights`;
    renderFlightList(currentFlights);
  } catch(e) {
    brStatus.textContent = 'Error — see console';
    document.getElementById('br-flight-list').innerHTML =
      `<div style="color:#a44;font-family:monospace;font-size:11px;grid-column:1/-1;">${e.message}</div>`;
    console.error('browseCampaign:', e);
  }
}

function filterFlights() { 
	renderFlightList(currentFlights); 
}

function renderFlightList(flights) {
  const filter = (document.getElementById('br-filter').value||'').toLowerCase();
  const visible = (flights||currentFlights).filter(f =>
    !filter || f.id.toLowerCase().includes(filter) || f.date.includes(filter));
  updateSelCount();
  const container = document.getElementById('br-flight-list');
  if (!visible.length) {
    container.innerHTML = '<div style="color:var(--text);font-family:monospace;font-size:11px;grid-column:1/-1;">No flights match.</div>';
    return;
  }
  container.innerHTML = visible.map(f => {
    const cls  = f.loaded ? 'loaded' : selectedFlights.has(f.id) ? 'selected' : '';
    const chk  = selectedFlights.has(f.id) ? 'checked' : '';
    const mark = f.loaded ? '<span style="font-size:9px;color:#4a8;margin-left:auto;flex-shrink:0;">&#10003; ON MAP</span>' : '';
    return `<div class="flight-card ${cls}" data-id="${f.id}" onclick="toggleFlight('${f.id}',event)" title="${f.isFRD?'FRD ascii format':'NetCDF format'}">
      <input type="checkbox" ${chk} onclick="event.stopPropagation();toggleFlight('${f.id}',event)">
      <div style="min-width:0;">
        <div class="fc-id">${f.id}</div>
        <div class="fc-meta">${f.date} &middot; ${f.aircraft}${f.isFRD?' &middot; <span style="color:#fa4">FRD</span>':''}</div>
      </div>${mark}
    </div>`;
  }).join('');
}

function toggleFlight(id, event) {
  if (selectedFlights.has(id)) selectedFlights.delete(id);
  else selectedFlights.add(id);
  const card = document.querySelector(`.flight-card[data-id="${id}"]`);
  if (card) {
    const chk = card.querySelector('input[type=checkbox]');
    const flight = currentFlights.find(f=>f.id===id);
    if (chk) chk.checked = selectedFlights.has(id);
    if (flight && !flight.loaded) card.className = `flight-card ${selectedFlights.has(id)?'selected':''}`;
  }
  updateSelCount();
}

function toggleSelectAll() {
  const filter = (document.getElementById('br-filter').value||'').toLowerCase();
  const visible = currentFlights.filter(f=>!filter||f.id.toLowerCase().includes(filter)||f.date.includes(filter));
  const allChecked = document.getElementById('br-sel-all').checked;
  visible.forEach(f => allChecked ? selectedFlights.add(f.id) : selectedFlights.delete(f.id));
  renderFlightList(currentFlights);
}

function updateSelCount() {
  const n = selectedFlights.size;
  document.getElementById('br-sel-count').textContent = n ? `${n} selected` : '';
}

async function loadSelectedFlights() {
  if (!selectedFlights.size) { setStatus('NO FLIGHTS SELECTED','err'); return; }
  closeBrowser();
  // Clear map — only load freshly selected flights
  markers.forEach(m => map.removeLayer(m));
  markers = []; sondes = []; loadedFlightIds.clear();
  selectedIdx = -1;
  currentFlights.forEach(f => f.loaded = false);

  const toLoad = currentFlights.filter(f=>selectedFlights.has(f.id));
  let ok=0, fail=0;
  for (const f of toLoad) {
    setStatus(`LOADING ${ok+fail+1}/${toLoad.length}: ${f.id}`,'loading');
    try {
      await loadTarGz(f.url, f.id);
      loadedFlightIds.add(f.id); f.loaded=true; ok++;
    } catch(e) { fail++; console.warn(`Failed ${f.id}:`,e.message); }
  }
  if (sondes.length) { 
	renderMap();  // add sondes to map
	setup_var_plotter(); // set up planview plotter interface
	updateProbeList(); // add sondes to dropdown
	//precompute_plots(); // precompute plots and add to cache
	render_cache_btns("show");
  }
  setStatus(fail ? `LOADED ${ok}, FAILED ${fail}` : `LOADED ${ok} FLIGHT${ok!==1?'S':''}`, ok>0?'ok':'err');
}

async function loadFlightById() {
  const raw = document.getElementById('url-input').value.trim();
  if (!raw) { setStatus('ENTER FLIGHT ID OR URL','err'); return; }
  if (raw.startsWith('http')) { loadFile(); return; }
  const m = raw.match(/^(\d{8})([HINhin]\d)$/i);
  if (!m) { setStatus('INVALID — expect e.g. 20240630I1','err'); return; }
  const id = raw.toUpperCase();
  const yr2 = id.slice(2,4);
  const url = await getValidFileUrl(id, yr2); // get URL for NETCDF or FRD files
  setStatus(`FETCHING ${id}…`,'loading');
  try {
    await loadTarGz(url, id);
    loadedFlightIds.add(id); 
	renderMap();  // add sondes to map
	setup_var_plotter(); // set up planview plotter interface
	updateProbeList(); // add sondes to dropdown
	//precompute_plots(); // precompute plots and add to cache
	render_cache_btns("show");
    setStatus(`LOADED ${id} (${sondes.length} sondes)`,'ok');
  } catch(e) {
    if (e.needsProxy) {
      setStatus('NO PROXY — see console','err');
      alert(WORKER_URL
        ? 'Cloudflare Worker unreachable.\nCheck the WORKER_URL in the HTML file.'
        : 'No proxy configured.\n\nOption A: Deploy cloudflare-worker/worker.js to Cloudflare Workers (free)\n         and set WORKER_URL in this HTML file.\n\nOption B: Run  python3 proxy.py  locally.');
    } else { setStatus('ERR: '+e.message.slice(0,50),'err'); }
    console.error('loadFlightById:',e);
  }
}

// Function to check if url to data exists
async function getValidFileUrl(id, yr2) {

    const urlDFRD   = `${BASE_URL}HURR${yr2}/operproc/${id}_DFRD.tar.gz`;
    const urlNETCDF = `${BASE_URL}HURR${yr2}/operproc/${id}_NETCDF.tar.gz`;

	// Try NETCDF first
	try {
		await proxyFetch(urlNETCDF, true); // test if url exists
		return urlNETCDF;
	} catch (e) {}

    // If not try DFRD
	try {
		await proxyFetch(urlDFRD, true); // test if url exists
		return urlDFRD;
	} catch (e) {}
    
    throw new Error("Neither DFRD nor NETCDF file exists");
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('url-input');
  if (inp) inp.addEventListener('keydown', e => { if (e.key==='Enter') loadFlightById(); });
});

document.addEventListener('click', e => {
  const overlay = document.getElementById('browser-overlay');
  if (overlay && overlay.classList.contains('open') && e.target===overlay) closeBrowser();
});


//#######################################################
//#################### File Dropdown ####################
//#######################################################
function updateProbeList() {
  const sel = document.getElementById('file-dropdown');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select a File --</option>';
  sondes.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const shortId = s.id.split('::').pop().replace(/_PQC$/,'');
    opt.textContent = `${shortId}  (${s.mlon.toFixed(1)}°, ${s.mlat.toFixed(1)}°)`;
    sel.appendChild(opt);
  });
}

function dropdownSelect() {
  const sel = document.getElementById('file-dropdown');
  const i = parseInt(sel.value);
  if (!isNaN(i)) {
	  renderMetPy(i);
  } else {
	  clearPlot();
  };
}


//#######################################################
//################# PROXY CONFIGURATION #################
//#######################################################

function fetchWithTimeout(url, ms, options) {
  const timeout = new Promise((_,reject) =>
    setTimeout(() => reject(new Error('Timeout after '+ms+'ms')), ms));
  return Promise.race([fetch(url, options||{}), timeout]);
}

async function proxyFetch(url, binary = false) {
  url = url.replace(/([^:])\/\/+/g, '$1/');
  const proxies = [];
  if (WORKER_URL) proxies.push({ type:'worker', base:WORKER_URL });
  proxies.push({ type:'local', base:LOCAL_PROXY_URL });
  if (_lastWorkingProxy) {
    const hit = proxies.findIndex(p=>p.type===_lastWorkingProxy);
    if (hit > 0) proxies.unshift(proxies.splice(hit,1)[0]);
  }
  for (const proxy of proxies) {
    const endpoint = `${proxy.base}/proxy?url=${encodeURIComponent(url)}`;
    try {
      const resp = await fetchWithTimeout(endpoint, 40000);
      if (!resp.ok) {
        const body = await resp.text().catch(()=>'');
        throw new Error(`HTTP ${resp.status}: ${body.slice(0,120)}`);
      }
      _lastWorkingProxy = proxy.type;
      updateProxyBadge(proxy.type);
      return binary ? new Uint8Array(await resp.arrayBuffer()) : await resp.text();
    } catch(e) {
      console.warn(`${proxy.type} proxy failed:`, e.message);
    }
  }
  const err = new Error('NO_PROXY');
  err.needsProxy = true;
  err.workerConfigured = !!WORKER_URL;
  throw err;
}

function updateProxyBadge(type) {
  const badge = document.getElementById('proxy-badge');
  if (!badge) return;
  if (type==='worker') {
    badge.textContent='PROXY: WORKER'; badge.style.color='#4af'; badge.style.borderColor='#1a3a5a';
    badge.title='Cloudflare Worker: '+WORKER_URL;
  } else if (type==='local') {
    badge.textContent='PROXY: LOCAL'; badge.style.color='#4a8'; badge.style.borderColor='#1a4a2a';
    badge.title='Local proxy on port 8765';
  }
}

async function checkLocalProxy() {
  try {
    const r = await fetchWithTimeout(LOCAL_PROXY_URL+'/health', 800);
    return r.ok;
  } catch { return false; }
}


// ─── LOAD FILE ───────────────────────────────────────────────────────────────
async function loadFile() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) { setStatus('NO URL', 'err'); return; }
  setStatus('FETCHING…', 'loading');
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    parseNetCDF(buf);
    setStatus('LOADED', 'ok');
  } catch(e) {
    setStatus('ERR: ' + e.message.slice(0,30), 'err');
    console.error(e);
  }
}


// ─── TAR.GZ + NETCDF PARSING ─────────────────────────────────────────────────
async function loadTarGz(url, flightId) {
  setStatus(`FETCHING ${flightId}…`, 'loading');
  const compressed = await proxyFetch(url, true);
  setStatus(`DECOMPRESSING ${flightId}…`, 'loading');
  let decompressed;
  try { decompressed = pako.ungzip(compressed); }
  catch(e) {
    try { decompressed = pako.inflate(compressed); }
    catch(e2) { throw new Error('Decompression failed: '+e.message); }
  }
  setStatus(`PARSING ${flightId}…`, 'loading');

  // Inventory ALL files in the tar for diagnosis
  const allEntries = parseTarAll(decompressed);
  //console.log(`${flightId} tar contents (${allEntries.length} files):`);
  //allEntries.forEach(e => console.log(`  ${e.name}  ${e.size}b  binary=${e.isBinary}`));

  // Separate NetCDF from text files
  const ncFiles  = allEntries.filter(e => e.isNC);
  const txtFiles = allEntries.filter(e => !e.isNC && !e.isBinary && e.size > 100);

  let count = 0;
  if (ncFiles.length) {
    for (const e of ncFiles) {
      try {
        const sonde = parseSingleNetCDF(e.data.buffer, flightId, e.name);
        if (sonde) { sondes.push(sonde); count++; }
      } catch(e2) { console.warn('NetCDF parse error:', e.name, e2.message); }
    }
    if (!count) throw new Error(`${flightId}: ${ncFiles.length} .nc files found but none parsed successfully`);
  } else if (txtFiles.length) {
    for (const e of txtFiles) {
      try {
        const sonde = parseFRD(e.text, flightId, e.name);
        if (sonde) { sondes.push(sonde); count++; }
      } catch(e2) { console.warn('FRD parse error:', e.name, e2.message); }
    }
    if (!count) throw new Error(`${flightId}: ${txtFiles.length} text files found but none parsed as FRD`);
  } else {
    throw new Error(`${flightId}: no usable files found in tar (${allEntries.length} total entries)`);
  }
  return count;
}

// Parse ALL files from a tar buffer — handles GNU long names, ustar, POSIX
function parseTarAll(buf) {
  const entries = [], dec = new TextDecoder('latin1');
  let offset = 0, pendingLongName = null;

  while (offset + 512 <= buf.length) {
    const hdr = buf.slice(offset, offset + 512);
    if (hdr.every(b => b === 0)) break;

    // Name field (bytes 0–99) + ustar prefix (bytes 345–499)
    let nameRaw = dec.decode(hdr.slice(0, 100)).replace(/\0.*/,'');
    const prefix = dec.decode(hdr.slice(345, 500)).replace(/\0.*/,'');
    if (prefix) nameRaw = prefix + '/' + nameRaw;
    const name = pendingLongName || nameRaw;
    pendingLongName = null;

    // Size (bytes 124–135, octal)
    const sizeStr = dec.decode(hdr.slice(124, 136)).trim().replace(/\0.*/,'');
    const size = parseInt(sizeStr, 8) || 0;

    // Type flag (byte 156)
    const type = String.fromCharCode(hdr[156]);

    offset += 512;

    if (type === 'L') {
      // GNU long name — next block contains the real name
      pendingLongName = dec.decode(buf.slice(offset, offset + size)).replace(/\0.*/,'');
    } else if ((type === '0' || type === '\0' || type === '') && size > 0) {
      const data = buf.slice(offset, offset + size);
      // Detect if binary: check for null bytes in first 512 bytes
      const sample = data.slice(0, Math.min(512, data.length));
      const nullCount = sample.filter ? 
        Array.from(sample).filter(b => b === 0).length :
        (()=>{ let n=0; for(let i=0;i<sample.length;i++) if(sample[i]===0) n++; return n; })();
      const isBinary = nullCount > sample.length * 0.1;
      const isNC = /\.nc$/i.test(name) || /\.netcdf$/i.test(name) ||
                   (!isBinary && size > 8 && (() => {
                     const m = data.slice(0,4);
                     return (m[0]===0x43&&m[1]===0x44&&m[2]===0x46) || // CDF
                            (m[0]===0x89&&m[1]===0x48&&m[2]===0x44&&m[3]===0x46); // HDF
                   })());
      let text = null;
      if (!isBinary) {
        try { text = new TextDecoder('ascii', {fatal:false}).decode(data); } catch {}
      }
      entries.push({ name, size, isBinary, isNC, data, text });
    }

    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function parseFRD(text, flightId, filename) {
  // Direct JS port of rd_frd_sondes() from frd_reader.py
  // Header layout (0-indexed lines):
  //   Line 15: launch date  chars [7:13] = YYMMDD
  //   Line 16: launch time  chars [7:13] = HHMMSS
  //   Line 21: first data line (skiprows=21)
  // Column order (19-col modern files):
  //   0:index 1:time 2:pres 3:temp 4:rh 5:geo_alt_pth 6:wdir 7:wspd
  //   8:u_wind 9:v_wind 10:nsat 11:w 12:geo_alt_wind
  //   13:pres_flag 14:temp_flag 15:rh_flag 16:wind_flag 17:lat 18:lon
  // Column order (23-col older files, e.g. Earl 2010):
  //   same as above plus 19:zw 20:wskts 21:wsmph 22:thetae
  // Fill value: -999  (also -999.0)
  // Data is top-down — we reverse to get surface first (matches Python [::-1])

  const FILL = -999;
  const lines = text.split('\n');

  // ── Parse header ───────────────────────────────────────────────────────────
  // lines[15] = "  Date: YYMMDD ..." → chars 7–13
  // lines[16] = "  Time: HHMMSS ..." → chars 7–13
  let launchDate = '', launchTime = '';
  if (lines.length > 16) {
    launchDate = (lines[15] || '').slice(7, 13).trim();
    launchTime = (lines[16] || '').slice(7, 13).trim();
  }
  //console.log(`parseFRD ${filename}: launch ${launchDate} ${launchTime}`);

  // Detect number of columns from line 21 (first data line, 0-indexed)
  let numCols = 0;
  if (lines.length > 21) {
    const sample = lines[21].trim().split(/\s+/).filter(s => s.length > 0);
    numCols = sample.length;
  }
  //console.log(`parseFRD ${filename}: ${numCols} columns detected`);

  // ── Read data lines (skiprows=21 → start at index 21) ─────────────────────
  const raw = {
    index:[], time:[], pres:[], temp:[], rh:[], geo_alt_pth:[],
    wdir:[], wspd:[], u_wind:[], v_wind:[], nsat:[], w:[], geo_alt_wind:[],
    pres_flag:[], temp_flag:[], rh_flag:[], wind_flag:[], lat:[], lon:[]
  };

  for (let li = 21; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    // Expect at least 19 tokens; skip short/malformed lines
    if (parts.length < 19) continue;

    // Col 0 is a string index like "001" — parse as number or NaN
    const parseF = s => { const n = parseFloat(s); return isNaN(n) ? NaN : n; };

    if (numCols >= 19) {
      // Modern 19-col layout
      raw.index.push(parts[0]);
      raw.time.push(parseF(parts[1]));
      raw.pres.push(parseF(parts[2]));
      raw.temp.push(parseF(parts[3]));
      raw.rh.push(parseF(parts[4]));
      raw.geo_alt_pth.push(parseF(parts[5]));
      raw.wdir.push(parseF(parts[6]));
      raw.wspd.push(parseF(parts[7]));
      raw.u_wind.push(parseF(parts[8]));
      raw.v_wind.push(parseF(parts[9]));
      raw.nsat.push(parseF(parts[10]));
      raw.w.push(parseF(parts[11]));
      raw.geo_alt_wind.push(parseF(parts[12]));
      raw.pres_flag.push(parseF(parts[13]));
      raw.temp_flag.push(parseF(parts[14]));
      raw.rh_flag.push(parseF(parts[15]));
      raw.wind_flag.push(parseF(parts[16]));
      raw.lat.push(parseF(parts[17]));
      raw.lon.push(parseF(parts[18]));
    } else {
      continue; // skip if not enough columns
    }
  }

  const n = raw.pres.length;
  if (n < 5) {
    console.warn(`parseFRD ${filename}: only ${n} data lines found`);
    return null;
  }

  // ── Apply fill-value masking (mirrors Python masking logic) ───────────────
  // Flag arrays: 0 = good, non-zero = bad
  const mask = (arr, fillVal, flagArr) => arr.map((v, i) => {
    const isFill = (v === fillVal || v === -999.0);
    const isBad  = flagArr ? (flagArr[i] !== 0) : false;
    return (isFill || isBad || !isFinite(v)) ? NaN : v;
  });

  const pres        = mask(raw.pres,         FILL, raw.pres_flag);
  const temp        = mask(raw.temp,         FILL, raw.temp_flag);
  const rh          = mask(raw.rh,           FILL, raw.rh_flag);
  const alt         = mask(raw.geo_alt_pth,  FILL, null);
  const wdir        = mask(raw.wdir,         FILL, raw.wind_flag);
  const wspd        = mask(raw.wspd,         FILL, raw.wind_flag);
  let   lat         = mask(raw.lat,          FILL, null);
  let   lon         = mask(raw.lon,          FILL, null);
  let   time        = mask(raw.time,          FILL, null);

  // Compute dewpoint from RH (mirrors Python mpcalc.dewpoint_from_relative_humidity)
  // Bolton approximation: Td = T - ((100 - RH) / 5)  [simple, accurate to ~1°C]
  // More accurate: Magnus formula
  const dewp = temp.map((t, i) => {
    if (isNaN(t) || isNaN(rh[i]) || rh[i] <= 0) return NaN;
    const rhClamped = Math.min(100, Math.max(0.1, rh[i]));
    // Magnus formula (same as MetPy dewpoint_from_relative_humidity)
    const gamma = Math.log(rhClamped / 100) + (17.625 * t) / (243.04 + t);
    return (243.04 * gamma) / (17.625 - gamma);
  });

  // ── Fix longitude sign (mirrors Python lon correction) ────────────────────
  // Some older FRD files have positive W-hemisphere lons — make negative
  const lonValid = lon.filter(v => !isNaN(v));
  if (lonValid.length > 0 && lonValid.reduce((s,v)=>s+v,0) > 0) {
    // Sum is positive → lons are erroneously positive → negate
    for (let i = 0; i < lon.length; i++) {
      if (!isNaN(lon[i])) lon[i] = -lon[i];
    }
    //console.log(`parseFRD ${filename}: negated longitudes (W-hemisphere fix)`);
  }

  // ── Reverse arrays so surface is first (Python [::-1]) ────────────────────
  pres.reverse(); temp.reverse(); dewp.reverse();// rh.reverse();
  wdir.reverse(); wspd.reverse(); lat.reverse(); lon.reverse();
  alt.reverse(); time.reverse();

  // ── Log summary ────────────────────────────────────────────────────────────
  const validP = pres.filter(v => !isNaN(v));
  //console.log(`parseFRD ${filename}: ${validP.length} valid pressure levels, ` +
  //`pres ${Math.max(...validP).toFixed(0)}–${Math.min(...validP).toFixed(0)} hPa`);

  return buildSonde(pres, temp, dewp, wspd, wdir, lat, lon, alt, time, flightId, filename);
}

function parseSingleNetCDF(buffer, flightId, filename) {
  // Detect format from magic bytes
  const magic = new Uint8Array(buffer, 0, 4);
  const isHDF = magic[0]===0x89 && magic[1]===0x48 && magic[2]===0x44 && magic[3]===0x46;
  const isCDF = magic[0]===0x43 && magic[1]===0x44 && magic[2]===0x46;
  //console.log(`  ${filename}: ${isHDF?'HDF5':isCDF?'CDF-classic':'unknown'} [${Array.from(magic).map(b=>b.toString(16).padStart(2,'0')).join(' ')}]`);

  if (isHDF) return parseHDF5Sonde(buffer, flightId, filename);
  if (isCDF) return parseCDFSonde(buffer, flightId, filename);
  console.warn(`  ${filename}: unrecognised format, skipping`);
  return null;
}

function parseHDF5Sonde(buffer, flightId, filename) {
  if (typeof hdf5 === 'undefined') {
    console.warn('jsfive not loaded — cannot parse HDF5'); return null;
  }
  let f;
  try { f = new hdf5.File(buffer); }
  catch(e) { console.warn(`HDF5 open failed: ${e.message}`); return null; }

  // Helper: read a dataset by trying multiple names
  const readDs = (...names) => {
    for (const n of names) {
      try {
        const ds = f.get(n);
        if (ds && ds.value != null) return Array.from(ds.value);
      } catch {}
    }
    return null;
  };

  // Helper: read a root attribute
  const readAttr = (...names) => {
    for (const n of names) {
      try {
        const v = f.attrs[n];
        if (v != null) return typeof v === 'object' && v.value != null ? v.value : v;
      } catch {}
    }
    return null;
  };

  // AOML NetCDF-4 dropsonde variable names (from D20240704_232444_PQC.nc style files)
  const pres = readDs('pres','pressure','PRES','p','press','air_pressure');
  const temp = readDs('temp','tdry','temperature','TEMP','ta','T','air_temperature');
  const dewp = readDs('dewp','dp','tdew','dew_point','dew_point_temperature','DEWP','td');
  const wspd = readDs('wspd','ws','wind_speed','WSPD','ff');
  const wdir = readDs('wdir','wd','wind_direction','WDIR','dd');
  const latV = readDs('lat','latitude','launch_latitude');
  const lonV = readDs('lon','longitude','launch_longitude');
  const altV = readDs('alt', 'geo_alt_pth', 'height');
  const time = readDs('time');

  if (!pres || !temp) {
    // Log all available keys to help identify correct variable names
    try { console.warn(`  Available keys: ${JSON.stringify(f.keys)}`); } catch {}
    console.warn(`  ${filename}: pres or temp not found in HDF5`);
    return null;
  }

  // Pass full lat/lon arrays — buildSonde will compute the mean
  return buildSonde(pres, temp, dewp, wspd, wdir, latV, lonV, altV, time, flightId, filename);
}

function parseCDFSonde(buffer, flightId, filename) {
  // Classic NetCDF-3 via netcdfjs (fallback for older files)
  let nc, NetCDF = null;
  if (typeof NetCDFReader !== 'undefined') NetCDF = NetCDFReader;
  else if (typeof netcdfjs !== 'undefined') NetCDF = netcdfjs.NetCDFReader || netcdfjs.default || netcdfjs;
  if (!NetCDF) { console.warn('No CDF parser available'); return null; }
  try { nc = new NetCDF(buffer); } catch(e) { console.warn(`CDF parse failed: ${e.message}`); return null; }
  
  // Variable names in file
  const varMap = Object.fromEntries(
	  nc.variables.map(v => [v.name.toLowerCase(), v.name])
  );
  
  // Little function to get data by testing multiple keys
  const get = (...names) => {
	  for (const n of names) {
		const key = varMap[n.toLowerCase()];
		if (key) {
		  return Array.from(nc.getDataVariable(key));
		}
	  }
	  return null;
  };

  //const get = (...ns) => { for (const n of ns) { try { if (nc.variables[n]) return Array.from(nc.getDataVariable(n)); } catch {} } return null; };
  const attr = (...ns) => { for (const n of ns) { const a=(nc.globalAttributes||[]).find(a=>a.name.toLowerCase()===n.toLowerCase()); if (a) return a.value; } return null; };
  const pres = get('pres','pressure','PRES','p'); const temp = get('temp','tdry','TEMP','ta','T');
  if (!pres||!temp) return null;
  const dewp=get('dewp','dp','tdew','td'), wspd=get('wspd','ws','ff'), wdir=get('wdir','wd','dd');
  const latV=get('lat','latitude'), lonV=get('lon','longitude');
  altV=get('alt', 'altitude'), time=get('time');
  
  return buildSonde(pres, temp, dewp, wspd, wdir, latV, lonV, altV, time, flightId, filename);
}

// Function to call Python endpoint for reading BUFR data
async function fetchBufr() {
    const res = await fetch(METPY_SERVER + "/bufr");
    return await res.json();
}

function buildSonde(pres, temp, dewp, wspd, wdir, sLatArr, sLonArr, sAltArr, sTimeArr, flightId, filename) {
  
  const FILL = -999;
  // Replace fill values (-999 and variants) with NaN so they're excluded downstream
  const defill = arr => arr ? arr.map(v => (v == null || v <= FILL + 1 || !isFinite(v)) ? NaN : v) : null;

  let presArr = defill([...pres]);
  let tempArr = defill([...temp]);
  let dewpArr = defill(dewp ? [...dewp] : null);
  let wspdArr = defill(wspd ? [...wspd] : null);
  let wdirArr = defill(wdir ? [...wdir] : null);
  let latArr  = defill(sLatArr ? [...sLatArr] : null);
  let lonArr  = defill(sLonArr ? [...sLonArr] : null);
  let altArr  = defill(sAltArr ? [...sAltArr] : null);
  let timeArr  = defill(sTimeArr ? [...sTimeArr] : null);
  
  // If altitude is all none: return null
  if (altArr.every(value => Number.isNaN(value))) { console.warn(`  Altitude data is not available: ${filename}`); return null; }
  
  // Unit normalisation
  if (tempArr.some(v=>v>150)) tempArr = tempArr.map(v => isNaN(v) ? NaN : v - 273.15);
  if (dewpArr && dewpArr.some(v=>v>150)) dewpArr = dewpArr.map(v => isNaN(v) ? NaN : v - 273.15);
  if (presArr.some(v=>v>2000)) presArr = presArr.map(v => isNaN(v) ? NaN : v / 100);

  // Filter levels where pres or temp are invalid
  const valid = presArr.map((p,i) =>
    !isNaN(p) && p > 10 && p < 1100 &&
    !isNaN(tempArr[i]) && tempArr[i] > -150 && tempArr[i] < 60);
  const filt = arr => arr ? arr.filter((_,i) => valid[i]) : null;
  presArr = filt(presArr); tempArr = filt(tempArr);
  dewpArr = filt(dewpArr); wspdArr = filt(wspdArr); wdirArr = filt(wdirArr);
  latArr  = filt(latArr);  lonArr  = filt(lonArr); altArr  = filt(altArr); timeArr  = filt(timeArr);
  if (presArr.length < 5) { console.warn(`  Too few valid levels: ${presArr.length}`); return null; }

  // Compute mean lat/lon from the profile (ignore NaN values)
  let sLat, sLon;
  if (latArr && latArr.length) {
    const validLats = latArr.filter(v => !isNaN(v) && Math.abs(v) <= 90);
    const validLons = lonArr ? lonArr.filter(v => !isNaN(v) && Math.abs(v) <= 180) : [];
    sLat = validLats.length ? validLats.reduce((a,b)=>a+b,0)/validLats.length : 25.0;
    sLon = validLons.length ? validLons.reduce((a,b)=>a+b,0)/validLons.length : -70.0;
  } else {
    sLat = 25.0; sLon = -70.0;
  }

 // Calculate thetae and RH
 const thetae = calc_thetae(tempArr, dewpArr, presArr)
 const rh = calc_rh(tempArr, dewpArr)
 
  // Sort descending pressure (surface first)
  const order = presArr.map((_,i)=>i).sort((a,b) => presArr[b] - presArr[a]);
  const reorder = arr => arr ? order.map(i => arr[i]) : null;

  const ncId = filename.replace(/\.nc$/i,'').split('/').pop();
  //console.log(`  OK: ${ncId} — ${presArr.length} levels, lat=${sLat.toFixed(2)}, lon=${sLon.toFixed(2)}`);
  return {
	id: `${flightId}::${ncId}`, flightId,
    pres:   reorder(presArr),
	temp:   reorder(tempArr),
    dewp:   reorder(dewpArr), 
	wspd:   reorder(wspdArr), 
	wdir:   reorder(wdirArr),
	thetae: reorder(thetae),
	rh:     reorder(rh),
	alt:    reorder(altArr), 
	lat:    reorder(latArr), // lat array
	lon:    reorder(lonArr), //lon array
	mlat:   sLat, // mean lat
	mlon:   sLon, // mean lon
	time:   reorder(timeArr),
  };
}


//####################################################
//################# REALTIME POLLING #################
//####################################################

// Activate real-time mode on page load
document.addEventListener("DOMContentLoaded", function() {
	realtime_deactivate();
});

const data_selector_row = document.getElementById('data-browser');
const rt_controls_row = document.getElementById('rt_controls');
const realtime_btn = document.getElementById('realtime-btn');
const research_btn = document.getElementById('research-btn');
let loader_cont, loader_text, loader_bar

// Function for when real time mode is started
async function realtime_activate() {
	RT_MODE = true;
	
	// Data loading interface
	loader_cont = document.getElementById("loader-container_rt")
	loader_text = document.getElementById("loader-text_rt")
	loader_bar  = document.getElementById("loader-bar_rt")
	cache_btns = document.getElementById("cache-btns_rt")
	
	// Page formatting
	realtime_btn.classList.remove('snd-btn-plain');
	realtime_btn.classList.add('btn-primary');
    research_btn.classList.remove('btn-primary');
	research_btn.classList.add('snd-btn-plain');
	data_selector_row.classList.add('hidden'); // hide data_selector row
	rt_controls_row.classList.remove('hidden'); // show rt_controls row
    
    // Reset app
	reset_app();

	// Get latest data
	checkRtUpdates();
 }

// Function for switching to researcgh mode
function realtime_deactivate() {
	
	// Data loading interface
	loader_cont = document.getElementById("loader-container")
	loader_text = document.getElementById("loader-text")
	loader_bar  = document.getElementById("loader-bar")
	cache_btns = document.getElementById("cache-btns")
	
	// Page formatting
	realtime_btn.classList.remove('btn-primary');
	realtime_btn.classList.add('snd-btn-plain');
	research_btn.classList.remove('snd-btn-plain');
    research_btn.classList.add('btn-primary');
	data_selector_row.classList.remove('hidden'); // show data_selector row
	rt_controls_row.classList.add('hidden'); // hide rt_controls row
	
	// Reset app
	reset_app()
	
	lastRtUpdate = null
	
	RT_MODE = false;
}

// Poll realtime server to get latest data
async function loadRealTime() {
	
	// Otherwise load new data
	console.log('Loading Real-time data');
	
	const resp = await fetchWithTimeout(REALTIME_SERVER + "/latest", 15000, {
      method:  'POST',
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'unknown' }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    } 
	
	// Get latest data
	const rt_data = await resp.json();
	const profiles = rt_data.profiles;
	const fnames = rt_data.fnames;

	// Add data to sondes variable
	if (profiles.length) {
		for (let i = 0; i < profiles.length; i++) {
			try {
				if (fnamesRt.includes(fnames[i])) {
					continue;
				} // skip loop if sonde is already loaded
				
				const sonde = buildSonde(profiles[i].pressure, 
										 profiles[i].temperature, 
										 profiles[i].dewpoint, 
										 profiles[i].wspd, 
										 profiles[i].wdir, 
										 profiles[i].lat, 
										 profiles[i].lon, 
										 profiles[i].alt, 
										 profiles[i].time, 
										 `RT${i}`, 
										 fnames[i])
				if (sonde) { sondes.push(sonde); } // add sonde data to sondes list
				
				if (fnames[i]) { fnamesRt.push(fnames[i]); } // add fname to fnames list
			} catch(e2) { console.warn('Real-time read error:', fnames[i], e2.message); }
		} 
	}
	
	if (sondes.length) {upadte_rt_controls();} // Update controls container
	renderMap();  // add sondes to map
	setup_var_plotter(); // set up planview plotter interface
	updateProbeList(); // add sondes to dropdown
	//precompute_plots(); // precompute plots and add to cache
	render_cache_btns("show");
	console.log(`LOADED (${sondes.length} sondes)`,'ok');
	
	// Save RT sondes and markers in new variable
	markers_rt = markers;
	sondes_rt = sondes; 
}

// Update realtime control bar
function upadte_rt_controls() {
	const realtime_text = document.getElementById("realtime-text")
	realtime_text.innerText =  `${sondes.length} real-time sondes`;	
}

// Check if realtime data was updated
async function checkRtUpdates() {
	const loader_count = document.getElementById("loader-count_rt")
	loader_count.innerText = "Checking for new files...";
	
	// Get time of last update
    const meta = await fetch(REALTIME_SERVER + "/latest/meta").then(r => r.json());
	
	// if last update is not equal to current update, get new dropsondes
    if (meta.updated !== lastRtUpdate) {
    //if (meta.updated > 0) {
		// Add loaded realtime sondes back to sondes
		sondes = sondes_rt
		markers = markers_rt
		
        lastRtUpdate = meta.updated;
		
		// Show how many new files are loading
		loader_count.innerText = `Loading ${meta.count} new files`;

	    // get new data
        loadRealTime()
		
		// hide new files text
		loader_count.innerText = "";
	
	// If reloading realtime sondes
	
    }/*else if (sondes_rt.length !== sondes.length){
		loader_count.innerText = "Loading from cache";
		
		// Add loaded realtime sondes back to sondes
		sondes = sondes_rt
		markers = markers_rt
		
		//loadRealTime()
		renderMap();  // add sondes to map
		updateProbeList(); // add sondes to dropdown
		//precompute_plots(); // precompute plots and add to cache
		update_marker_colors();
		console.log(`LOADED (${sondes.length} sondes)`,'ok');
		
		// hide new files text
		loader_count.innerText = "";
	
	// If no new files found
	}*/ else {
		loader_count.innerText = "No new files found";
		setTimeout(() => {
			loader_count.innerText = "";
		}, 2000);
	}
}


//#####################################################
//############### Sounding Calculations ###############
//#####################################################

// Function to calculate thetae
function calc_thetae(T_C, Td_C, p_hPa) {

  const Rd = 287.058;
  const Rv = 461.05;
  const eps = Rd / Rv;

  function safeThetae(Tc, Tdc, p) {

    // ---- input validation ----
    if (
      Tc == null || Tdc == null || p == null ||
      !isFinite(Tc) || !isFinite(Tdc) || !isFinite(p)
    ) {
      return null;
    }

    // ---- convert ----
    const Tk = Tc + 273.15;
    const Tdk = Tdc + 273.15;
    const prs = p * 100;

    // ---- saturation vapor pressure ----
    const e1 = 611.2 * Math.exp(
      (17.67 * (Tdk - 273.15)) /
      ((Tdk - 273.15) + 243.5)
    );

    if (!isFinite(e1) || prs <= e1) return null;

    const qv = (eps * e1) / (prs - e1);

    // ---- LCL temperature ----
    const denom = (1 / (Tdk - 56)) + (Math.log(Tk / Tdk) / 800);

    if (!isFinite(denom) || denom === 0) return null;

    const Tlk = (1 / denom) + 56;

    // ---- potential temperature at LCL ----
    const e2 = e1; // same expression (kept consistent)

    const Thlk =
      Tk *
      Math.pow(100000 / (prs - e2), 2 / 7) *
      Math.pow(Tk / Tlk, 0.28 * qv);

    if (!isFinite(Thlk)) return null;

    // ---- equivalent potential temperature ----
    return Thlk *
      Math.exp(((3036 / Tlk) - 1.78) * qv * (1 + 0.448 * qv));
  }

  // ---- vectorized output ----
  const n = Math.max(T_C.length, Td_C.length, p_hPa.length);

  const thetae = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    thetae[i] = safeThetae(T_C[i], Td_C[i], p_hPa[i]);
  }

  return thetae;
}

// Function to calcualte RH
function calc_rh(T_C, Td_C) {

  function safeRH(Tc, Tdc) {

    // ---- validate inputs ----
    if (
      Tc == null || Tdc == null ||
      !isFinite(Tc) || !isFinite(Tdc)
    ) {
      return null;
    }

    const Tk = Tc + 273.15;
    const Tdk = Tdc + 273.15;

    // ---- saturation vapor pressure (from temperature) ----
    const es = 611.2 * Math.exp(
      (17.67 * (Tk - 273.15)) /
      ((Tk - 273.15) + 243.5)
    );

    // ---- actual vapor pressure (from dewpoint) ----
    const e = 611.2 * Math.exp(
      (17.67 * (Tdk - 273.15)) /
      ((Tdk - 273.15) + 243.5)
    );

    // ---- safety check ----
    if (!isFinite(e) || !isFinite(es) || es === 0) {
      return null;
    }

    return (e / es)*100;
  }

  // ---- vectorized output ----
  const n = Math.max(T_C.length, Td_C.length);
  const rh = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    rh[i] = safeRH(T_C[i], Td_C[i]);
  }

  return rh;
}

// Function to get vertical wind using Johnson et al., 2026 method
// Needs more work later




//######################################################
//################## MAP and PLOTTING ##################
//######################################################

// Function to display/hide cache buttons
function render_cache_btns(mode) {
	if (mode === "show") {
		cache_btns.style.display = "flex";
	} else {
		cache_btns.style.display = "none";
	}
}

function renderMap() {
  if (!sondes.length) return;

  // Filter valid sondes
  const validSondes = sondes.filter(s =>
    isFinite(s.mlat) && isFinite(s.mlon) &&
    Math.abs(s.mlat) <= 90 && Math.abs(s.mlon) <= 180
  );

  if (!validSondes.length) {
    console.warn('No sondes with valid lat/lon');
    return;
  }

  // Extract arrays
  const lats = validSondes.map(s => s.mlat);
  const lons = validSondes.map(s => s.mlon);
  const labels = validSondes.map(s => s.id.split('::').pop());

  // Round mean lat/lon to 2 decimal places
  mapLats = lats.map(num => +num.toFixed(2));
  mapLons = lons.map(num => +num.toFixed(2));


  // ---- Compute bounds → center/zoom ----
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  // crude zoom estimate (works fine for most cases)
  const latDiff = maxLat - minLat;
  const lonDiff = maxLon - minLon;
  const maxDiff = Math.max(latDiff, lonDiff);
  const zoomLevel = Math.max(1, 8 - Math.log2(maxDiff + 1));

  Plotly.animate('map', {
    data: [{
      name: 'map-points',
      lat: mapLats,
      lon: mapLons
    }],
    layout: {
      'mapbox.center.lat': centerLat,
      'mapbox.center.lon': centerLon,
      'mapbox.zoom': zoomLevel
    }
  }, {
    transition: {
      duration: 1000,
      easing: 'cubic-in-out'
    },
    frame: {
      duration: 1000,
      redraw: true
    }
  });

  // ---- Click handler ----

  const mapDiv = document.getElementById('map');

  mapDiv.on('plotly_click', function (data) {
    const pointIndex = data.points[0].pointIndex;
    renderMetPy(pointIndex);
  });

}

// Sends dropsonde data to backend to precompute plots and add to cache
async function precompute_plots() {
	//console.log("Here")
	
	if (precomputing) return; // prevents duplicate intervals
	precomputing = true;
	pc_finish = false;
	
	// Display loader div
	loader_cont.style.display = "block";
	loader_text.style.display = "block";
	loader_text.innerText = "Loading data..."

	//console.log("precompute starting")
	await fetch(METPY_SERVER + "/precompute", {
	  method: "POST",
	  headers: { "Content-Type": "application/json" },
	  body: JSON.stringify({
		sondes: sondes, rt: RT_MODE
	  })
	});
	
	//console.log("Polling start (outside poll)")
	// Start polling for progress
	// This loop still runs even after stop precompute is called and running=False
	//precomputeInterval  = setInterval(async () => {
	const intervalId  = setInterval(async () => {
		//console.log("Polling tick Start");
		//console.log("Interval ID (local):", intervalId);
		//console.log("Interval ID (global):", precomputeInterval);
		
		// Stop if precomputing variable is False
		if (!precomputing) {
			//console.log("Polling stopped via flag");
			//clearInterval(precomputeInterval);
			clearInterval(intervalId);
			precomputeInterval = null;
			if (RT_MODE) {
				loader_cont.style.display = "none";
				loader_text.style.display = "none";
				render_cache_btns("hide")
			}
			return;
		}
		
		try {
		  const res = await fetch(METPY_SERVER + "/precompute_status");
		  const data = await res.json();

		  // Update progress bar
		  const percent = data.total > 0
			  ? (data.done / data.total) * 100
			  : 0;

		  loader_bar.style.width = percent + "%";
		  loader_text.innerText = `Caching Plots: ${data.done}/${data.total}`;
		
		  // Update map styling while running
		  update_marker_colors(); // runs METPY_SERVER + /cached_sondes
		
		  // Stop when done
		  if (!data.running) {
			clearInterval(precomputeInterval);
			precomputeInterval = null;
			precomputing = false;
			pc_finish = true;
			if (RT_MODE) {
				loader_cont.style.display = "none";
				loader_text.style.display = "none";
				render_cache_btns("hide")
			}
			return;
		  }

		} catch (err) {
		  console.error("Status fetch failed:", err);
		}

    }, 1000); // poll every second
	
}

// Stop precompute
async function stop_precompute() {
	precomputing = false
	isStopping = true;
	
	await fetch(METPY_SERVER + "/precompute_stop", {method: "POST"});
	
	// stop polling immediately
	if (precomputeInterval !== null) {
		clearInterval(precomputeInterval);
		precomputeInterval = null;
	}
	
	// show stopping message
	const txt_status = loader_text.innerText;
	loader_text.innerText = "Stopping...";

	// wait before hiding
	setTimeout(() => {
		//loader_bar.style.width = "0%";
		//loader_text.innerText = "";
		isStopping = false;
		loader_text.innerText = `Cached ${txt_status.slice(14)}`;
		
		// Only hide controls if precompute was finished
		if (pc_finish) {
			loader_text.style.display = "none";
			loader_cont.style.display = "none";
			render_cache_btns("hide");
		}
		
	}, 1000);
}

async function renderMetPy(i) {
	
  // Start loading animation
  const container = document.getElementById("sounding-plot");
  showLoading(container);
	
  const sonde = sondes[i]
	
  selectedIdx = i;
  markers.forEach((m, j) => {
    m._el.className = 'dropsonde-marker' + (j===i ? ' selected' : '');
  });
  
  // Sync dropdown
  const sel = document.getElementById('file-dropdown');
  if (sel) sel.value = i;
  //const shortId = sonde.id.split('::').pop().replace(/_PQC$/,'');
  //document.getElementById('sonde-id').textContent = shortId;


  //updateDataBar(sondes[i]);

  // Highlight selected marker
  update_marker_colors()
  
  // Build payload — send all sonde data as plain arrays
  const payload = {
    id:   sonde.id,
    lat:  sonde.lat,
    lon:  sonde.lon,
	alt:  sonde.alt || null,
	time:  sonde.time || null,
    pres: sonde.pres,
    temp: sonde.temp,
    dewp: sonde.dewp || null,
    wspd: sonde.wspd || null,
    wdir: sonde.wdir || null,
  };

  console.log("Plotting sounding using", METPY_SERVER)

  try {
    const resp = await fetchWithTimeout(METPY_SERVER + '/plot', 120000, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'unknown' }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
	
	const img = document.getElementById('plot-img');
	//console.log(img)
    img.src = url;
    img.style.Width = '1000px';
    img.style.Height = 'auto';
    img.style.display = 'block';
	img.style.margin = '20px 0px 20px 0px';
    
    const container = document.getElementById('sounding-plot');
    container.innerHTML = '';  // clear previous figure
    container.appendChild(img); // show new figure
	
  } catch (e) {
    console.warn('MetPy render failed:', e.message);
    setStatus('METPY ERR: ' + e.message.slice(0, 40), 'err');
    // Fall back to canvas rendering
    //document.getElementById('metpy-toggle').checked = false;
    //drawSkewT(sonde);
  }  finally {
       hideLoading(); //Stop loading animation
  }
}



//########################################################
//###################### Plotly Map ######################
//########################################################

// Map theme configuration
const themeConfig = {
    light_cache: {
        markerColor: '#000000',  // black markers
        mapStyle: 'open-street-map',
        background: '#fff',
        fontColor: '#000'
    },
    dark_cache: {
        markerColor: '#ffffff',  // white markers
        mapStyle: 'carto-darkmatter',
        background: '#0b1320',
        fontColor: '#eee'
    },
	
	light: {
        markerColor: '#808080',  // gray markers
        mapStyle: 'open-street-map',
        background: '#fff',
        fontColor: '#000'
    },
	
	dark: {
        markerColor: '#808080',  // gray markers
        mapStyle: 'carto-darkmatter',
        background: '#0b1320',
        fontColor: '#eee'
    }
};

// Update map theme if clicked
const toggleBtn = document.getElementById('toggleTheme');
toggleBtn.addEventListener('click', ()=>{
	// Toggle dark class on body
	document.body.classList.toggle('dark');
	
	// Compute current theme after toggle
	const isDark = document.body.classList.contains('dark');
	currentTheme = isDark ? "dark" : "light";
	
	// Update button text
	toggleBtn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
	
	// Update map theme
    updateMapTheme(currentTheme);
	
	// Save theme
    localStorage.setItem("theme", currentTheme);
});

//-----Code to make map and add dropsondes to it-----\\
// Base trace
const trace = {
  type: "scattermapbox",
  lat: [],
  lon: [],
  mode: "markers",
  marker: { 
            size: 15, 
            color: themeConfig[currentTheme].markerColor,
            showscale: false,
            colorbar: {len: 0.65, y:0.3, x: 1}
          },
  name: "map-points",
};

// Plot layout
const layout = {
  mapbox: {
    style: themeConfig[currentTheme].mapStyle, //"open-street-map",
    center: { lat: 40, lon: -100 },
    zoom: 3
  },
  margin: { t: 0, l: 0, r: 0, b: 0 }, //r: 80 does well when adding colorbar, but don't like size without it
  paper_bgcolor: themeConfig[currentTheme].background,
  plot_bgcolor: themeConfig[currentTheme].background,
  font: {color: themeConfig[currentTheme].fontColor},
};

const config = {
  responsive: true
};

// Create initial empty trace
Plotly.newPlot("map", [trace], layout, config);

// Color markers by whether dropsondes are cached or not
async function update_marker_colors() {
	
	// Get cached sondes
	const res = await fetch(METPY_SERVER + "/cached_sondes");
	const data = await res.json();
	const cachedSet = new Set(data.cached);
	//console.log(cachedSet);
	const colors = sondes.map((s, i) => {
		//console.log(s.id);
		if (i === selectedIdx) {
		  return "red";   // highest priority
		}

		if (cachedSet.has(s.id)) {
		  return themeConfig[currentTheme+"_cache"].markerColor;
		}

		return themeConfig[currentTheme].markerColor;
	  });

	Plotly.restyle('map', {'marker.color': [colors]}, [0]);
}

// Switch map to dark mode if toggled on website
function updateMapTheme(currentTheme) {

    const mapDiv = document.getElementById('map');
    if (!mapDiv) return;

	// Get theme colors
    const theme = themeConfig[currentTheme];

	// Update marker color for all traces (works for single-color traces)
	update_marker_colors()

    // Update layout
    Plotly.relayout(mapDiv, {
        'mapbox.style': theme.mapStyle,
        'paper_bgcolor': theme.background,
        'plot_bgcolor': theme.background,
        'font.color': theme.fontColor
    });

}




//#######################################################
//################## Variable Plotting ##################
//#######################################################
const slider = document.getElementById('heightSlider');
const input = document.getElementById('heightInput');
const variableSelect = document.getElementById('variableSelect');
let availableHeights = [];

// Function to interpolate dropsonde data to 25m height grid
function interpolateDropsondeToGrid(height, variables, step = 25, maxH = null) {

	if (!maxH) {
		// Find max height of input data
		let minPres = Infinity; // lowest pressure value
		let sondeId = -1;  // which sonde it came from
		let indMinPres = -1; // index within that sonde
		// Find index of lowest pressure in dropsonde set
		sondes.forEach((sonde, sIdx) => {
			sonde.pres.forEach((p, i) => {
				if (p != null && p < minPres) {
					minPres = p;
					sondeId = sIdx;
					indMinPres = i;
				}
			});
		})
		maxH = sondes[sondeId].alt[indMinPres];
	}

  // 1) build fixed grid
  const grid = [];
  for (let h = 0; h <= maxH; h += step) {
    grid.push(h);
  }

  // 2) sort input
  const data = height.map((h, i) => ({ h, i }))
    .sort((a, b) => a.h - b.h);

  const sortedH = data.map(d => d.h);

  // 3) output structure
  const output = {};
  for (const key in variables) {
    output[key] = new Array(grid.length).fill(null);
  }

  // 4) interpolate helper
  function interp(h, arr) {
    for (let i = 0; i < sortedH.length - 1; i++) {
      const h0 = sortedH[i];
      const h1 = sortedH[i + 1];

      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0);

        const idx0 = data[i].i;
        const idx1 = data[i + 1].i;

        const out = {};
        for (const key in variables) {
          const v0 = variables[key][idx0];
          const v1 = variables[key][idx1];

          out[key] =
            v0 == null || v1 == null
              ? null
              : v0 + t * (v1 - v0);
        }

        return out;
      }
    }
    return null;
  }

  // 5) fill grid
  grid.forEach((h, gi) => {
    const val = interp(h, sortedH);

    if (val !== null) {
      for (const key in variables) {
        output[key][gi] = val[key];
      }
    }
  });

  return {
    height: grid,
    ...output
  };
}

// Function to interpolate the height of the sounding variables for planview plotting
function interp_sonde() {
	sondes.forEach((sonde) => {
		// Interpolate profile to 25m height grid
		const height = sonde["alt"]
		const variables = {
			pres:   sonde["pres"],
			temp:   sonde["temp"],
			dewp:   sonde["dewp"], 
			wspd:   sonde["wspd"], 
			thetae: sonde["thetae"], 
			rh:     sonde["rh"], 
			alt:    sonde["alt"]
		}
		
		sondes_interp.push(interpolateDropsondeToGrid(height, variables));
	});
}

// Function to populate variable dropdown menu and height slider
// Called when loading data
function setup_var_plotter() {
    
	// Get interpolate dropsonde data if not defined
	if (!sondes_interp.length) {
		interp_sonde();
	}
	
    // 1. Get variables from dataset (currently only providing certain vars)
    //    And populate dropsonde variable dropdown once data is loaded
	// Currently hard coded variable names, maybe update later
	const vars = ['Pressure', 'Temperature', 'Dewpoint', 'Relative Humidity', 'Equiv. Pot. Temp.', 'Wind Speed', 'Vertical Wind']
	vars.forEach(value => {
		 // Check if variable already exists
		const exists = Array.from(variableSelect.options).some(
			option => option.value === value
		);
		
		if (!exists) {
			const option = document.createElement('option');
			option.value = value;
			option.text = value;
		variableSelect.appendChild(option);
		}
	});
 
    // 2. Populate heights and initialize slider based on dropsonde data
	availableHeights = sondes_interp[0].alt.filter(item => item !== null);

	// Slider runs over indices, not actual height values
	slider.min = 0;
	slider.max = availableHeights.length - 1;
	slider.step = 1;
	slider.value = 0;
	
	// Initialize input
	input.value = availableHeights[0];
	
	
    // 3. Enable dropdown menu
    variableSelect.disabled = false;
}

// Function to color points on map based on selected dropsonde variable and height
async function updateMap(height = null) {
    const variable = variableSelect.value;

    // Determine height: if none passed in, get from slider index
    if (height === null) {
        const idx = Number(slider.value);
        height = Number(availableHeights[idx]);
    } else {
        height = Number(height);
    }

    // Update the input box
    input.value = height;

    if (!variable) {
        // No variable selected: remove colorbar
        Plotly.restyle('map', {
            'marker.showscale': [false]
        });
        slider.disabled = true;
        input.disabled = true;
        
        // Reset height slider to default height
        const [defaultHeight, nearestIdx] = getHeight(1000);
        slider.value = availableHeights.indexOf(defaultHeight);
        input.value = defaultHeight;
		
		update_marker_colors();
        
        return;
    }

    // Enable controls once variable is chosen
    slider.disabled = false;
    input.disabled = false;

    // Fetch data for this variable & height
	const data = get_planview_data(variable, height)
	
	// Round values to two decimal places
	data.values = data.values.map(num =>
		(num == null || !isFinite(num)) ? null : Number(num.toFixed(2))
	);

    // Update map
    Plotly.restyle('map', {
        text: [data.values.map(v => `${variable}: ${v}`)],
        'marker.color': [data.values],
        'marker.showscale': [true]
    });
}

// Function to get height of slider index
function getHeight(target) {
    const idx = availableHeights.reduce(
        (bestIdx, h, i) => Math.abs(h - target) < Math.abs(availableHeights[bestIdx] - target) ? i : bestIdx,
        0
    );
    return [availableHeights[idx], idx];
}

// Function to get planview data
function get_planview_data(variable, height) {
	
	// Match input variable to data variables
    const ds_vars   = ['pres', 'temp', 'dewp', 'rh', 'thetae', 'wspd', 'W'] // rh, thetae, and W and not calculated yet
    const plot_vars = ['Pressure', 'Temperature', 'Dewpoint', 'Relative Humidity', 'Equiv. Pot. Temp.', 'Wind Speed', 'Vertical Wind']
	const varname = ds_vars[plot_vars.indexOf(variable)];

	// If height not in height array (height array is 
	if (!sondes_interp[0].alt.includes(height)) {
		return {"values": []};
	}
	
	// Get variable values at input height
	const var_height = []
	height_ind = sondes_interp[0].alt.indexOf(height); // index of input height
	sondes_interp.forEach((sonde) => {
		var_height.push(sonde[varname][height_ind]);
	});
	
	return {"values": var_height};
}

// Function to get colorbar details depending on the plot variable
function getColorTable(variable) {
	let cmap, cmin, cmax;

  if (variable === "Pressure") {
    cmap = "Viridis"; cmin = 100; cmax = 1000;
  }
  else if (variable === "Temperature") {
    cmap = "Viridis"; cmin = -100; cmax = 40;
  }
  else if (variable === "Dewpoint") {
    cmap = "Viridis"; cmin = -100; cmax = 40;
  }
  else if (variable === "Equiv. Pot. Temp.") {
    cmap = "Jet"; cmin = 330; cmax = 370;
  }
  else if (variable === "Wind Speed") {
    cmap = "Jet"; cmin = 0; cmax = 80;
  }
  else if (variable === "Vertical Wind") {
    cmap = "Seismic"; cmin = -10; cmax = 10;
  }
  
  else if (variable === "Relative Humidity") {
	// Build RH colormap (Plotly-style colorscale)
	const n = 10;
	const cmap_rh = [];

	function getBrBG(i, n) {
		// simple approximation of matplotlib BrBG
		// (you can replace with a full lookup table if needed)
		const t = i / (n - 1);

		const r = Math.round(166 + (0 - 166) * t);
		const g = Math.round(97 + (90 - 97) * t);
		const b = Math.round(26 + (50 - 26) * t);

		return `rgb(${r},${g},${b})`;
	}

	for (let i = 0; i < n; i++) {
		cmap_rh.push([i / (n - 1), getBrBG(i, n)]);
	}

	cmap = cmap_rh; cmin = 0; cmax = 100;
  }
  
  return {
    cmin: cmin,
    cmax: cmax,
    colorscale: cmap
  };
}


//####### Event listeners #######

// When slider moves, pick height by index
slider.addEventListener('input', () => {
    const idx = Number(slider.value);
    const height = availableHeights[idx];
    input.value = height;
    updateMap(height);
});

// When text input changes → find nearest height
// Number box, only snap on "commit" (Enter or blur)
input.addEventListener('change', () => {
    const val = Number(input.value);

    // Snap typed value to nearest available height
    const [nearestHeight, nearestIdx] = getHeight(val);
    
    // Sync UI
    slider.value = nearestIdx;
    input.value = nearestHeight;
    updateMap(nearestHeight);
});

// To set up map with default height of 1000 m
variableSelect.addEventListener('change', () => {
    const variable = variableSelect.value;

    if (!variable) {
        updateMap(null);
        return;
    }

	// Get color table
	colortable = getColorTable(variable)

    // Update the map marker with new colorscale and min/max
    Plotly.restyle('map', {
        'marker.color': [Array(mapLats.length).fill(colortable.cmin)], // initial fill
        'marker.cmin': [colortable.cmin],
        'marker.cmax': [colortable.cmax],
        'marker.colorscale': [colortable.colorscale],
        'marker.showscale': [true]
    });

    const [defaultHeight, nearestIdx] = getHeight(1000);
    slider.value = availableHeights.indexOf(defaultHeight);
    input.value = defaultHeight;
    updateMap(defaultHeight);
});




//########################################################
//################### SOUNDING OVERLAY ###################
//########################################################







//#######################################################
//######################## MODAL ########################
//#######################################################
//Created: 6 November 2025

// Opens modal and add text from static/documents/ directory based on file name as function input
function openModal(modalID){
	/*
	modal: modal id
	textName: file name containing text to add to modal. Must be in static/documents/ directory with .txt extenstion
	*/
	
	const modal = document.getElementById(modalID)
	const content = document.getElementById(`${modalID}${"Content"}`)

	// Open modal
	modal.style.display = 'flex';
	document.body.style.overflow = 'hidden';
	modal.style.opacity = 1; // reset opacity for fade-out
}

// Function to close modal
function closeModal(modalID){
	document.getElementById(modalID).style.display='none'
	document.body.style.overflow = '';
	
	// Content to reset only in feedback modal
	if (modalID === "feedbackModal") {
		document.getElementById(`${modalID}${"Status"}`).textContent = '';
		document.getElementById(`${modalID}${"Form"}`).reset();
	}
}

// Function to close modal when clicking outside modal
// Does not remove content from feedback modal (in case user clicks outside model while typing feedback)
function enableOutsideClickToClose(modalID) {
    const modal = document.getElementById(modalID);
    if (!modal) return; // This does nothing if modal is not found on page (since this script is usedo nmultiple pages)

    modal.addEventListener("click", (e) => {
        if (e.target === modal) { // only if background is clicked
            document.getElementById(modalID).style.display='none'
			document.body.style.overflow = '';
        }
    });
}

// Enable click outside to close for instruction and feedback modals
enableOutsideClickToClose("projectModal"); // on research page
enableOutsideClickToClose("instructionsModal"); // on sounding plotter page
enableOutsideClickToClose("feedbackModal"); // on sounding plotter page


