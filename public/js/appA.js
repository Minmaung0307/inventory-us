/* =========================
   Inventory — Single-file SPA (stable build)
   ========================= */

/* ---------- Tiny utils ---------- */
function USD(x){ return `$${Number(x || 0).toFixed(2)}`; }
function parseYMD(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
function getISOWeek(d){ const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const n=t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-n); const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil((((t - y0)/86400000)+1)/7); }
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

/* ---------- Storage + per-tenant isolation ---------- */
function safeJSON(s, f=null){ try{ const v=JSON.parse(s); return (v===null||v===undefined)?f:v; }catch{ return f; } }
function tenantKey(){
  if (window.session?.authMode === 'local' && window.session?.email) return `local:${session.email.toLowerCase()}:`;
  const uid = (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
  if (uid) return `uid:${uid}:`;
  return 'anon:'; // before login
}
function kscope(k){ return tenantKey() + k; }

/* ---- sanitize payload for cloud (avoid RTDB 10MB errors) ---- */
function sanitizeForCloud(key, val){
  try{
    const MAX_BYTES = 7.5 * 1024 * 1024; // keep well under 10MB limit
    const size = (x)=> (JSON.stringify(x)||'').length;

    if (size(val) <= MAX_BYTES) return val;

    const stripImgs = (arr)=> arr.map(it=>{
      const o={...it};
      if (typeof o.img === 'string' && o.img.startsWith('data:') && o.img.length > 200000) o.img = ''; // strip big inline images
      return o;
    });

    let payload = val;
    if (Array.isArray(payload) && (key==='products'||key==='inventory'||key==='posts'||key==='users')){
      payload = stripImgs(payload);
    } else if (key==='products' || key==='inventory') {
      payload = stripImgs([payload]);
      payload = payload[0];
    }

    if (size(payload) > MAX_BYTES){
      // last resort: skip sync (but keep local)
      notify('Cloud copy trimmed or skipped (payload too large). Local copy kept.', 'warn');
    }
    return payload;
  }catch{ return val; }
}

function load(k, f){ return safeJSON(localStorage.getItem(kscope(k)), f); }
function save(k, v){
  try{ localStorage.setItem(kscope(k), JSON.stringify(v)); }catch{}
  try{
    if (cloud.isOn() && auth && auth.currentUser) {
      const sanitized = sanitizeForCloud(k, v);
      cloud.saveKV(k, sanitized);
    }
  }catch{}
}
function notify(msg,type='ok'){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>{ n.className='notification'; },2400); }

/* ---------- Theme (robust) ---------- */
const THEME_MODES = [{key:'light',name:'Light'},{key:'dark',name:'Dark'},{key:'aqua',name:'Aqua'}];
const THEME_SIZES = [{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}];
function migrateCorruptTheme(){
  try{
    const key = kscope('_theme2');
    const raw = localStorage.getItem(key);
    if (!raw) return;
    if (raw === 'null' || raw === 'undefined' || raw === '""') localStorage.removeItem(key);
  }catch{}
}
function applyTheme(){
  migrateCorruptTheme();
  const defaults = { mode:'aqua', size:'medium' };
  let t = load('_theme2', defaults);
  if (!t || typeof t !== 'object') { t = defaults; save('_theme2', t); }
  const sizePct = (THEME_SIZES.find(s => s.key === t.size)?.pct) ?? 100;
  const mode = THEME_MODES.some(m => m.key === t.mode) ? t.mode : 'aqua';
  document.documentElement.setAttribute('data-theme', mode==='light' ? 'light' : (mode==='dark' ? 'dark' : ''));
  document.documentElement.style.setProperty('--font-scale', sizePct + '%');
  save('_theme2', { mode, size: THEME_SIZES.find(s=>s.key===t.size)?.key || 'medium' });
}
applyTheme();

/* ---------- Image downscale helper (reduce huge base64) ---------- */
function downscaleImage(dataURL, maxDim=1280, quality=0.82){
  return new Promise((resolve)=>{
    try{
      const img = new Image();
      img.onload = ()=>{
        const w=img.width, h=img.height;
        const scale = Math.min(1, maxDim/Math.max(w,h));
        const nw = Math.round(w*scale), nh = Math.round(h*scale);
        const cv = document.createElement('canvas'); cv.width=nw; cv.height=nh;
        const ctx=cv.getContext('2d'); ctx.drawImage(img,0,0,nw,nh);
        // Prefer JPEG to keep size small
        const out = cv.toDataURL('image/jpeg', quality);
        resolve(out && out.length < dataURL.length ? out : dataURL);
      };
      img.onerror = ()=> resolve(dataURL);
      img.src = dataURL;
    }catch{ resolve(dataURL); }
  });
}

// Keep images comfortably small before saving (and far below RTDB/string limits)
async function shrinkDataURLIfNeeded(dataURL, maxBytes = 1.5 * 1024 * 1024) {
  try {
    if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return dataURL || '';
    if (dataURL.length <= maxBytes) return dataURL;

    // progressively shrink (dimension + quality)
    let out = await downscaleImage(dataURL, 1280, 0.82);
    if (out.length > maxBytes) out = await downscaleImage(out, 1024, 0.80);
    if (out.length > maxBytes) out = await downscaleImage(out,  800, 0.75);

    // absolute safety valve (should never trigger after the steps above)
    if (out.length > 9.5 * 1024 * 1024) out = '';

    return out;
  } catch {
    return dataURL || '';
  }
}

/* =========================
   Firebase bootstrap (guarded)
   ========================= */
// --- Firebase safe references (do NOT re-initialize if index.html did) ---
const firebaseConfig = window.__FIREBASE_CONFIG || null;
if (!firebase || !firebase.initializeApp) {
  console.error("Firebase SDK missing. Check script tags in index.html");
}
if (firebase && firebase.apps && firebase.apps.length === 0 && firebaseConfig) {
  firebase.initializeApp(firebaseConfig);
}

// Use compat v8-style APIs
const auth = firebase.auth();
const db   = firebase.database();

/* ---------- Auth persistence: avoid IndexedDB issues ---------- */
function __checkIndexedDB(){
  return new Promise(res=>{
    try{
      const req = indexedDB.open('__inv_test__');
      req.onsuccess = ()=>{ try{ req.result.close(); indexedDB.deleteDatabase('__inv_test__'); }catch{}; res(true); };
      req.onerror   = ()=> res(false);
    }catch{ res(false); }
  });
}
(async ()=>{
  try{
    if (auth && auth.setPersistence){
      const idbOK = await __checkIndexedDB();
      const mode = idbOK ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(mode);
    }
  }catch(e){ console.warn('[auth] persistence set failed', e); }
})();

/* =========================
   Roles / session / cloud
   ========================= */
const ROLES = ['user','associate','manager','admin'];
const SUPER_ADMINS = ['admin@inventory.com','minmaung0307@gmail.com'];
function role(){ return (session?.role)||'user'; }
function canAdd(){ return ['admin','manager','associate'].includes(role()); }
function canEdit(){ return ['admin','manager'].includes(role()); }
function canDelete(){ return ['admin'].includes(role()); }

const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
const cloud = (function(){
  let liveRefs = [];
  const on    = ()=> !!safeJSON(localStorage.getItem(kscope('_cloudOn')), false);
  const setOn = v => { try{ localStorage.setItem(kscope('_cloudOn'), JSON.stringify(!!v)); }catch{} };
  const uid   = ()=> auth && auth.currentUser ? auth.currentUser.uid : null;
  const pathFor = k => db.ref(`tenants/${uid()}/kv/${k}`);

  async function saveKV(key, val){
    if (!on() || !uid() || !db) return;
    try{
      // final safety: skip if still too large for RTDB
      const bytes = (JSON.stringify(val)||'').length;
      if (bytes > 9.5*1024*1024){
        console.warn('[cloud] skip push: payload too large for RTDB', key, bytes);
        notify('Cloud sync skipped (data too large). Kept locally.', 'warn');
        return;
      }
      await pathFor(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP });
    }catch(e){
      console.warn('[cloud] saveKV failed', e);
      notify(e?.message || 'Cloud sync failed', 'warn');
    }
  }

  async function pullAllOnce(){
    if (!uid() || !db) return;
    const snap = await db.ref(`tenants/${uid()}/kv`).get();
    if (!snap.exists()) return;
    const all=snap.val()||{};
    Object.values(all).forEach(row=>{
      if(row && row.key && 'val' in row){
        let incoming = row.val;
        const curr = load(row.key, null);

        // Merge back full local images if cloud copy is trimmed
        if (Array.isArray(incoming) && Array.isArray(curr) && (row.key==='products'||row.key==='inventory')){
          const byId = Object.fromEntries(curr.map(x=>[x.id, x]));
          incoming = incoming.map(x=>{
            const local=byId[x.id];
            if (local && (!x.img || x.img==='') && local.img) return {...x, img: local.img};
            return x;
          });
        }

        localStorage.setItem(kscope(row.key), JSON.stringify(incoming));
      }
    });
  }

  function subscribeAll(){
  if(!uid()) return;
  CLOUD_KEYS.forEach(key=>{
    db.ref(pathFor(key)).on('value',
      (snap)=>{
        const v = snap.val();
        if (v === null || v === undefined) {
          // Just mirror an empty/default locally; DON'T write to RTDB here.
          if (Array.isArray(state[key])) state[key] = [];
          else if (key === '_theme2') state[key] = state._theme2 || { mode:'aqua', size:'medium' };
          else state[key] = null;
          if (key === '_theme2') applyTheme();
          renderApp();
          return;
        }
        state[key] = v;
        if (key === '_theme2') applyTheme();
        renderApp();
      },
      (err)=>{
        console.warn('[listen]', key, err?.message || err);
      }
    );
  });
}

  function unsubscribeAll(){ liveRefs.forEach(({ref})=>{ try{ref.off();}catch{} }); liveRefs=[]; }
  async function pushAll(){ if (!uid() || !db) return; for(const k of CLOUD_KEYS){ const v=load(k,null); if (v!==null && v!==undefined) await saveKV(k, sanitizeForCloud(k, v)); } }
  async function enable(){ if (!uid()) throw new Error('Sign in first.'); setOn(true); try{ await firebase.database().goOnline(); }catch{} await pullAllOnce(); await pushAll(); subscribeAll(); }
  async function disable(){ setOn(false); unsubscribeAll(); try{ await firebase.database().goOffline(); }catch{} }
  return { isOn:on, enable, disable, saveKV, pullAllOnce, subscribeAll, pushAll };
})();

/* =========================
   Globals + seed
   ========================= */
let session      = load('session', null);
let currentRoute = load('_route', 'home');
let searchQuery  = load('_searchQ', '');

const DEMO_ADMIN_EMAIL = 'admin@inventory.com';
const DEMO_ADMIN_PASS  = 'admin123';

function seedTenantOnce(){
  const FLAG = load('_seeded_v4', false);
  if (FLAG) return;
  const now = Date.now();
  const me  = (session?.email||'user@example.com').toLowerCase();
  const uname = me.split('@')[0];

  const users = load('users', []);
  if (!users.find(u => (u.email||'').toLowerCase() === me)){
    const guessed = SUPER_ADMINS.includes(me) ? 'admin' : 'user';
    users.push({ name: uname, username: uname, email: me, role: guessed, img:'', contact:'', password:'' });
  }
  save('users', users);

  save('inventory', [
    { id:'inv_'+now, img:'', name:`${uname} Rice`,  code:'RIC-001', type:'Dry', price:1.20, stock:25, threshold:8 },
    { id:'inv_'+(now+1), img:'', name:`${uname} Salmon`, code:'SAL-201', type:'Raw', price:8.50, stock:12, threshold:6 }
  ]);
  save('products', [
    { id:'p_'+now, img:'', name:`${uname} Roll`, barcode:'1001001', price:7.99, type:'Roll', ingredients:'Rice,Nori,Salmon', instructions:'8 pcs' }
  ]);
  save('posts', [
    { id:'post_'+now, title:`Welcome, ${uname}`, body:'This is your private workspace. Add inventory, products and tasks.', img:'', createdAt: now }
  ]);
  save('tasks', [ { id:'t_'+now, title:'Sample task', status:'todo' } ]);
  save('cogs',  [ { id:'c_'+now, date: new Date().toISOString().slice(0,10), grossIncome:900, produceCost:220, itemCost:130, freight:20, delivery:15, other:8 } ]);
  save('_seeded_v4', true);
}

/* =========================
   Auth listener (GUARDED)
   ========================= */
if (auth && typeof auth.onAuthStateChanged === "function") {
  auth.onAuthStateChanged(async (user) => {
    try { await ensureSessionAndRender(user); }
    catch (err) { console.error("[auth] crashed:", err); notify(err?.message || "Render failed","danger"); showRescue(err); }
  });
} else {
  // Fallback if Firebase isn’t present: render local mode
  try {
    session = load('session', null);
    if (session && session.authMode === 'local') {
      seedTenantOnce(); renderApp(); setupSessionPrompt();
    } else {
      renderLogin();
    }
  } catch (err) {
    console.error('[authless render] crashed:', err);
    showRescue(err);
  }
}

/* =========================
   Session bootstrap helpers
   ========================= */
async function ensureSessionAndRender(user){
  applyTheme();

  const stored = load('session', null);
  if (!user && stored && stored.authMode === 'local'){
    session = stored;
    currentRoute = load('_route','home');
    seedTenantOnce();
    renderApp();
    setupSessionPrompt();
    return;
  }

  if (!user){
    session = null; save('session', null);
    renderLogin(); return;
  }

  const email = (user.email || '').toLowerCase();
  let users = load('users', []);
  let prof = users.find(u => (u.email||'').toLowerCase() === email);

  if (!prof){
    const roleGuess = SUPER_ADMINS.includes(email) ? 'admin' : 'user';
    prof = { name: user.displayName || email.split('@')[0], username: email.split('@')[0], email, contact:'', role: roleGuess, password:'', img:'' };
    users.push(prof); save('users', users);
  } else if (SUPER_ADMINS.includes(email) && prof.role !== 'admin'){
    prof.role='admin'; save('users', users);
  }

  session = { ...prof, authMode:'firebase' };
  save('session', session);

  if (cloud.isOn()){
    try{ await firebase.database().goOnline(); }catch{}
    try{ await cloud.pullAllOnce(); }catch{}
    cloud.subscribeAll();
  }

  seedTenantOnce();
  currentRoute = load('_route','home');
  renderApp();
  setupSessionPrompt();
}

/* =========================
   Navigation + shell
   ========================= */
function renderSidebar(active='home'){
  const links = [
    { route:'home',      icon:'ri-home-5-line',              label:'Home' },
    { route:'dashboard', icon:'ri-dashboard-line',           label:'Dashboard' },
    { route:'inventory', icon:'ri-archive-2-line',           label:'Inventory' },
    { route:'products',  icon:'ri-store-2-line',             label:'Products' },
    { route:'cogs',      icon:'ri-money-dollar-circle-line', label:'COGS' },
    { route:'tasks',     icon:'ri-list-check-2',             label:'Tasks' },
    { route:'settings',  icon:'ri-settings-3-line',          label:'Settings' }
  ];
  const pages = [
    { route:'about',   icon:'ri-information-line',        label:'About' },
    { route:'policy',  icon:'ri-shield-check-line',       label:'Policy' },
    { route:'license', icon:'ri-copyright-line',          label:'License' },
    { route:'setup',   icon:'ri-guide-line',              label:'Setup Guide' },
    { route:'contact', icon:'ri-customer-service-2-line', label:'Contact' },
    { route:'guide',   icon:'ri-video-line',              label:'User Guide' },
  ];
  return `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="logo">📦</div>
        <div class="title">Inventory</div>
      </div>

      <div class="search-wrap">
        <input id="globalSearch" placeholder="Search everything…" autocomplete="off" />
        <div id="searchResults" class="search-results"></div>
      </div>

      <h6 class="menu-caption">Menu</h6>
      <div class="nav">
        ${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}
      </div>

      <h6 class="links-caption">Links</h6>
      <div class="links">
        ${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}
      </div>

      <h6 class="social-caption">SOCIAL</h6>
      <div class="socials-row">
        <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
        <a href="https://tiktok.com"   target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com"  target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  const socialsCompact = `
    <div class="socials-compact">
      <a href="https://youtube.com" target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
      <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
      <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
    </div>`;
  return `
    <div class="topbar">
      <div class="left">
        <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${(currentRoute||'home').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      </div>
      <div class="right">
        ${socialsCompact}
        <button class="btn ghost" id="btnHome"><i class="ri-home-5-line"></i> Home</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}

/* delegated nav */
document.addEventListener('click', (e)=>{
  const item = e.target.closest('.sidebar .item[data-route]');
  if (!item) return; go(item.getAttribute('data-route')); closeSidebar();
});
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-close]'); if (!btn) return;
  closeModal(btn.getAttribute('data-close'));
});
function hookSidebarInteractions(){
  const input = $('#globalSearch'), results = $('#searchResults');
  if (!input || !results) return;

  const openResultsPage = (q)=>{
    window.searchQuery = q; save('_searchQ', q);
    if (window.currentRoute !== 'search') go('search'); else renderApp();
  };

  let timer;
  input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); } } });
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer = setTimeout(()=>{
      const ix = buildSearchIndex();
      const out = searchAll(ix, q).slice(0,12);
      if (!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML = out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section||''}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick = ()=>{
          const r = row.getAttribute('data-route');
          const id= row.getAttribute('data-id') || '';
          const label = row.textContent.trim();
          openResultsPage(label); results.classList.remove('active'); input.value=''; closeSidebar();
          if (id) setTimeout(()=> scrollToRow(id),80);
        };
      });
    },120);
  });
  document.addEventListener('click', (e)=>{ if (!results.contains(e.target) && e.target !== input){ results.classList.remove('active'); } });
}
function openSidebar(){ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); }
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }

/* Router */
function go(route){ currentRoute=route; save('_route', route); renderApp(); }
function safeView(route){
  switch(route||'home'){
    case 'home': return viewHome();
    case 'search': return viewSearch();
    case 'dashboard': return viewDashboard();
    case 'inventory': return viewInventory();
    case 'products': return viewProducts();
    case 'cogs': return viewCOGS();
    case 'tasks': return viewTasks();
    case 'settings': return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide': return viewPage(route);
    default: return viewHome();
  }
}
function wireRoute(route){
  $('#btnLogout')?.addEventListener('click', doLogout);
  $('#btnHome')?.addEventListener('click', ()=>go('home'));
  $('#burger')?.addEventListener('click', openSidebar);
  $('#backdrop')?.addEventListener('click', closeSidebar);

  document.querySelectorAll('[data-go]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const r = el.getAttribute('data-go'); const id=el.getAttribute('data-id');
      if (r){ go(r); if (id) setTimeout(()=>{ try{ scrollToRow(id); }catch{} },80); }
    });
  });

  hookSidebarInteractions();
  ensureGlobalModals();
  wireSessionModal();
  enableMobileImagePreview();

  switch(route||'home'){
    case 'home': wireHome(); break;
    case 'dashboard': wireDashboard(); wirePosts(); break;
    case 'inventory': wireInventory(); break;
    case 'products': wireProducts(); break;
    case 'cogs': wireCOGS(); break;
    case 'tasks': wireTasks(); break;
    case 'settings': wireSettings(); break;
    case 'contact': wireContact(); break;
  }
}
function renderApp(){
  try{
    const root = document.getElementById('root'); if (!root) return;
    if (!session){ renderLogin(); return; }
    const route = currentRoute || 'home';
    root.innerHTML = `
      <div class="app">
        ${renderSidebar(route)}
        <div>
          ${renderTopbar()}
          <div class="main" id="main">${safeView(route)}</div>
        </div>
      </div>`;
    wireRoute(route);
  }catch(e){ console.error('[renderApp] crash:', e); notify(e?.message||'Render failed','danger'); showRescue(e); }
}

/* Login screen */
function renderLogin(){
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login">
      <div class="card login-card">
        <div class="card-body">
          <div class="login-logo"><div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div></div>
          <p class="login-note">Sign in to continue</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div style="display:flex;justify-content:space-between;gap:8px">
              <a id="link-forgot"   href="#" class="btn ghost"    style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</a>
              <a id="link-register" href="#" class="btn secondary"style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Create account</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Auth modals -->
    <div class="modal-backdrop" id="mb-auth"></div>

    <div class="modal" id="m-signup">
      <div class="dialog">
        <div class="head"><strong>Create account</strong><button class="btn ghost" id="cl-signup">Close</button></div>
        <div class="body grid">
          <input id="su-name"  class="input" placeholder="Full name"/>
          <input id="su-email" class="input" type="email" placeholder="Email"/>
          <input id="su-pass"  class="input" type="password" placeholder="Password"/>
          <input id="su-pass2" class="input" type="password" placeholder="Confirm password"/>
        </div>
        <div class="foot"><button class="btn" id="btnSignupDo"><i class="ri-user-add-line"></i> Sign up</button></div>
      </div>
    </div>

    <div class="modal" id="m-reset">
      <div class="dialog">
        <div class="head"><strong>Reset password</strong><button class="btn ghost" id="cl-reset">Close</button></div>
        <div class="body grid"><input id="fp-email" class="input" type="email" placeholder="Your email"/></div>
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset / Local reset</button></div>
      </div>
    </div>`;

  const openAuth = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
  const closeAuth = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

  const localLogin = (email, pass)=>{
    const e=(email||'').toLowerCase(); const users=load('users',[]);
    if (e===DEMO_ADMIN_EMAIL && pass===DEMO_ADMIN_PASS){
      let u = users.find(x => (x.email||'').toLowerCase() === e);
      if (!u){ u = { name:'Admin', username:'admin', email:e, role:'admin', password:DEMO_ADMIN_PASS, img:'', contact:'' }; users.push(u); save('users', users); }
      session = { ...u, authMode:'local' }; save('session', session);
      seedTenantOnce(); notify('Signed in (Local admin)'); renderApp(); setupSessionPrompt(); return true;
    }
    const u2 = users.find(x => (x.email||'').toLowerCase() === e && (x.password||'') === pass);
    if (u2){ session = { ...u2, authMode:'local' }; save('session', session); seedTenantOnce(); notify('Signed in (Local)'); renderApp(); setupSessionPrompt(); return true; }
    return false;
  };
  const localSignup=(name,email,pass)=>{
    const e=(email||'').toLowerCase(); const users=load('users',[]);
    if (users.find(x => (x.email||'').toLowerCase() === e)){ return localLogin(email, pass); }
    const r = SUPER_ADMINS.includes(e) ? 'admin' : 'user';
    const u = { name: name || e.split('@')[0], username:e.split('@')[0], email:e, role:r, password:pass, img:'', contact:'' };
    users.push(u); save('users', users);
    session = { ...u, authMode:'local' }; save('session', session);
    seedTenantOnce(); notify('Account created (Local)'); renderApp(); setupSessionPrompt(); return true;
  };

  const doSignIn = async ()=>{
    const email = ($('#li-email')?.value || '').trim().toLowerCase();
    const pass  = $('#li-pass')?.value || '';
    const btn   = $('#btnLogin');
    if (!email || !pass) return notify('Enter email & password','warn');

    // Local demo admin fallback
    if (email === DEMO_ADMIN_EMAIL.toLowerCase() && pass === DEMO_ADMIN_PASS){
      localLogin(email, pass); return;
    }
    try{
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      btn.disabled=true; const keep=btn.innerHTML; btn.innerHTML='Signing in…';
      await auth.signInWithEmailAndPassword(email, pass);
      notify('Welcome!');
      setTimeout(()=>{ if (!document.querySelector('.app')) ensureSessionAndRender(auth.currentUser); }, 600);
      btn.disabled=false; btn.innerHTML=keep;
    }catch(e){
      if (localLogin(email, pass)) return;
      notify(e?.message || 'Login failed','danger');
    }
  };

  const doSignup = async ()=>{
    const name  = ($('#su-name')?.value || '').trim();
    const email = ($('#su-email')?.value || '').trim().toLowerCase();
    const pass  = ($('#su-pass')?.value  || '');
    const pass2 = ($('#su-pass2')?.value || '');
    if (!email || !pass) return notify('Email and password are required','warn');
    if (pass !== pass2)  return notify('Passwords do not match','warn');
    try{
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      await auth.createUserWithEmailAndPassword(email, pass);
      try { await auth.currentUser.updateProfile({ displayName: name || email.split('@')[0] }); } catch {}
      notify('Account created — you are signed in'); closeAuth();
    }catch(e){
      // Local signup
      localSignup(name,email,pass); closeAuth();
    }
  };

  const doReset = async ()=>{
    const email = ($('#fp-email')?.value || '').trim().toLowerCase();
    if (!email) return notify('Enter your email','warn');
    try{
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      await auth.sendPasswordResetEmail(email);
      notify('Reset email sent — check your inbox','ok'); closeAuth();
    }catch(e){
      // Local “temp password”
      const users=load('users',[]); const i=users.findIndex(x=>(x.email||'').toLowerCase()===email);
      if (i<0) return notify('No local user found.','warn');
      const temp='reset'+Math.floor(1000+Math.random()*9000); users[i].password=temp; save('users',users);
      notify(`Local reset: temp password = ${temp}`,'ok'); closeAuth();
    }
  };

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSignIn(); });
  $('#link-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  $('#link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  $('#cl-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#cl-reset')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

async function doLogout(){
  try { cloud?.disable?.(); } catch {}
  try { await auth.signOut(); } catch {}
  session = null; save('session', null);
  currentRoute='home'; save('_route','home');
  if (__sessionPromptInterval){ clearInterval(__sessionPromptInterval); __sessionPromptInterval=null; }
  __cancelSessionPromptTimers?.();
  notify('Signed out'); renderLogin();
}

/* ===================== Home (Hot videos) ===================== */
(function(){
  const DEFAULT_LIB = [
    { title:'LAKEY INSPIRED – Better Days (NCM)', id:'RXLzvo6kvVQ' },
    { title:'DEAF KEV – Invincible (NCS Release)', id:'J2X5mJ3HDYE' },
    { title:'Ikson – Anywhere (NCM)', id:'OZLUa8JUR18' },
    { title:'Elektronomia – Sky High (NCS)', id:'TW9d8vYrVFQ' },
    { title:'Janji – Heroes Tonight (NCS)', id:'3nQNiWdeH2Q' },
    { title:'Jim Yosef – Firefly (NCS)', id:'x_OwcYTNbHs' },
    { title:'Syn Cole – Feel Good (NCS)', id:'q1ULJ92aldE' },
    { title:'Itro & Tobu – Cloud 9 (NCS)', id:'VtKbiyyVZks' },
    { title:'Alan Walker – Spectre (NCS)', id:'AOeY-nDp7hI' },
    { title:'Tobu – Candyland (NCS)', id:'IIrCDAV3EgI' },
  ];
  if (!window.HOT_MUSIC_LIBRARY) window.HOT_MUSIC_LIBRARY = DEFAULT_LIB.slice();
  window.buildWeeklyMusicSet = (size=10)=>{ const lib=window.HOT_MUSIC_LIBRARY||[]; if(!lib.length)return[]; const w=getISOWeek(new Date()); const start=w%lib.length; const out=[]; for(let i=0;i<size;i++) out.push(lib[(start+i)%lib.length]); return out; };
  window.HOT_MUSIC_VIDEOS = buildWeeklyMusicSet(10);
  window.pickWeeklyVideoIndex = ()=>{ const n=Math.max(1,(window.HOT_MUSIC_VIDEOS||[]).length); return getISOWeek(new Date())%n; };
  function _ytBL(){ return safeJSON(localStorage.getItem(kscope('_ytBlacklist')),'{}'); }
  function _ytSave(m){ try{ localStorage.setItem(kscope('_ytBlacklist'), JSON.stringify(m)); }catch{} }
  window.ytBlacklistAdd = id=>{ const m=_ytBL(); m[id]=Date.now(); _ytSave(m); };
  window.ytIsBlacklisted= id=>{ const m=_ytBL(); return !!m[id]; };
  window.ytBlacklistClear=()=> _ytSave({});
})();
function viewHome(){
  const weeklyIdx = pickWeeklyVideoIndex();
  return `
    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Welcome 👋</h3>
      <p style="color:var(--muted)">Pick a section or watch this week’s hot videos.</p>

      <div class="grid cols-4 auto" style="margin-bottom:12px">
        <div class="card tile" data-go="inventory"><div class="card-body"><i class="ri-archive-2-line"></i><div>Inventory</div></div></div>
        <div class="card tile" data-go="products"><div class="card-body"><i class="ri-store-2-line"></i><div>Products</div></div></div>
        <div class="card tile" data-go="cogs"><div class="card-body"><i class="ri-money-dollar-circle-line"></i><div>COGS</div></div></div>
        <div class="card tile" data-go="tasks"><div class="card-body"><i class="ri-list-check-2"></i><div>Tasks</div></div></div>
      </div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h4 style="margin:0">Hot Music Videos</h4>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="btnShuffleVideo"><i class="ri-shuffle-line"></i> Shuffle</button>
            <a class="btn secondary" id="btnOpenYouTube" href="#" target="_blank" rel="noopener"><i class="ri-youtube-fill"></i> Open on YouTube</a>
          </div>
        </div>
        <div id="musicVideoWrap" data-vid-index="${weeklyIdx}">
          <div id="ytPlayerHost" style="width:100%;aspect-ratio:16/9;border:1px solid var(--card-border);border-radius:12px;overflow:hidden"></div>
          <div id="mvTitle" style="margin-top:8px;font-weight:700"></div>
          <div style="color:var(--muted);font-size:12px;margin-top:4px">On mobile, playback may require a tap.</div>
        </div>
      </div></div>
    </div></div>`;
}
function wireHome(){
  const wrap=$('#musicVideoWrap'), title=$('#mvTitle'), openYT=$('#btnOpenYouTube'), btn=$('#btnShuffleVideo'); if(!wrap||!title||!openYT) return;
  function loadYT(){ return new Promise(res=>{ if (window.YT && YT.Player) return res(); const s=document.createElement('script'); s.src="https://www.youtube.com/iframe_api"; document.head.appendChild(s); window.onYouTubeIframeAPIReady=()=>res(); }); }
  function nextValidIndex(start){ const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return 0; for(let k=0;k<list.length;k++){ const i=(start+k)%list.length; if(!ytIsBlacklisted(list[i].id)) return i; } ytBlacklistClear(); return start%list.length; }
  let player=null;
  function setVideoByIndex(idx){
    const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return;
    const i=nextValidIndex(idx); const { id, title:t }=list[i];
    wrap.setAttribute('data-vid-index', String(i)); title.textContent=t||'Hot video'; openYT.href=`https://www.youtube.com/watch?v=${id}`;
    const options={ host:'https://www.youtube.com', videoId:id, playerVars:{rel:0,modestbranding:1,playsinline:1,origin:location.origin}, events:{ onError:()=>{ ytBlacklistAdd(id); notify('Video not available. Skipping…','warn'); setVideoByIndex(i+1);} } };
    if(!player){ player = new YT.Player('ytPlayerHost', options); } else { player.loadVideoById(id); }
  }
  loadYT().then(()=>{
    const startIdx = parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0;
    setVideoByIndex(startIdx);
    btn?.addEventListener('click', ()=>{
      const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return;
      const curr = parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0;
      let next = Math.floor(Math.random()*list.length); if(list.length>1 && next===curr) next=(next+1)%list.length;
      setVideoByIndex(next); notify('Shuffled video','ok');
    });
  }).catch(()=> notify('YouTube player couldn’t load','warn'));
}

/* ===================== Search ===================== */
function viewSearch(){
  const q=(window.searchQuery||'').trim();
  const index=buildSearchIndex();
  const out=q? searchAll(index,q):[];
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Search</h3>
        <div style="color:var(--muted)">Query: <strong>${q||'(empty)'}</strong></div>
      </div>
      ${out.length? `<div class="grid">${out.map(r=>`
        <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:700">${r.label}</div><div style="color:var(--muted);font-size:12px">${r.section||''}</div></div>
          <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
        </div></div>`).join('')}</div>` : `<p style="color:var(--muted)">No results.</p>`}
    </div></div>`;
}

/* ===================== Dashboard + Posts ===================== */
function viewDashboard(){
  const posts=load('posts', []), inv=load('inventory', []), prods=load('products', []), users=load('users', []), tasks=load('tasks', []), cogs=load('cogs', []);
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  const sumForMonth=(y,m)=> cogs.filter(r=>{ const p=parseYMD(r.date); return p && p.y===y && p.m===m; }).reduce((s,r)=> s + (+r.grossIncome||0), 0);
  const today=new Date(); const cy=today.getFullYear(), cm=today.getMonth()+1;
  const py=cm===1?(cy-1):cy, pm=cm===1?12:(cm-1), ly=cy-1, lm=cm;
  const totalThis=sumForMonth(cy,cm), totalPrev=sumForMonth(py,pm), totalLY=sumForMonth(ly,lm);
  const pct=(a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0?100:0)); const mom=pct(totalThis,totalPrev), yoy=pct(totalThis,totalLY);
  const fmt=(v)=>`${v>=0?'+':''}${v.toFixed(1)}%`; const col=(v)=> v>=0?'var(--ok)':'var(--danger)';

  return `
    <div class="grid cols-4 auto">
      <div class="card tile" data-go="inventory"><div>Total Items</div><h2>${inv.length}</h2></div>
      <div class="card tile" data-go="products"><div>Products</div><h2>${prods.length}</h2></div>
      <div class="card tile" data-go="settings"><div>Users</div><h2>${users.length}</h2></div>
      <div class="card tile" data-go="tasks"><div>Tasks</div><h2>${tasks.length}</h2></div>
    </div>

    <div class="grid cols-4 auto" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn); background:rgba(245,158,11,.08)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger); background:rgba(239,68,68,.10)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Sales (Month-to-Date)</strong>
          <button class="btn ghost" data-go="cogs"><i class="ri-line-chart-line"></i> Details</button>
        </div>
        <div style="margin-top:6px"><span style="color:var(--muted)">This month:</span> <strong>${USD(totalThis)}</strong></div>
        <div><span style="color:var(--muted)">Prev month:</span> ${USD(totalPrev)} <span style="color:${col(mom)}">${fmt(mom)} MoM</span></div>
        <div><span style="color:var(--muted)">Same month last year:</span> ${USD(totalLY)} <span style="color:${col(yoy)}">${fmt(yoy)} YoY</span></div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
          ${posts.map(p=>`
            <div class="card" id="${p.id}">
              <div class="card-body">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div></div>
                  <div>
                    ${canEdit()?`<button class="btn ghost" data-edit="${p.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()?`<button class="btn danger" data-del="${p.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </div>
                </div>
                ${p.img?`<img src="${p.img}" style="width:100%;border-radius:12px;margin-top:10px;border:1px solid var(--card-border)"/>`:''}
                <p style="margin-top:8px">${p.body}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}
function wireDashboard(){ $('#addPost')?.addEventListener('click', ()=> openModal('m-post')); }
function wirePosts(){
  const sec=document.querySelector('[data-section="posts"]'); if(!sec) return;
  const saveBtn=$('#save-post');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if (saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if (!canAdd()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; }
      const posts=load('posts',[]);
      const id=$('#post-id').value || ('post_'+Date.now());
      const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), img:($('#post-img')?.value||'').trim(), createdAt: Date.now() };
      if(!obj.title){ notify('Title required','warn'); return saveBtn.dataset.busy=''; }
      const i=posts.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; } posts[i]=obj; } else posts.unshift(obj);
      save('posts',posts); closeModal('m-post'); notify('Saved'); renderApp(); saveBtn.dataset.busy='';
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const b=e.target.closest('button'); if(!b) return;
      const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
      if (b.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const p=load('posts',[]).find(x=>x.id===id); if(!p) return;
        openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body; $('#post-img').value=p.img||'';
      }else{
        if(!canDelete()) return notify('No permission','warn');
        save('posts', load('posts',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ===================== Inventory ===================== */
function downloadCSV(filename, rows, headers){
  try{
    const csvRows=[]; if(headers?.length) csvRows.push(headers.join(','));
    for(const r of rows){
      const vals=headers.map(h=>{ const v=r[h]; const s=(v===undefined||v===null)?'':String(v); const needs=/[",\n]/.test(s); const esc=s.replace(/"/g,'""'); return needs?`"${esc}"`:esc;});
      csvRows.push(vals.join(','));
    }
    const blob=new Blob([csvRows.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.style.display='none'; a.href=url; a.download=filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV','ok');
  }catch(e){ notify('Export failed','danger'); }
}
function attachImageUpload(fileSel, textSel){
  const f=$(fileSel), t=$(textSel); if(!f||!t) return;
  f.onchange=()=>{ const file=f.files&&f.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async ()=>{
      let dataURL = String(reader.result || '');
      // always shrink if needed (applies to both Inventory and Products)
      dataURL = await shrinkDataURLIfNeeded(dataURL, 1.5 * 1024 * 1024);
      t.value = dataURL;
    };
    reader.readAsDataURL(file);
  };
}

function viewInventory(){
  const items=load('inventory',[]);
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Inventory</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
          ${canAdd()? `<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''}
        </div>
      </div>
      <div class="table-wrap" data-section="inventory">
        <table class="table">
          <thead><tr><th>Image</th><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>{
              const isLow = it.stock <= it.threshold;
              const isCrit= it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
              const trClass = isCrit ? 'tr-crit' : (isLow ? 'tr-warn' : '');
              return `<tr id="${it.id}" class="${trClass}">
                <td><div class="thumb-wrap">
                  ${ it.img? `<img class="thumb inv-preview" data-src="${it.img}" src="${it.img}" alt=""/>` : `<div class="thumb inv-preview" data-src="icons/icon-512.png" style="display:grid;place-items:center">📦</div>` }
                  <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
                </div></td>
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td><td>${USD(it.price)}</td>
                <td>${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button><span style="padding:0 10px">${it.stock}</span><button class="btn ghost" data-inc="${it.id}">+</button>`:`<span>${it.stock}</span>`}</td>
                <td>${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button><span style="padding:0 10px">${it.threshold}</span><button class="btn ghost" data-inc-th="${it.id}">+</button>`:`<span>${it.threshold}</span>`}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div></div>`;
}
function wireInventory(){
  const sec=document.querySelector('[data-section="inventory"]'); if(!sec) return;
  $('#export-inventory')?.addEventListener('click',()=> downloadCSV('inventory.csv', load('inventory',[]), ['id','name','code','type','price','stock','threshold']));
  $('#addInv')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value=''; $('#inv-img').value='';
    attachImageUpload('#inv-imgfile','#inv-img');
  });
  const saveBtn=$('#save-inv');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if(!canAdd()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; }
      const items=load('inventory',[]);
      const id=$('#inv-id').value || ('inv_'+Date.now());
      const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
        price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0'),
        img:($('#inv-img').value||'').trim() };
      if(!obj.name){ notify('Name required','warn'); return saveBtn.dataset.busy=''; }
      const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; } items[i]=obj; } else items.push(obj);
      save('inventory', items); closeModal('m-inv'); notify('Saved'); renderApp(); saveBtn.dataset.busy='';
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const items=load('inventory',[]);
      const get=id=>items.find(x=>x.id===id);

      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
        openModal('m-inv');
        $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
        $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold; $('#inv-img').value=it.img||'';
        attachImageUpload('#inv-imgfile','#inv-img'); return;
      }
      if(btn.hasAttribute('data-del')){
        if(!canDelete()) return notify('No permission','warn');
        const id=btn.getAttribute('data-del'); save('inventory', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp(); return;
      }
      const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
      if(!id) return; if(!canAdd()) return notify('No permission','warn');
      const it=get(id); if(!it) return;
      if(btn.hasAttribute('data-inc')) it.stock++;
      if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
      if(btn.hasAttribute('data-inc-th')) it.threshold++;
      if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
      save('inventory', items); renderApp();
    });
  }
}

/* ===================== Products ===================== */
function viewProducts(){
  const items=load('products',[]);
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Products</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
          ${canAdd()? `<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''}
        </div>
      </div>
      <div class="table-wrap" data-section="products">
        <table class="table">
          <thead><tr><th>Image</th><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><div class="thumb-wrap">
                  ${ it.img? `<img class="thumb prod-thumb" data-card="${it.id}" alt="" src="${it.img}"/>` : `<div class="thumb prod-thumb" data-card="${it.id}" style="display:grid;place-items:center;cursor:pointer">🛒</div>` }
                  <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
                </div></td>
                <td>${it.name}</td><td>${it.barcode||''}</td><td>${USD(it.price)}</td><td>${it.type||'-'}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>`;
}
function wireProducts(){
  const sec=document.querySelector('[data-section="products"]'); if(!sec) return;
  $('#export-products')?.addEventListener('click',()=> downloadCSV('products.csv', load('products',[]), ['id','name','barcode','price','type','ingredients','instructions']));
  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value=''; $('#prod-img').value='';
    attachImageUpload('#prod-imgfile','#prod-img');
  });

  const saveBtn=$('#save-prod');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{
      if(saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if(!canAdd()) { notify('No permission','warn'); saveBtn.dataset.busy=''; return; }

      const items=load('products',[]);
      const id=$('#prod-id').value || ('p_'+Date.now());
      let imgRaw = ($('#prod-img').value || '').trim();

      // 🔧 NEW: shrink even if user pasted a huge data URL
      if (imgRaw && imgRaw.startsWith('data:')) {
        imgRaw = await shrinkDataURLIfNeeded(imgRaw, 1.5 * 1024 * 1024);
      }

      const obj={
        id,
        name:$('#prod-name').value.trim(),
        barcode:$('#prod-barcode').value.trim(),
        price:parseFloat($('#prod-price').value||'0'),
        type:$('#prod-type').value.trim(),
        ingredients:$('#prod-ingredients').value.trim(),
        instructions:$('#prod-instructions').value.trim(),
        img: imgRaw
      };

      if(!obj.name){ notify('Name required','warn'); saveBtn.dataset.busy=''; return; }

      const i=items.findIndex(x=>x.id===id);
      if(i>=0){
        if(!canEdit()) { notify('No permission','warn'); saveBtn.dataset.busy=''; return; }
        items[i]=obj;
      } else {
        items.push(obj);
      }

      // Save locally and (if enabled) to cloud; cloud will auto-trim overly large images again
      save('products', items);

      closeModal('m-prod');
      notify('Saved');
      renderApp();
      saveBtn.dataset.busy='';
    });
  }

  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const prodCard = e.target.closest('.prod-thumb');
      if (prodCard){
        const id=prodCard.getAttribute('data-card'); const items=load('products',[]); const it=items.find(x=>x.id===id); if(!it) return;
        $('#pc-name').textContent=it.name; $('#pc-img').src=it.img||'icons/icon-512.png';
        $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price); $('#pc-type').textContent=it.type||'';
        $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||''; openModal('m-card'); return;
      }
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      const items=load('products',[]);
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const it=items.find(x=>x.id===id); if(!it) return;
        openModal('m-prod');
        $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
        $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
        $('#prod-instructions').value=it.instructions||''; $('#prod-img').value=it.img||'';
        attachImageUpload('#prod-imgfile','#prod-img');
      }else{
        if(!canDelete()) return notify('No permission','warn');
        save('products', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ===================== COGS ===================== */
function viewCOGS(){
  const rows=load('cogs',[]);
  const totals=rows.reduce((a,r)=>({grossIncome:a.grossIncome+(+r.grossIncome||0),produceCost:a.produceCost+(+r.produceCost||0),itemCost:a.itemCost+(+r.itemCost||0),freight:a.freight+(+r.freight||0),delivery:a.delivery+(+r.delivery||0),other:a.other+(+r.other||0)}),{grossIncome:0,produceCost:0,itemCost:0,freight:0,delivery:0,other:0});
  const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  const totalProfit=gp(totals);
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">COGS</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
          ${canAdd()? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
        </div>
      </div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead><tr><th>Date</th><th>Gross Income</th><th>Produce Cost</th><th>Item Cost</th><th>Freight</th><th>Delivery</th><th>Other</th><th>Gross Profit</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td><td>${USD(r.grossIncome)}</td><td>${USD(r.produceCost)}</td><td>${USD(r.itemCost)}</td>
                <td>${USD(r.freight)}</td><td>${USD(r.delivery)}</td><td>${USD(r.other)}</td><td>${USD(gp(r))}</td>
                <td>${canEdit()? `<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
              </tr>`).join('')}
            <tr class="tr-total">
              <th>Total</th><th>${USD(totals.grossIncome)}</th><th>${USD(totals.produceCost)}</th><th>${USD(totals.itemCost)}</th>
              <th>${USD(totals.freight)}</th><th>${USD(totals.delivery)}</th><th>${USD(totals.other)}</th><th>${USD(totalProfit)}</th><th></th>
            </tr>
          </tbody>
        </table>
      </div>
    </div></div>`;
}
function wireCOGS(){
  const sec=document.querySelector('[data-section="cogs"]'); if(!sec) return;
  $('#export-cogs')?.addEventListener('click',()=> downloadCSV('cogs.csv', load('cogs',[]), ['id','date','grossIncome','produceCost','itemCost','freight','delivery','other']));
  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-delivery').value=''; $('#cogs-other').value='';
  });
  const saveBtn=$('#save-cogs');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if(!canAdd()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; }
      const rows=load('cogs',[]);
      const id=$('#cogs-id').value || ('c_'+Date.now());
      const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
        grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
        itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0),
        delivery:+($('#cogs-delivery').value||0), other:+($('#cogs-other').value||0) };
      const i=rows.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; } rows[i]=row; } else rows.push(row);
      save('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp(); saveBtn.dataset.busy='';
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const r=load('cogs',[]).find(x=>x.id===id); if(!r) return;
        openModal('m-cogs');
        $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
        $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight;
        $('#cogs-delivery').value=r.delivery; $('#cogs-other').value=r.other;
      }else{
        if(!canDelete()) return notify('No permission','warn');
        save('cogs', load('cogs',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ===================== Tasks (DnD; lanes can be empty) ===================== */
function viewTasks(){
  const items=load('tasks',[]);
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="grid lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>${t.title}</div>
                <div>
                  ${canEdit()? `<button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  return `<div data-section="tasks">
    ${lane('todo','To do','#f59e0b')}
    ${lane('inprogress','In progress','#3b82f6')}
    ${lane('done','Done','#10b981')}
  </div>`;
}
function wireTasks(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;

  $('#addTask')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo';
  });

  const saveBtn=$('#save-task');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if(!canAdd()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; }
      const items=load('tasks',[]);
      const id=$('#task-id').value || ('t_'+Date.now());
      const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
      if(!obj.title){ notify('Title required','warn'); return saveBtn.dataset.busy=''; }
      const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; } items[i]=obj; } else items.push(obj);
      save('tasks', items); closeModal('m-task'); notify('Saved'); renderApp(); saveBtn.dataset.busy='';
    });
  }

  if (!root.__wired){
    root.__wired=true;
    root.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      const items=load('tasks',[]);
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const t=items.find(x=>x.id===id); if(!t) return;
        openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
      }else{
        if(!canDelete()) return notify('No permission','warn');
        save('tasks', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }

  setupDnD();
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click',(e)=>{
        if (e.target.closest('button')) return;
        if (!canAdd()) return notify('No permission','warn');
        const id=card.getAttribute('data-task'); const items=load('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return;
        const next=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        t.status=next; save('tasks',items); renderApp();
      });
    });
  }
}
function setupDnD(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;
  root.querySelectorAll('.task-card').forEach(card=>{
    card.setAttribute('draggable','true'); card.style.cursor='grab';
    card.addEventListener('dragstart',(e)=>{ const id=card.getAttribute('data-task'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', id); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  root.querySelectorAll('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=(e)=>{ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch{} row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    grid.addEventListener('dragenter', show);
    grid.addEventListener('dragover',  show);
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop',(e)=>{
      e.preventDefault(); hide(); if(!lane) return;
      if (!canAdd()) return notify('No permission','warn');
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const items=load('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return;
      t.status=lane; save('tasks',items); renderApp();
    });
  });
}

/* ===================== Settings / Users ===================== */
function viewSettings(){
  const users=load('users',[]); const theme=load('_theme2', {mode:'aqua', size:'medium'}); const cloudOn=cloud.isOn();
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Cloud Sync</h3>
        <p style="color:var(--muted)">Keep your data in Firebase Realtime Database.</p>
        <div class="grid cols-2">
          <div>
            <label style="font-size:12px;color:var(--muted)">Status</label>
            <select id="cloud-toggle" class="input"><option value="off" ${!cloudOn?'selected':''}>Off</option><option value="on" ${cloudOn?'selected':''}>On</option></select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--muted)">Actions</label><br/>
            <button class="btn" id="cloud-sync-now"><i class="ri-cloud-line"></i> Sync Now</button>
          </div>
        </div>
        <p style="color:var(--muted);font-size:12px;margin-top:8px">Cloud Sync requires Firebase login.</p>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
          <div><label style="font-size:12px;color:var(--muted)">Mode</label>
            <select id="theme-mode" class="input">
              ${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
            </select>
          </div>
          <div><label style="font-size:12px;color:var(--muted)">Font Size</label>
            <select id="theme-size" class="input">
              ${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Users</h3>
          ${canAdd()? `<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
        </div>
        <table class="table" data-section="users">
          <thead><tr><th>Avatar</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr id="${u.email}">
                <td>
                  <div class="thumb-wrap">
                    ${ u.img ? `<img class="thumb" alt="" src="${u.img}"/>` : `<div class="thumb" style="display:grid;place-items:center">👤</div>` }
                    <img class="thumb-large" src="${u.img||'icons/icon-512.png'}" alt=""/>
                  </div>
                </td>
                <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>`;
}
function allowedRoleOptions(){
  const r=role(); if(r==='admin') return ROLES;
  if(r==='manager') return ['user','associate','manager'];
  if(r==='associate') return ['user','associate'];
  return ['user'];
}
function wireSettings(){
  // Theme
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=()=>{ save('_theme2', { mode:mode.value, size:size.value }); applyTheme(); renderApp(); };
  mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

  // Cloud controls
  const toggle=$('#cloud-toggle'), syncNow=$('#cloud-sync-now');
  toggle?.addEventListener('change', async (e)=>{
    const val=e.target.value;
    try{
      if (val==='on'){
        if(!auth || !auth.currentUser){ notify('Sign in with Firebase to use Cloud Sync.','warn'); toggle.value='off'; return; }
        await firebase.database().goOnline(); await cloud.enable(); notify('Cloud Sync ON');
      }else{ await cloud.disable(); notify('Cloud Sync OFF'); }
    }catch(err){ notify(err?.message||'Could not change sync','danger'); toggle.value=cloud.isOn()?'on':'off'; }
  });
  syncNow?.addEventListener('click', async ()=>{
    try{
      if(!auth || !auth.currentUser) return notify('Sign in with Firebase','warn');
      if(!cloud.isOn()) return notify('Turn Cloud Sync ON in Settings.','warn');
      if(!navigator.onLine) return notify('You appear to be offline.','warn');
      await firebase.database().goOnline(); await cloud.pushAll(); notify('Synced');
    }catch(e){ notify((e&&e.message)||'Sync failed','danger'); }
  });

  // Users
  wireUsers();
}
function wireUsers(){
  const addBtn=$('#addUser'); const table=document.querySelector('[data-section="users"]');
  addBtn?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-user');
    $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-img').value='';
    const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts[0];
    attachImageUpload('#user-imgfile','#user-img');
  });
  const saveBtn=$('#save-user');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(saveBtn.dataset.busy) return; saveBtn.dataset.busy='1';
      if(!canAdd()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; }
      const users=load('users',[]);
      const email=($('#user-email')?.value||'').trim().toLowerCase();
      if(!email){ notify('Email required','warn'); return saveBtn.dataset.busy=''; }
      const allowed=allowedRoleOptions(); const chosen=($('#user-role')?.value||'user'); if(!allowed.includes(chosen)){ notify('Role not allowed','warn'); return saveBtn.dataset.busy=''; }
      const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:chosen, img:($('#user-img')?.value||'').trim(), contact:'', password:'' };
      const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
      if(i>=0){ if(!canEdit()) { notify('No permission','warn'); return saveBtn.dataset.busy=''; } users[i]=obj; } else users.push(obj);
      save('users', users); closeModal('m-user'); notify('Saved'); renderApp(); saveBtn.dataset.busy='';
    });
  }
  table?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const u=load('users',[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-img').value=u.img||'';
      const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value= opts.includes(u.role) ? u.role : 'user';
      attachImageUpload('#user-imgfile','#user-img');
    }else{
      if(!canDelete()) return notify('No permission','warn');
      save('users', load('users',[]).filter(x=>x.email!==email)); notify('Deleted'); renderApp();
    }
  });
}

/* ===================== Static pages / Contact link ===================== */
window.pageContent = Object.assign(window.pageContent||{},{
  about:  `<h3>About Inventory</h3><p style="color:var(--muted)">A fast, offline-friendly app for SMBs to manage stock, products, costs, tasks — anywhere.</p>`,
  policy: `<h3>Policy (MIT)</h3><div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden;background:var(--panel-2)"><iframe src="policy.html" style="width:100%;height:calc(100vh - 220px);border:none;background:transparent;color:var(--text)"></iframe></div>`,
  license:`<h3>License</h3><div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden;background:var(--panel-2)"><iframe src="license.html" style="width:100%;height:calc(100vh - 220px);border:none;background:transparent;color:var(--text)"></iframe></div>`,
  setup:  `<h3>Setup Guide</h3><div style="border:1px solid var(--card-border); border-radius:12px; overflow:hidden;background:var(--panel-2)"><iframe src="setup-guide.html" style="width:100%;height:calc(100vh - 220px);border:none;background:transparent;color:var(--text)"></iframe></div>`,
  guide:  `<h3>User Guide</h3><div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden;background:var(--panel-2)"><iframe src="guide.html" style="width:100%;height:calc(100vh - 220px);border:none;background:transparent;color:var(--text)"></iframe></div>`,
  contact:`<h3>Contact</h3><p style="color:var(--muted)">Click to email us: <a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Hello%20from%20Inventory&body=Hi%2C%0A"><i class="ri-mail-send-line"></i> Contact via Email</a> &nbsp; or open <a class="btn ghost" href="contact.html" target="_blank" rel="noopener">Contact form</a>.</p>`
});
function viewPage(key){ return `<div class="card"><div class="card-body">${(window.pageContent && window.pageContent[key]) || '<p>Page</p>'}</div></div>`; }
function wireContact(){}

/* ===================== Modals ===================== */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }
function enableMobileImagePreview(){
  const isPhone=window.matchMedia('(max-width:740px)').matches; if(!isPhone) return;
  $$('.inv-preview,.prod-thumb').forEach(el=>{
    el.style.cursor='pointer';
    el.addEventListener('click', ()=>{
      const src=el.getAttribute('data-src')||el.getAttribute('src')||'icons/icon-512.png';
      const img=$('#preview-img'); if(img) img.src=src; openModal('m-img');
    });
  });
}
function postModal(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post">
    <div class="dialog">
      <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
      <div class="body grid">
        <input id="post-id" type="hidden"/>
        <input id="post-title" class="input" placeholder="Title"/>
        <textarea id="post-body" class="input" placeholder="Body"></textarea>
        <input id="post-img" class="input" placeholder="Image URL or upload below"/>
        <input id="post-imgfile" type="file" accept="image/*" class="input"/>
      </div>
      <div class="foot"><button class="btn" id="save-post">Save</button></div>
    </div>
  </div>`; }
function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv">
    <div class="dialog">
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
      <div class="body grid">
        <input id="inv-id" type="hidden"/>
        <input id="inv-name" class="input" placeholder="Name"/>
        <input id="inv-code" class="input" placeholder="Code"/>
        <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
        <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <input id="inv-stock" class="input" type="number" placeholder="Stock"/>
        <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/>
        <input id="inv-img" class="input" placeholder="Image URL or upload below"/>
        <input id="inv-imgfile" type="file" accept="image/*" class="input"/>
      </div>
      <div class="foot"><button class="btn" id="save-inv">Save</button></div>
    </div>
  </div>`; }
function prodModal(){ return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod">
    <div class="dialog">
      <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
      <div class="body grid">
        <input id="prod-id" type="hidden"/>
        <input id="prod-name" class="input" placeholder="Name"/>
        <input id="prod-barcode" class="input" placeholder="Barcode"/>
        <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <input id="prod-type" class="input" placeholder="Type"/>
        <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
        <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
        <input id="prod-img" class="input" placeholder="Image URL or upload below"/>
        <input id="prod-imgfile" type="file" accept="image/*" class="input"/>
      </div>
      <div class="foot"><button class="btn" id="save-prod">Save</button></div>
    </div>
  </div>`; }
function prodCardModal(){ return `
  <div class="modal-backdrop" id="mb-card"></div>
  <div class="modal" id="m-card">
    <div class="dialog">
      <div class="head"><strong id="pc-name">Product</strong><button class="btn ghost" data-close="m-card">Close</button></div>
      <div class="body grid cols-2">
        <div><img id="pc-img" style="width:100%;border-radius:12px;border:1px solid var(--card-border)"/></div>
        <div class="grid">
          <div><strong>Barcode:</strong> <span id="pc-barcode"></span></div>
          <div><strong>Price:</strong> <span id="pc-price"></span></div>
          <div><strong>Type:</strong> <span id="pc-type"></span></div>
          <div><strong>Ingredients:</strong><div id="pc-ingredients"></div></div>
          <div><strong>Instructions:</strong><div id="pc-instructions"></div></div>
        </div>
      </div>
    </div>
  </div>`; }
function cogsModal(){ return `
  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs">
    <div class="dialog">
      <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs">Close</button></div>
      <div class="body grid cols-2">
        <input id="cogs-id" type="hidden"/>
        <input id="cogs-date" class="input" type="date"/>
        <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income"/>
        <input id="cogs-produceCost"  class="input" type="number" step="0.01" placeholder="Produce Cost"/>
        <input id="cogs-itemCost"     class="input" type="number" step="0.01" placeholder="Item Cost"/>
        <input id="cogs-freight"      class="input" type="number" step="0.01" placeholder="Freight"/>
        <input id="cogs-delivery"     class="input" type="number" step="0.01" placeholder="Delivery"/>
        <input id="cogs-other"        class="input" type="number" step="0.01" placeholder="Other"/>
      </div>
      <div class="foot"><button class="btn" id="save-cogs">Save</button></div>
    </div>
  </div>`; }
function taskModal(){ return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden"/>
        <input id="task-title" class="input" placeholder="Title"/>
        <select id="task-status"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
      </div>
      <div class="foot"><button class="btn" id="save-task">Save</button></div>
    </div>
  </div>`; }
function userModal(){ return `
  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user">
    <div class="dialog">
      <div class="head"><strong>User</strong><button class="btn ghost" data-close="m-user">Close</button></div>
      <div class="body grid">
        <input id="user-name" class="input" placeholder="Name"/>
        <input id="user-email" class="input" type="email" placeholder="Email"/>
        <input id="user-username" class="input" placeholder="Username"/>
        <select id="user-role"></select>
        <input id="user-img" class="input" placeholder="Image URL or upload below"/>
        <input id="user-imgfile" type="file" accept="image/*" class="input"/>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>`; }
function imgPreviewModal(){ return `
  <div class="modal-backdrop" id="mb-img"></div>
  <div class="modal img-modal" id="m-img">
    <div class="dialog">
      <div class="head"><strong>Preview</strong><button class="btn ghost" data-close="m-img">Close</button></div>
      <div class="body"><div class="imgbox"><img id="preview-img" src="" alt="Preview" style="max-width:100%"/></div></div>
    </div>
  </div>`; }
/* session prompt (idle) */
function sessionPromptModal(){ return `
  <div class="modal-backdrop" id="mb-session"></div>
  <div class="modal" id="m-session" role="dialog" aria-modal="true" aria-labelledby="session-title">
    <div class="dialog">
      <div class="head"><strong id="session-title">Stay signed in?</strong><button class="btn ghost" id="session-close" data-close="m-session">Close</button></div>
      <div class="body">
        <p style="margin:0;color:var(--muted)">You’ve been inactive for a while. Would you like to stay signed in?</p>
        <div id="session-countdown" style="margin-top:8px;font-size:12px;color:var(--warn)"></div>
      </div>
      <div class="foot">
        <button class="btn secondary" id="session-stay"><i class="ri-shield-check-line"></i> Stay signed in</button>
        <button class="btn danger" id="session-logout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
  </div>`; }
function ensureGlobalModals(){
  if ($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals';
  wrap.innerHTML = postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal()+imgPreviewModal()+sessionPromptModal();
  document.body.appendChild(wrap);
  attachImageUpload('#post-imgfile','#post-img');
}

/* ===================== Search utils + SW + Boot ===================== */
window.buildSearchIndex=function(){
  const posts=load('posts',[]), inv=load('inventory',[]), prods=load('products',[]), cogs=load('cogs',[]), users=load('users',[]);
  const pages=[
    { id:'about',label:'About',section:'Pages',route:'about' },
    { id:'policy',label:'Policy',section:'Pages',route:'policy' },
    { id:'license',label:'License',section:'Pages',route:'license' },
    { id:'setup',label:'Setup Guide',section:'Pages',route:'setup' },
    { id:'contact',label:'Contact',section:'Pages',route:'contact' },
    { id:'guide',label:'User Guide',section:'Pages',route:'guide' },
  ];
  const ix=[]; posts.forEach(p=>ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`}));
  inv.forEach(i=>ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`}));
  prods.forEach(p=>ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`}));
  cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.delivery} ${r.other}`}));
  users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p));
  return ix;
};
window.searchAll=function(index,q){
  const norm=s=>(s||'').toLowerCase();
  const tokens=norm(q).split(/\s+/).filter(Boolean);
  return index
    .map(item=>{
      const label=norm(item.label), text=norm(item.text||''); let hits=0;
      const ok = tokens.every(t=>{ const hit = label.includes(t)||text.includes(t); if(hit) hits++; return hit; });
      const score = ok ? (hits*3 + (label.includes(tokens[0]||'')?2:0)) : 0;
      return { item, score };
    })
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score)
    .map(x=>x.item);
};
window.scrollToRow=function(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); };

// Online / offline hints
window.addEventListener('online', ()=> notify('Back online','ok'));
window.addEventListener('offline',()=> notify('You are offline','warn'));

// Service Worker (safe GET registration)
(function(){
  if(!('serviceWorker' in navigator)) return;
  const sw='service-worker.js';
  const tryReg=()=> navigator.serviceWorker.register(sw).catch(err=>console.warn('[sw] registration failed:',err));
  fetch(sw,{method:'GET',cache:'no-cache'})
    .then(r=>{ if(!r.ok) return; if('requestIdleCallback' in window) requestIdleCallback(tryReg); else setTimeout(tryReg,500); })
    .catch(()=>{});
})();

/* ---------- Session prompt after inactivity (ask -> auto-logout in 60s) ---------- */
const SESSION_PROMPT_ENABLED = true;
const PROMPT_AFTER_MIN = 20;
const PROMPT_GRACE_SEC = 60;
const PROMPT_AFTER_MS  = PROMPT_AFTER_MIN * 60 * 1000;
const PROMPT_GRACE_MS  = PROMPT_GRACE_SEC * 1000;

let __lastActivity = Date.now();
let __sessionPromptInterval = null;
let __sessionPromptOpen = false;
let __sessionPromptWired = false;
let __sessionPromptDeadline = 0;
let __sessionPromptTicker = null;
let __sessionPromptHardTimeout = null;

function __updateCountdown(){
  const el=$('#session-countdown'); if(!el||!__sessionPromptDeadline) return;
  const remain=Math.max(0, Math.ceil((__sessionPromptDeadline - Date.now())/1000));
  el.textContent=`Will log out in ${remain}s if no response…`;
}
function __cancelSessionPromptTimers(){
  if(__sessionPromptTicker){ clearInterval(__sessionPromptTicker); __sessionPromptTicker=null; }
  if(__sessionPromptHardTimeout){ clearTimeout(__sessionPromptHardTimeout); __sessionPromptHardTimeout=null; }
  __sessionPromptDeadline=0;
}
function __keepSession(){
  __cancelSessionPromptTimers(); __sessionPromptOpen=false; try{ closeModal('m-session'); }catch{}; __markActivity(); notify('Continuing your session','ok');
}
function __openSessionPrompt(){
  if(__sessionPromptOpen) return; openModal('m-session'); __sessionPromptOpen=true;
  __sessionPromptDeadline = Date.now() + PROMPT_GRACE_MS; __updateCountdown();
  __sessionPromptTicker=setInterval(__updateCountdown,1000);
  __sessionPromptHardTimeout=setTimeout(()=>{ __sessionPromptOpen=false; __cancelSessionPromptTimers(); doLogout(); }, PROMPT_GRACE_MS);
}
function __markActivity(){
  __lastActivity=Date.now();
  if(__sessionPromptOpen) __keepSession();
}
function setupSessionPrompt(){
  if(!SESSION_PROMPT_ENABLED) return;
  if(!window.__activityListenersAdded){
    ['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt,__markActivity,{passive:true}));
    window.__activityListenersAdded=true;
  }
  if(__sessionPromptInterval) clearInterval(__sessionPromptInterval);
  __sessionPromptInterval=setInterval(()=>{
    if(!session) return; const idle=Date.now()-__lastActivity;
    if(idle >= PROMPT_AFTER_MS && !__sessionPromptOpen){ __openSessionPrompt(); }
  }, 30000);
}
function wireSessionModal(){
  if(__sessionPromptWired) return;
  $('#session-stay')?.addEventListener('click', __keepSession);
  $('#session-close')?.addEventListener('click', __keepSession);
  $('#session-logout')?.addEventListener('click', ()=>{ __cancelSessionPromptTimers(); __sessionPromptOpen=false; doLogout(); });
  __sessionPromptWired = true;
}

/* ---------- Rescue screen ---------- */
function showRescue(err){
  const root=$('#root'); if(!root) return;
  const msg=(err&&(err.stack||err.message))?String(err.stack||err.message):'Unknown error';
  root.innerHTML=`
    <div style="max-width:680px;margin:40px auto;padding:16px;border:1px solid #ddd;border-radius:12px;font-family:system-ui">
      <h2 style="margin:0 0 8px">Something crashed</h2>
      <p style="color:#666;margin:0 0 12px">You can recover or sign out below.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="rz-signout" style="padding:8px 12px">Sign out</button>
        <button id="rz-clearls" style="padding:8px 12px">Clear LocalStorage</button>
        <button id="rz-retry"   style="padding:8px 12px">Retry render</button>
      </div>
      <pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px">${msg}</pre>
    </div>`;
  $('#rz-signout')?.addEventListener('click', async ()=>{ try{ await auth.signOut(); }catch{} location.reload(); });
  $('#rz-clearls')?.addEventListener('click', ()=>{ try{ localStorage.clear(); }catch{} location.reload(); });
  $('#rz-retry')?.addEventListener('click', ()=>{ try{ renderApp(); }catch(e){ console.error(e); notify(e?.message||'Retry failed','danger'); } });
}

/* ---------- Boot ---------- */
(function boot(){
  try{
    if (window.session) seedTenantOnce();
    if (typeof renderApp==='function' && window.session) renderApp();
    else if (typeof renderLogin==='function') renderLogin();
  }catch(e){ notify(e.message||'Startup error','danger'); if (typeof renderLogin==='function') renderLogin(); }
})();