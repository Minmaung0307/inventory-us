/* =========================
   Inventory — single-file SPA
   ========================= */

/* ---------- Hoisted helpers ---------- */
function USD(x){ return `$${Number(x || 0).toFixed(2)}`; }
function parseYMD(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
function getISOWeek(d){ const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const n=t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-n); const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil((((t - y0) / 86400000) + 1)/7); }
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
function on(id, fn){ const el=$(id); if(!el) return; el.onclick=null; el.addEventListener('click', fn, {once:false}); } // no duplicate handlers

/* ---------- Firebase (v8) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAlElNC22VZKTGu4QkF0rUl_vdbY4k5_pA",
  authDomain: "inventory-us.firebaseapp.com",
  databaseURL: "https://inventory-us-default-rtdb.firebaseio.com",
  projectId: "inventory-us",
  storageBucket: "inventory-us.appspot.com",
  messagingSenderId: "685621968644",
  appId: "1:685621968644:web:a88ec978f1ab9b4f49da51",
  measurementId: "G-L6NRD0B1B6"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
const db   = firebase.database();

/* ---------- Storage + notify ---------- */
const notify = (msg, type='ok')=>{
  const n = $('#notification'); if (!n) return;
  n.textContent = msg; n.className = `notification show ${type}`;
  setTimeout(()=>{ n.className='notification'; }, 2200);
};
const _lsGet = (k, f)=>{ try{ const v=localStorage.getItem(k); return v==null?f:JSON.parse(v);}catch{ return f; } };
const _lsSet = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
function load(k, f){ return _lsGet(k, f); }
function save(k, v){ _lsSet(k, v); try{ if (cloud.isOn() && auth.currentUser) cloud.saveKV(k, v); }catch{} }

let session      = load('session', null);
let currentRoute = load('_route', 'home');
let searchQuery  = load('_searchQ', '');

function setSession(s){ session = s; save('session', s); }

/* ---------- Rescue screen ---------- */
function showRescue(err){
  const root = document.getElementById('root'); if (!root) return;
  const msg = (err && (err.stack || err.message)) ? String(err.stack || err.message) : 'Unknown error';
  root.innerHTML = `
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
  on('#rz-signout', async ()=>{ try { await auth.signOut(); } catch {} location.reload(); });
  on('#rz-clearls', ()=>{ try { localStorage.clear(); } catch {} location.reload(); });
  on('#rz-retry',   ()=>{ try { renderApp(); } catch (e) { console.error(e); notify(e?.message||'Retry failed','danger'); } });
}

/* ---------- Theme ---------- */
const THEME_MODES = [{key:'light',name:'Light'},{key:'dark',name:'Dark'},{key:'aqua',name:'Aqua'}];
const THEME_SIZES = [{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}];
function getTheme(){ return _lsGet('_theme2', { mode:'aqua', size:'medium' }); }
function applyTheme(){
  const t = getTheme();
  const size = THEME_SIZES.find(s=>s.key===t.size)?.pct ?? 100;
  document.documentElement.setAttribute('data-theme', t.mode==='light' ? 'light' : (t.mode==='dark' ? 'dark' : ''));
  document.documentElement.style.setProperty('--font-scale', size + '%');
}
applyTheme();

/* ---------- Cloud Sync (per-user keys) ---------- */
const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
const cloud = (function(){
  let liveRefs = [];
  const on      = ()=> !!_lsGet('_cloudOn', false);
  const setOn   = v => _lsSet('_cloudOn', !!v);
  const uid     = ()=> auth.currentUser?.uid;
  const pathFor = key => db.ref(`tenants/${uid()}/kv/${key}`);
  async function saveKV(key, val){ if (!on() || !uid()) return; await pathFor(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP }); }
  async function pullAllOnce(){ if (!uid()) return; const snap = await db.ref(`tenants/${uid()}/kv`).get(); if (!snap.exists()) return; const all = snap.val() || {}; Object.values(all).forEach(row=>{ if (row && row.key && 'val' in row) _lsSet(row.key, row.val); }); }
  function subscribeAll(){ if (!uid()) return; unsubscribeAll(); CLOUD_KEYS.forEach(key=>{ const ref = pathFor(key); const handler = ref.on('value',(snap)=>{ const data=snap.val(); if(!data)return; const curr=_lsGet(key,null); if (JSON.stringify(curr)!==JSON.stringify(data.val)){ _lsSet(key,data.val); if (key==='_theme2') applyTheme(); renderApp(); } }); liveRefs.push({ref,handler}); }); }
  function unsubscribeAll(){ liveRefs.forEach(({ref})=>{ try{ref.off();}catch{} }); liveRefs=[]; }
  async function pushAll(){ if (!uid()) return; for (const k of CLOUD_KEYS){ const v=_lsGet(k,null); if (v!==null && v!==undefined) await saveKV(k,v); } }
  async function enable(){ if (!uid()) throw new Error('Sign in first.'); setOn(true); await firebase.database().goOnline(); await pullAllOnce(); await pushAll(); subscribeAll(); }
  function disable(){ setOn(false); unsubscribeAll(); }
  return { isOn:on, enable, disable, saveKV, pullAllOnce, subscribeAll, pushAll };
})();

/* ---------- Roles ---------- */
const ROLES = ['user','associate','manager','admin'];
const SUPER_ADMINS = ['admin@sushi.com','admin@inventory.com'];
function role(){ return (session?.role)||'user'; }
function canAdd(){ return ['admin','manager','associate'].includes(role()); }
function canEdit(){ return ['admin','manager'].includes(role()); }
function canDelete(){ return ['admin'].includes(role()); }

/* ---------- Seed data (first run) ---------- */
const DEMO_ADMIN_EMAIL = 'admin@inventory.com';
const DEMO_ADMIN_PASS  = 'admin123';
(function seedOnFirstRun(){
  if (load('_seeded_v4', false)) return;
  const now = Date.now();
  save('users', [
    { name:'Admin',     username:'admin',     email:'admin@sushi.com',     contact:'', role:'admin',     password:'', img:'' },
    { name:'Admin',     username:'admin',     email:DEMO_ADMIN_EMAIL,      contact:'', role:'admin',     password:DEMO_ADMIN_PASS, img:'' },
    { name:'Manager',   username:'manager',   email:'manager@sushi.com',   contact:'', role:'manager',   password:'', img:'' },
    { name:'Associate', username:'associate', email:'associate@sushi.com', contact:'', role:'associate', password:'', img:'' },
    { name:'Viewer',    username:'viewer',    email:'cashier@sushi.com',   contact:'', role:'user',      password:'', img:'' },
  ]);
  save('inventory', [
    { id:'inv1', img:'', name:'Nori Sheets', code:'NOR-100', type:'Dry', price:3.00, stock:80, threshold:30 },
    { id:'inv2', img:'', name:'Sushi Rice',  code:'RIC-200', type:'Dry', price:1.50, stock:24, threshold:20 },
    { id:'inv3', img:'', name:'Fresh Salmon',code:'SAL-300', type:'Raw', price:7.80, stock:10, threshold:12 },
  ]);
  save('products', [
    { id:'p1', img:'', name:'Salmon Nigiri', barcode:'11100001', price:5.99, type:'Nigiri', ingredients:'Rice, Salmon', instructions:'Brush with nikiri.' },
    { id:'p2', img:'', name:'California Roll', barcode:'11100002', price:7.49, type:'Roll', ingredients:'Rice, Nori, Crab, Avocado', instructions:'8 pcs.' },
  ]);
  save('posts', [{ id:'post1', title:'Welcome to Inventory', body:'Track stock, manage products, and work faster.', img:'', createdAt: now }]);
  save('tasks', [
    { id:'t1', title:'Prep Salmon', status:'todo' },
    { id:'t2', title:'Cook Rice', status:'inprogress' },
    { id:'t3', title:'Sanitize Station', status:'done' },
  ]);
  save('cogs', [
    { id:'c1', date:'2024-08-01', grossIncome:1200, produceCost:280, itemCost:180, freight:45, delivery:30, other:20 },
    { id:'c2', date:'2024-08-02', grossIncome: 900, produceCost:220, itemCost:140, freight:30, delivery:25, other:10 }
  ]);
  save('_seeded_v4', true);
})();

/* ---------- Router + idle logout ---------- */
function go(route){ currentRoute = route; save('_route', route); renderApp(); }
let idleTimer = null; const IDLE_LIMIT = 10*60*1000;
function resetIdleTimer(){
  if (!session) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async ()=>{ try{ await auth.signOut(); } finally { notify('Signed out due to inactivity','warn'); } }, IDLE_LIMIT);
}
['click','mousemove','keydown','touchstart','scroll'].forEach(evt=> window.addEventListener(evt, resetIdleTimer, {passive:true}));

/* ---------- Auth state ---------- */
const ALLOW_LOCAL_AUTOLOGIN = true;
auth.onAuthStateChanged(async (user) => {
  try { await ensureSessionAndRender(user); }
  catch (err) { console.error('[auth] ensureSessionAndRender crashed:', err); notify(err?.message || 'Render failed', 'danger'); showRescue(err); }
});
async function ensureSessionAndRender(user) {
  applyTheme();
  if (!user){
    const stored = load('session', null);
    if (stored && stored.authMode === 'local' && ALLOW_LOCAL_AUTOLOGIN) {
      setSession(stored); resetIdleTimer(); currentRoute = 'home'; renderApp(); return;
    }
    setSession(null); if (idleTimer) clearTimeout(idleTimer); renderLogin(); return;
  }
  // Firebase user present
  const email = (user.email || '').toLowerCase();
  let users = load('users', []);
  let prof = users.find(u => (u.email || '').toLowerCase() === email);
  if (!prof) {
    const roleGuess = SUPER_ADMINS.includes(email) ? 'admin' : 'user';
    prof = { name: roleGuess==='admin'?'Admin':'User', username: email.split('@')[0], email, contact:'', role: roleGuess, password:'', img:'' };
    users.push(prof); save('users', users);
  } else if (SUPER_ADMINS.includes(email) && prof.role !== 'admin') {
    prof.role = 'admin'; save('users', users);
  }
  setSession({ ...prof, authMode: 'firebase' });
  try{ if (cloud?.isOn?.()){ await firebase.database().goOnline(); await cloud.pullAllOnce(); cloud.subscribeAll(); } }catch{}
  resetIdleTimer();
  currentRoute='home'; // always show Home after login
  renderApp();
}

/* ---------- Local Auth helpers ---------- */
function localLogin(email, pass){
  const users = load('users', []); const e = (email||'').toLowerCase();
  if (e === DEMO_ADMIN_EMAIL && pass === DEMO_ADMIN_PASS) {
    let u = users.find(x => (x.email||'').toLowerCase() === e);
    if (!u) { u = { name:'Admin', username:'admin', email:DEMO_ADMIN_EMAIL, role:'admin', password:DEMO_ADMIN_PASS, img:'', contact:'' }; users.push(u); save('users', users); }
    setSession({ ...u, authMode: 'local' }); notify('Signed in (Local mode)'); renderApp(); return true;
  }
  const u2 = users.find(x => (x.email||'').toLowerCase() === e && (x.password||'') === pass);
  if (u2) { setSession({ ...u2, authMode: 'local' }); notify('Signed in (Local mode)'); renderApp(); return true; }
  return false;
}
function localSignup({name,email,pass}){
  const e = (email||'').toLowerCase(); const users = load('users', []);
  if (users.find(x => (x.email||'').toLowerCase() === e)) { if (localLogin(email, pass)) return true; notify('User already exists locally. Use Sign In.','warn'); return false; }
  const role = SUPER_ADMINS.includes(e) ? 'admin' : 'user';
  const u = { name: name || e.split('@')[0], username: e.split('@')[0], email: e, role, password: pass, img:'', contact:'' };
  users.push(u); save('users', users); setSession({ ...u, authMode: 'local' }); notify('Account created (Local mode)'); renderApp(); return true;
}
function localResetPassword(email){
  const e=(email||'').toLowerCase(), users=load('users',[]); const i=users.findIndex(x=>(x.email||'').toLowerCase()===e);
  if (i<0) return { ok:false, msg:'No local user found.' };
  const temp='reset'+Math.floor(1000+Math.random()*9000); users[i].password=temp; save('users',users); return { ok:true, temp };
}

/* ---------- Sidebar + Topbar ---------- */
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
    { route:'guide',   icon:'ri-book-open-line',          label:'User Guide' },
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

      <h6>Menu</h6>
      <nav class="nav">
        ${links.map(l => `
          <div class="item ${active===l.route?'active':''}" data-route="${l.route}">
            <i class="${l.icon}"></i> <span>${l.label}</span>
          </div>`).join('')}
      </nav>

      <h6>Links</h6>
      <div class="links">
        ${pages.map(p => `
          <div class="item" data-route="${p.route}">
            <i class="${p.icon}"></i> <span>${p.label}</span>
          </div>`).join('')}
      </div>

      <h6>Social</h6>
      <div class="socials-row">
        <a href="https://youtube.com" target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
        <a href="https://tiktok.com" target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com" target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
      </div>
    </aside>
  `;
}
function renderTopbar(){
  const socialsCompact = `
    <div class="socials-compact" style="display:flex;gap:8px;align-items:center">
      <a href="https://youtube.com" target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
      <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
      <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
    </div>`;
  return `
    <div class="topbar">
      <div class="left">
        <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${(currentRoute||'home').slice(0,1).toUpperCase()+ (currentRoute||'home').slice(1)}</strong></div>
      </div>
      <div class="right">
        ${socialsCompact}
        <button class="btn ghost" id="btnHome"><i class="ri-home-5-line"></i> Home</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>
  `;
}

/* delegated nav + modal-close + sidebar open/close */
document.addEventListener('click', (e)=>{
  const item = e.target.closest('.sidebar .item[data-route]'); if (item){ const r=item.getAttribute('data-route'); if(r){ go(r); closeSidebar(); } return; }
  const btnClose = e.target.closest('[data-close]'); if (btnClose){ const id=btnClose.getAttribute('data-close'); if(id) closeModal(id); }
});
function openSidebar(){ document.body.classList.add('suppress-previews'); $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); }
function closeSidebar(){ document.body.classList.remove('suppress-previews'); $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); }

/* ---------- App renderer ---------- */
function safeView(route) {
  switch ((route || 'home')) {
    case 'home':       return viewHome();
    case 'search':     return viewSearch();
    case 'dashboard':  return viewDashboard();
    case 'inventory':  return viewInventory();
    case 'products':   return viewProducts();
    case 'cogs':       return viewCOGS();
    case 'tasks':      return viewTasks();
    case 'settings':   return viewSettings();
    case 'policy':
    case 'license':
    case 'setup':
    case 'contact':
    case 'guide':
    case 'about':      return viewPage(route);
    default:           return viewHome();
  }
}
function wireRoute(route) {
  on('#btnLogout', doLogout);
  on('#btnHome',   ()=> go('home'));
  on('#burger',    openSidebar);
  on('#backdrop',  closeSidebar);

  hookSidebarSearch();
  ensureGlobalModals();
  enableMobileImagePreview();

  switch ((route || 'home')) {
    case 'home':      wireHome(); break;
    case 'dashboard': wireDashboard(); wirePosts(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts(); break;
    case 'cogs':      wireCOGS(); break;
    case 'tasks':     wireTasks(); break;
    case 'settings':  wireSettings(); break;
  }
}
function renderApp() {
  try {
    if (!session) { renderLogin(); return; }
    const root = $('#root'); if (!root) return;
    const route = currentRoute || 'home';
    root.innerHTML = `
      <div class="app">
        ${renderSidebar(route)}
        <div>
          ${renderTopbar()}
          <div class="main" id="main">
            ${safeView(route)}
          </div>
        </div>
      </div>`;
    wireRoute(route);
  } catch (e) { console.error('[renderApp] crash:', e); notify(e?.message || 'Render failed', 'danger'); showRescue(e); }
}

/* ---------- Login ---------- */
function renderLogin() {
  const root = $('#root');
  root.innerHTML = `
    <div class="login">
      <div class="card login-card">
        <div class="card-body">
          <div class="login-logo"><div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div></div>
          <p class="login-note">Sign in to continue</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass" class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div style="display:flex;justify-content:space-between;gap:8px">
              <a id="link-forgot"   href="#" class="btn ghost"   style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</a>
              <a id="link-register" href="#" class="btn secondary" style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Create account</a>
            </div>
            <div class="login-note" style="margin-top:6px">
              Tip: local demo admin — <strong>${DEMO_ADMIN_EMAIL}</strong> / <strong>${DEMO_ADMIN_PASS}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="mb-auth"></div>

    <div class="modal" id="m-signup">
      <div class="dialog">
        <div class="head"><strong>Create account</strong><button class="btn ghost" data-close="m-signup">Close</button></div>
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
        <div class="head"><strong>Reset password</strong><button class="btn ghost" data-close="m-reset">Close</button></div>
        <div class="body grid"><input id="fp-email" class="input" type="email" placeholder="Your email"/></div>
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset / Local reset</button></div>
      </div>
    </div>`;

  const openAuth = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('suppress-previews'); };
  const closeAuth = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('suppress-previews'); };

  async function doSignIn(){
    const email=($('#li-email')?.value||'').trim().toLowerCase(); const pass=$('#li-pass')?.value||''; const btn=$('#btnLogin');
    if (!email || !pass) return notify('Enter email & password','warn');
    if (email===DEMO_ADMIN_EMAIL.toLowerCase() && pass===DEMO_ADMIN_PASS) { localLogin(email, pass); return; }
    try{
      btn.disabled=true; const keep=btn.innerHTML; btn.innerHTML='Signing in…';
      await auth.signInWithEmailAndPassword(email, pass); notify('Welcome!');
      btn.disabled=false; btn.innerHTML=keep;
    }catch(e){ btn.disabled=false; notify(e?.message||'Login failed','danger'); }
  }
  function doSignup(){
    const name=($('#su-name')?.value||'').trim(), email=($('#su-email')?.value||'').trim().toLowerCase(), pass=$('#su-pass')?.value||'', pass2=$('#su-pass2')?.value||'';
    if (!email || !pass) return notify('Email and password are required','warn'); if (pass!==pass2) return notify('Passwords do not match','warn');
    auth.createUserWithEmailAndPassword(email, pass).then(async ()=>{
      try { await auth.currentUser.updateProfile({ displayName: name||email.split('@')[0] }); } catch {}
      notify('Account created'); closeAuth();
    }).catch(()=>{ localSignup({name,email,pass}); closeAuth(); });
  }
  function doReset(){
    const email=($('#fp-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Enter your email','warn');
    auth.sendPasswordResetEmail(email).then(()=>{ notify('Reset email sent','ok'); closeAuth(); })
      .catch(e=>{ const r=localResetPassword(email); if(r.ok) notify(`Local reset. Temp password: ${r.temp}`,'ok'); else notify('Reset failed','danger'); });
  }

  on('#btnLogin', doSignIn);
  $('#li-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doSignIn(); });
  on('#link-register', e=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  on('#link-forgot',   e=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  on('#btnSignupDo', doSignup);
  on('#btnResetDo',  doReset);
}
async function doLogout(){ try{ cloud?.disable?.(); }catch{} try{ await auth.signOut(); }catch{} if (idleTimer){ clearTimeout(idleTimer); idleTimer=null; } setSession(null); currentRoute='home'; notify('Signed out'); renderLogin(); }

/* ===================== Home (Hot music videos) ===================== */
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
  if (!window.HOT_MUSIC_LIBRARY) window.HOT_MUSIC_LIBRARY = DEFAULT_LIB;
  if (!window.buildWeeklyMusicSet) window.buildWeeklyMusicSet = (size = 10) => {
    const lib = window.HOT_MUSIC_LIBRARY || []; if (!lib.length) return [];
    const week = getISOWeek(new Date()); const start = week % lib.length; const out = [];
    for (let i=0; i<size; i++) out.push(lib[(start + i) % lib.length]);
    return out;
  };
  window.HOT_MUSIC_VIDEOS = buildWeeklyMusicSet(10);

  // blacklist helpers
  function _load(){ try { return JSON.parse(localStorage.getItem('_ytBlacklist') || '{}'); } catch { return {}; } }
  function _save(m){ try { localStorage.setItem('_ytBlacklist', JSON.stringify(m)); } catch {} }
  window.ytBlacklistAdd   = id => { const m=_load(); m[id]=Date.now(); _save(m); };
  window.ytIsBlacklisted  = id => !!_load()[id];
  window.ytBlacklistClear = () => _save({});
  if (!window.pickWeeklyVideoIndex) window.pickWeeklyVideoIndex = () => { const n=Math.max(1,(window.HOT_MUSIC_VIDEOS||[]).length); return getISOWeek(new Date()) % n; };
})();
function viewHome(){
  const weeklyIdx = pickWeeklyVideoIndex();
  return `
    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Welcome 👋</h3>
      <p style="color:var(--muted)">Pick a section or watch this week’s hot music video. Tap Shuffle to change.</p>

      <div class="grid cols-4 auto" style="margin-bottom:12px">
        <div class="card tile" data-go="inventory"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-archive-2-line"></i><div>Inventory</div></div></div>
        <div class="card tile" data-go="products"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-store-2-line"></i><div>Products</div></div></div>
        <div class="card tile" data-go="cogs"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-money-dollar-circle-line"></i><div>COGS</div></div></div>
        <div class="card tile" data-go="tasks"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-list-check-2"></i><div>Tasks</div></div></div>
      </div>

      <div class="grid">
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
            <div style="margin-top:8px;font-weight:700" id="mvTitle"></div>
            <div style="color:var(--muted);font-size:12px;margin-top:4px">On mobile, playback may require a tap.</div>
          </div>
        </div></div>
      </div>
    </div></div>`;
}
function wireHome(){
  const wrap=$('#musicVideoWrap'), title=$('#mvTitle'), openYT=$('#btnOpenYouTube'), btn=$('#btnShuffleVideo'); if(!wrap||!title||!openYT) return;
  function loadYT(){ return new Promise((resolve)=>{ if(window.YT&&YT.Player) return resolve(); const s=document.createElement('script'); s.src="https://www.youtube.com/iframe_api"; document.head.appendChild(s); window.onYouTubeIframeAPIReady=()=>resolve(); }); }
  function nextValidIndex(start){
    const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return 0;
    for(let k=0;k<list.length;k++){ const i=(start+k)%list.length; if(!ytIsBlacklisted(list[i].id)) return i; }
    ytBlacklistClear(); return start%list.length;
  }
  let player=null;
  function setVideoByIndex(idx){
    const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return;
    const i=nextValidIndex(idx); const {id, title:t}=list[i];
    wrap.setAttribute('data-vid-index', String(i)); title.textContent=t||'Hot music'; openYT.href=`https://www.youtube.com/watch?v=${id}`;
    const options={ host:'https://www.youtube-nocookie.com', videoId:id, playerVars:{rel:0,modestbranding:1,playsinline:1,origin:location.origin}, events:{ onError:()=>{ try{ytBlacklistAdd(id);}catch{} notify('Video not available. Skipping…','warn'); setVideoByIndex(i+1);} } };
    if(!player){ player=new YT.Player('ytPlayerHost', options); } else { player.loadVideoById(id); }
  }
  loadYT().then(()=>{ const startIdx=parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0; setVideoByIndex(startIdx);
    on('#btnShuffleVideo', ()=>{ const list=window.HOT_MUSIC_VIDEOS||[]; if(!list.length) return; const curr=parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0; let next=Math.floor(Math.random()*list.length); if(list.length>1&&next===curr) next=(next+1)%list.length; setVideoByIndex(next); notify('Shuffled music video','ok'); });
  }).catch(()=> notify('YouTube player couldn’t load','warn'));
}

/* ===================== Search ===================== */
function viewSearch(){
  const q=(window.searchQuery||'').trim(); const index=buildSearchIndex(); const out=q?searchAll(index,q):[];
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Search</h3><div style="color:var(--muted)">Query: <strong>${q||'(empty)'}</strong></div></div>
    ${out.length ? `<div class="grid">${out.map(r=>`
      <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:700">${r.label}</div><div style="color:var(--muted);font-size:12px">${r.section||''}</div></div>
        <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button></div></div>`).join('')}</div>` : `<p style="color:var(--muted)">No results.</p>`}
  </div></div>`;
}
function hookSidebarSearch(){
  const input=$('#globalSearch'), results=$('#searchResults'); if(!input||!results) return;
  let t; const openResults=(q)=>{ window.searchQuery=q; save('_searchQ',q); if(window.currentRoute!=='search') go('search'); else renderApp(); };
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const q=input.value.trim(); if(q){ openResults(q); results.classList.remove('active'); input.blur(); closeSidebar(); } }});
  input.addEventListener('input', ()=>{ clearTimeout(t); const q=input.value.trim().toLowerCase(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    t=setTimeout(()=>{ const idx=buildSearchIndex(); const out=searchAll(idx,q).slice(0,12); if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span style="color:var(--muted)">— ${r.section||''}</span></div>`).join('');
      results.classList.add('active'); results.querySelectorAll('.result').forEach(row=>{ row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id')||''; const label=row.textContent.trim(); openResults(label); results.classList.remove('active'); input.value=''; closeSidebar(); if(id) setTimeout(()=> scrollToRow(id), 80); };});
    }, 120);
  });
  document.addEventListener('click', (e)=>{ if(!results.contains(e.target) && e.target!==input){ results.classList.remove('active'); } });
}

/* ===================== Dashboard + Posts ===================== */
function viewDashboard(){
  const posts=load('posts',[]), inv=load('inventory',[]), prods=load('products',[]), users=load('users',[]), tasks=load('tasks',[]), cogs=load('cogs',[]);
  const lowCt=inv.filter(i=>i.stock<=i.threshold && i.stock>Math.max(1,Math.floor(i.threshold*0.6))).length;
  const critCt=inv.filter(i=>i.stock<=Math.max(1,Math.floor(i.threshold*0.6))).length;
  const sumForMonth=(y,m)=>cogs.filter(r=>{const p=parseYMD(r.date);return p && p.y===y && p.m===m;}).reduce((s,r)=>s+Number(r.grossIncome||0),0);
  const today=new Date(); const cy=today.getFullYear(), cm=today.getMonth()+1; const py=cm===1?(cy-1):cy; const pm=cm===1?12:(cm-1); const ly=cy-1, lm=cm;
  const totalThisMonth=sumForMonth(cy,cm), totalPrevMonth=sumForMonth(py,pm), totalLY=sumForMonth(ly,lm);
  const pct=(a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0? 100 : 0)); const mom=pct(totalThisMonth,totalPrevMonth), yoy=pct(totalThisMonth,totalLY);
  const fmtPct = (v)=> `${v>=0?'+':''}${v.toFixed(1)}%`; const trendColor = (v)=> v>=0 ? 'var(--ok)' : 'var(--danger)';

  return `
    <div class="grid cols-4 auto">
      <div class="card tile" data-go="inventory"><div>Total Items</div><h2>${inv.length}</h2></div>
      <div class="card tile" data-go="products"><div>Products</div><h2>${prods.length}</h2></div>
      <div class="card tile" data-go="settings"><div>Users</div><h2>${users.length}</h2></div>
      <div class="card tile" data-go="tasks"><div>Tasks</div><h2>${tasks.length}</h2></div>
    </div>

    <div class="grid cols-4 auto" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Sales (Month-to-Date)</strong>
          <button class="btn ghost" data-go="cogs"><i class="ri-line-chart-line"></i> Details</button>
        </div>
        <div style="margin-top:6px"><span style="color:var(--muted)">This month:</span> <strong>${USD(totalThisMonth)}</strong></div>
        <div><span style="color:var(--muted)">Prev month:</span> ${USD(totalPrevMonth)} <span style="color:${trendColor(mom)}">${fmtPct(mom)} MoM</span></div>
        <div><span style="color:var(--muted)">Same month last year:</span> ${USD(totalLY)} <span style="color:${trendColor(yoy)}">${fmtPct(yoy)} YoY</span></div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          ${canAdd()?`<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
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
function wireDashboard(){ on('#addPost', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-post'); $('#post-id').value=''; $('#post-title').value=''; $('#post-body').value=''; $('#post-img').value=''; attachImageUpload('#post-imgfile','#post-img'); }); }
function wirePosts(){
  const sec=$('[data-section="posts"]'); if(!sec) return;
  const saveBtn = $('#save-post'); if (saveBtn){ saveBtn.onclick=null; saveBtn.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const posts=load('posts',[]); const id=$('#post-id').value || ('post_'+Date.now());
    const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), img:($('#post-img')?.value||'').trim(), createdAt: Date.now() };
    if(!obj.title) return notify('Title required','warn');
    const i=posts.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission','warn'); posts[i]=obj; } else { posts.unshift(obj); }
    save('posts', posts); closeModal('m-post'); notify('Saved'); renderApp();
  }, {once:true}); } // once=true to be extra safe

  sec.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const p=load('posts',[]).find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body; $('#post-img').value=p.img||''; attachImageUpload('#post-imgfile','#post-img');
      // rebind save for edit (single-shot)
      const s=$('#save-post'); s.onclick=null; s.addEventListener('click', ()=>{
        const posts=load('posts',[]); const idx=posts.findIndex(x=>x.id===id); if(idx<0) return;
        posts[idx]={ ...posts[idx], title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), img:($('#post-img')?.value||'').trim(), createdAt:posts[idx].createdAt };
        save('posts', posts); closeModal('m-post'); notify('Updated'); renderApp();
      }, {once:true});
    }else{
      if(!canDelete()) return notify('No permission','warn');
      save('posts', load('posts',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
}

/* ===================== Inventory / Products / COGS / Tasks ===================== */
function downloadCSV(filename, rows, headers){
  try{
    const csvRows=[]; if(headers&&headers.length) csvRows.push(headers.join(','));
    for(const r of rows){ const vals=headers.map(h=>{ const v=r[h]; const s=(v==null)?'':String(v); const needs=/[",\n]/.test(s); const esc=s.replace(/"/g,'""'); return needs?`"${esc}"`:esc; }); csvRows.push(vals.join(',')); }
    const blob=new Blob([csvRows.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.style.display='none'; a.href=url; a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV','ok');
  }catch{ notify('Export failed','danger'); }
}
function attachImageUpload(fileInputSel, textInputSel){
  const f=$(fileInputSel), t=$(textInputSel); if(!f||!t) return;
  f.onchange=()=>{ const file=f.files&&f.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ t.value=reader.result; }; reader.readAsDataURL(file); };
}

/* Inventory */
function viewInventory(){
  const items=load('inventory',[]);
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Inventory</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="inventory">
      <table class="table">
        <thead><tr>
          <th>Image</th><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${items.map(it=>{
            const warn = it.stock<=it.threshold ? (it.stock<=Math.max(1,Math.floor(it.threshold*0.6))?'tr-danger':'tr-warn'):'';
            return `<tr id="${it.id}" class="${warn}">
              <td><div class="thumb-wrap">
                ${ it.img ? `<img class="thumb inv-preview" data-src="${it.img}" src="${it.img}" alt=""/>` : `<div class="thumb inv-preview" data-src="icons/icon-512.png" style="display:grid;place-items:center">📦</div>` }
                <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
              </div></td>
              <td>${it.name}</td>
              <td>${it.code}</td>
              <td>${it.type||'-'}</td>
              <td>${USD(it.price)}</td>
              <td>${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button><span style="padding:0 10px">${it.stock}</span><button class="btn ghost" data-inc="${it.id}">+</button>` : `<span>${it.stock}</span>`}</td>
              <td>${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button><span style="padding:0 10px">${it.threshold}</span><button class="btn ghost" data-inc-th="${it.id}">+</button>` : `<span>${it.threshold}</span>`}</td>
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
  const sec=$('[data-section="inventory"]'); if(!sec) return;
  on('#export-inventory', ()=>{ const items=load('inventory',[]); downloadCSV('inventory.csv', items, ['id','name','code','type','price','stock','threshold']); });
  on('#addInv', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value=''; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value=''; $('#inv-img').value='';
    attachImageUpload('#inv-imgfile','#inv-img'); });

  on('#save-inv', ()=>{ if(!canAdd()) return notify('No permission','warn');
    const items=load('inventory',[]);
    const id=$('#inv-id').value || ('inv_'+Date.now());
    const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price: parseFloat($('#inv-price').value || '0'), stock: parseInt($('#inv-stock').value || '0'), threshold: parseInt($('#inv-threshold').value || '0'), img: $('#inv-img').value.trim() };
    if(!obj.name) return notify('Name required','warn');
    const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    save('inventory', items); closeModal('m-inv'); notify('Saved'); renderApp();
  });

  sec.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const items=load('inventory',[]); const get=id=>items.find(x=>x.id===id);

    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
      openModal('m-inv'); $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold; $('#inv-img').value=it.img||''; attachImageUpload('#inv-imgfile','#inv-img'); return;
    }
    if(btn.hasAttribute('data-del')){
      if(!canDelete()) return notify('No permission','warn'); const id=btn.getAttribute('data-del');
      save('inventory', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp(); return;
    }
    const id = btn.getAttribute('data-inc') || btn.getAttribute('data-dec') || btn.getAttribute('data-inc-th') || btn.getAttribute('data-dec-th'); if(!id) return; if(!canAdd()) return notify('No permission','warn');
    const it=get(id); if(!it) return;
    if(btn.hasAttribute('data-inc')) it.stock++;
    if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
    if(btn.hasAttribute('data-inc-th')) it.threshold++;
    if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
    save('inventory', items); renderApp();
  });
}

/* Products */
function viewProducts(){
  const items=load('products',[]);
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Products</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="products">
      <table class="table">
        <thead><tr><th>Image</th><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>
          ${items.map(it=>`
            <tr id="${it.id}">
              <td><div class="thumb-wrap">
                ${ it.img ? `<img class="thumb prod-thumb" data-card="${it.id}" alt="" src="${it.img}"/>` : `<div class="thumb prod-thumb" data-card="${it.id}" style="display:grid;place-items:center;cursor:pointer">🛒</div>` }
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
  const sec=$('[data-section="products"]'); if(!sec) return;
  on('#export-products', ()=>{ const items=load('products',[]); downloadCSV('products.csv', items, ['id','name','barcode','price','type','ingredients','instructions']); });
  on('#addProd', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value=''; $('#prod-img').value='';
    attachImageUpload('#prod-imgfile','#prod-img'); });
  on('#save-prod', ()=>{ if(!canAdd()) return notify('No permission','warn');
    const items=load('products',[]); const id=$('#prod-id').value||('p_'+Date.now());
    const obj={ id, name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(), price:parseFloat($('#prod-price').value||'0'), type:$('#prod-type').value.trim(),
      ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim(), img:$('#prod-img').value.trim() };
    if(!obj.name) return notify('Name required','warn');
    const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    save('products', items); closeModal('m-prod'); notify('Saved'); renderApp();
  });

  sec.addEventListener('click', (e)=>{
    const prodCard=e.target.closest('.prod-thumb');
    if(prodCard){
      const id=prodCard.getAttribute('data-card'); const items=load('products',[]); const it=items.find(x=>x.id===id); if(!it) return;
      $('#pc-name').textContent=it.name; $('#pc-img').src=it.img||'icons/icon-512.png'; $('#pc-barcode').textContent=it.barcode||'';
      $('#pc-price').textContent=USD(it.price); $('#pc-type').textContent=it.type||''; $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||'';
      openModal('m-card'); return;
    }
    const btn=e.target.closest('button'); if(!btn) return; const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items=load('products',[]);
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const it=items.find(x=>x.id===id); if(!it) return;
      openModal('m-prod'); $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
      $('#prod-instructions').value=it.instructions||''; $('#prod-img').value=it.img||''; attachImageUpload('#prod-imgfile','#prod-img');
    }else{
      if(!canDelete()) return notify('No permission','warn'); save('products', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
}

/* COGS */
function viewCOGS(){
  const rows=load('cogs',[]); const totals=rows.reduce((a,r)=>({grossIncome:a.grossIncome+(+r.grossIncome||0),produceCost:a.produceCost+(+r.produceCost||0),itemCost:a.itemCost+(+r.itemCost||0),freight:a.freight+(+r.freight||0),delivery:a.delivery+(+r.delivery||0),other:a.other+(+r.other||0)}),{grossIncome:0,produceCost:0,itemCost:0,freight:0,delivery:0,other:0});
  const grossProfit=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  const totalProfit=grossProfit(totals);
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">COGS</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="cogs">
      <table class="table">
        <thead><tr>
          <th>Date</th><th>Gross Income</th><th>Produce Cost</th><th>Item Cost</th><th>Freight</th><th>Delivery</th><th>Other</th><th>Gross Profit</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr id="${r.id}">
              <td>${r.date}</td><td>${USD(r.grossIncome)}</td><td>${USD(r.produceCost)}</td><td>${USD(r.itemCost)}</td>
              <td>${USD(r.freight)}</td><td>${USD(r.delivery)}</td><td>${USD(r.other)}</td><td>${USD(grossProfit(r))}</td>
              <td>${canEdit()?`<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''} ${canDelete()?`<button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
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
  const sec=$('[data-section="cogs"]'); if(!sec) return;
  on('#export-cogs', ()=>{ const rows=load('cogs',[]); downloadCSV('cogs.csv', rows, ['id','date','grossIncome','produceCost','itemCost','freight','delivery','other']); });
  on('#addCOGS', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-delivery').value=''; $('#cogs-other').value=''; });
  on('#save-cogs', ()=>{ if(!canAdd()) return notify('No permission','warn');
    const rows=load('cogs',[]); const id=$('#cogs-id').value||('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value||new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
      itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0),
      delivery:+($('#cogs-delivery').value||0), other:+($('#cogs-other').value||0) };
    const i=rows.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); rows[i]=row; } else rows.push(row);
    save('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp();
  });
  sec.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return; const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const r=load('cogs',[]).find(x=>x.id===id); if(!r) return; openModal('m-cogs');
      $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome; $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-delivery').value=r.delivery; $('#cogs-other').value=r.other;
    }else{
      if(!canDelete()) return notify('No permission','warn'); save('cogs', load('cogs',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
}

/* Tasks (DnD + mobile tap-to-move) */
function viewTasks(){
  const items=load('tasks',[]); const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="grid lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}">
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
  const root=$('[data-section="tasks"]'); if(!root) return;
  on('#addTask', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo'; });
  on('#save-task', ()=>{ if(!canAdd()) return notify('No permission','warn');
    const items=load('tasks',[]); const id=$('#task-id').value||('t_'+Date.now()); const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value||'todo' };
    if(!obj.title) return notify('Title required','warn'); const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    save('tasks',items); closeModal('m-task'); notify('Saved'); renderApp();
  });

  root.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return; const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items=load('tasks',[]);
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn'); const t=items.find(x=>x.id===id); if(!t) return; openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      if(!canDelete()) return notify('No permission','warn'); save('tasks', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });

  setupDnD();
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if(isTouch){ $$('.task-card').forEach(card=>{ card.addEventListener('click',(e)=>{ if(e.target.closest('button')) return; if(!canAdd()) return notify('No permission','warn');
      const id=card.getAttribute('data-task'); const items=load('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return;
      const next=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo'); t.status=next; save('tasks',items); renderApp(); }); }); }
}
function setupDnD(){
  const lanes=['todo','inprogress','done'];
  document.querySelectorAll('[data-task]').forEach(card=>{
    card.ondragstart=e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); e.dataTransfer.effectAllowed='move'; };
  });
  lanes.forEach(k=>{
    const laneGrid=$('#lane-'+k); const parentCard=laneGrid?.closest('.lane-row'); if(!laneGrid) return;
    laneGrid.ondragover=e=>{ e.preventDefault(); parentCard?.classList.add('drop'); e.dataTransfer.dropEffect='move'; };
    laneGrid.ondragenter=()=> parentCard?.classList.add('drop');
    laneGrid.ondragleave=()=> parentCard?.classList.remove('drop');
    laneGrid.ondrop=e=>{ e.preventDefault(); parentCard?.classList.remove('drop'); if(!canAdd()) return notify('No permission','warn');
      const id=e.dataTransfer.getData('text/plain'); const items=load('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return; t.status=k; save('tasks',items); renderApp(); };
  });
}

/* ===================== Settings / Users / Static pages ===================== */
function viewSettings(){
  const users=load('users',[]), theme=getTheme(), cloudOn=cloud.isOn();
  return `<div class="grid">
    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Cloud Sync</h3>
      <p style="color:var(--muted)">Keep your data in Firebase Realtime Database (per user).</p>
      <div class="theme-inline">
        <div><label style="font-size:12px;color:var(--muted)">Status</label>
          <select id="cloud-toggle" class="input"><option value="off" ${!cloudOn?'selected':''}>Off</option><option value="on" ${cloudOn?'selected':''}>On</option></select></div>
        <div><label style="font-size:12px;color:var(--muted)">Actions</label><br/><button class="btn" id="cloud-sync-now"><i class="ri-cloud-line"></i> Sync Now</button></div>
      </div>
      <p class="muted" style="margin-top:8px">Cloud Sync mirrors keys: inventory, products, posts, tasks, cogs, users, _theme2.</p>
    </div></div>

    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Theme</h3>
      <div class="theme-inline">
        <div><label style="font-size:12px;color:var(--muted)">Mode</label>
          <select id="theme-mode" class="input">
            ${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
          </select></div>
        <div><label style="font-size:12px;color:var(--muted)">Font Size</label>
          <select id="theme-size" class="input">
            ${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
          </select></div>
      </div>
    </div></div>

    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Users</h3>
        ${canAdd()?`<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
      </div>
      <table class="table" data-section="users">
        <thead><tr><th>Avatar</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u=>`
            <tr id="${u.email}">
              <td><div class="thumb-wrap">${u.img?`<img class="thumb" src="${u.img}" alt=""/>`:`<div class="thumb" style="display:grid;place-items:center">👤</div>`}</div></td>
              <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
              <td>${canEdit()?`<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''} ${canDelete()?`<button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div></div>
  </div>`;
}
function allowedRoleOptions(){ const r=role(); if(r==='admin') return ROLES; if(r==='manager') return ['user','associate','manager']; if(r==='associate') return ['user','associate']; return ['user']; }
function wireSettings(){
  const mode=$('#theme-mode'), size=$('#theme-size'); const applyNow=()=>{ save('_theme2',{mode:mode.value,size:size.value}); applyTheme(); renderApp(); };
  mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

  const toggle=$('#cloud-toggle'), syncNow=$('#cloud-sync-now');
  toggle?.addEventListener('change', async e=>{
    const val=e.target.value;
    try{
      if(val==='on'){ if(!auth.currentUser){ notify('Sign in with Firebase to use Cloud Sync.','warn'); toggle.value='off'; return; }
        await firebase.database().goOnline(); await cloud.enable(); notify('Cloud Sync ON'); }
      else { cloud.disable(); await firebase.database().goOffline(); notify('Cloud Sync OFF'); }
    }catch(err){ notify(err?.message || 'Could not change sync','danger'); toggle.value=cloud.isOn()?'on':'off'; }
  });
  syncNow?.addEventListener('click', async ()=>{ try{
    if(!auth.currentUser) return notify('Sign in with Firebase to use Cloud Sync.','warn');
    if(!cloud.isOn())     return notify('Turn Cloud Sync ON first in Settings.','warn');
    if(!navigator.onLine) return notify('You appear to be offline.','warn');
    await firebase.database().goOnline(); await cloud.pushAll(); notify('Synced'); }catch(e){ notify((e&&e.message)||'Sync failed','danger'); } });

  wireUsers();
}
function wireUsers(){
  const addBtn=$('#addUser'); const table=$('[data-section="users"]');
  on('#addUser', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-user');
    $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-img').value='';
    const sel=$('#user-role'); sel.innerHTML=allowedRoleOptions().map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=allowedRoleOptions()[0];
    attachImageUpload('#user-imgfile','#user-img'); });

  on('#save-user', ()=>{ if(!canAdd()) return notify('No permission','warn');
    const users=load('users',[]); const email=($('#user-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Email required','warn');
    const allowed=allowedRoleOptions(); const chosen=($('#user-role')?.value||'user'); if(!allowed.includes(chosen)) return notify('Role not allowed','warn');
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:chosen, img:($('#user-img')?.value||'').trim(), contact:'', password:'' };
    const i=users.findIndex(x=>x.email.toLowerCase()===email); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);
    save('users',users); closeModal('m-user'); notify('Saved'); renderApp();
  });

  table?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return; const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const u=load('users',[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-img').value=u.img||'';
      const sel=$('#user-role'); sel.innerHTML=allowedRoleOptions().map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=allowedRoleOptions().includes(u.role)?u.role:'user';
      attachImageUpload('#user-imgfile','#user-img');
    }else{
      if(!canDelete()) return notify('No permission','warn'); save('users', load('users',[]).filter(x=>x.email!==email)); notify('Deleted'); renderApp();
    }
  });
}

/* ---------- Static pages via iframe ---------- */
window.pageContent = {
  about:  `<h3>About</h3><iframe src="about.html" style="width:100%;height:80vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`,
  policy: `<h3>Policy</h3><iframe src="policy.html" style="width:100%;height:80vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`,
  license:`<h3>License</h3><iframe src="license.html" style="width:100%;height:80vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`,
  setup:  `<h3>Developer Setup Guide</h3><a class="btn ghost" href="setup-guide.html" target="_blank" rel="noopener" style="margin-bottom:8px"><i class="ri-external-link-line"></i> Open full page</a><iframe src="setup-guide.html" style="width:100%;height:80vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`,
  guide:  `<h3>User Guide</h3><iframe src="guide.html" style="width:100%;height:80vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`,
  contact:`<h3>Contact</h3><iframe src="contact.html" style="width:100%;height:72vh;border:0;border-radius:12px;background:var(--panel)"></iframe>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${(window.pageContent && window.pageContent[key]) || '<p>Page</p>'}</div></div>`; }

/* ---------- Modals ---------- */
function openModal(id){ document.body.classList.add('suppress-previews'); const m=$('#'+id); const mb=$('#mb-'+(id.split('-')[1]||'')); m?.classList.add('active'); mb?.classList.add('active'); }
function closeModal(id){ document.body.classList.remove('suppress-previews'); const m=$('#'+id); const mb=$('#mb-'+(id.split('-')[1]||'')); m?.classList.remove('active'); mb?.classList.remove('active'); }
function enableMobileImagePreview(){
  const isPhone=window.matchMedia('(max-width: 740px)').matches; if(!isPhone) return;
  $$('.inv-preview, .prod-thumb').forEach(el=>{ el.style.cursor='pointer'; el.addEventListener('click', ()=>{ const src=el.getAttribute('data-src')||el.getAttribute('src')||'icons/icon-512.png'; const img=$('#preview-img'); if(img) img.src=src; openModal('m-img'); }); });
}
function postModal(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post"><div class="dialog">
    <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
    <div class="body grid">
      <input id="post-id" type="hidden"/>
      <input id="post-title" class="input" placeholder="Title"/>
      <textarea id="post-body" class="input" placeholder="Body"></textarea>
      <input id="post-img" class="input" placeholder="Image URL or upload below"/>
      <input id="post-imgfile" type="file" accept="image/*" class="input"/>
    </div>
    <div class="foot"><button class="btn" id="save-post">Save</button></div>
  </div></div>`; }
function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv"><div class="dialog">
    <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
    <div class="body grid">
      <input id="inv-id" type="hidden"/>
      <input id="inv-name" class="input" placeholder="Name"/>
      <input id="inv-code" class="input" placeholder="Code"/>
      <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
      <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price (e.g., 5.00)"/>
      <input id="inv-stock" class="input" type="number" placeholder="Stock (e.g., 12)"/>
      <input id="inv-threshold" class="input" type="number" placeholder="Threshold (e.g., 5)"/>
      <input id="inv-img" class="input" placeholder="Image URL or upload below"/>
      <input id="inv-imgfile" type="file" accept="image/*" class="input"/>
    </div>
    <div class="foot"><button class="btn" id="save-inv">Save</button></div>
  </div></div>`; }
function prodModal(){ return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod"><div class="dialog">
    <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
    <div class="body grid">
      <input id="prod-id" type="hidden"/>
      <input id="prod-name" class="input" placeholder="Name"/>
      <input id="prod-barcode" class="input" placeholder="Barcode"/>
      <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price (e.g., 9.99)"/>
      <input id="prod-type" class="input" placeholder="Type"/>
      <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
      <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
      <input id="prod-img" class="input" placeholder="Image URL or upload below"/>
      <input id="prod-imgfile" type="file" accept="image/*" class="input"/>
    </div>
    <div class="foot"><button class="btn" id="save-prod">Save</button></div>
  </div></div>`; }
function prodCardModal(){ return `
  <div class="modal-backdrop" id="mb-card"></div>
  <div class="modal" id="m-card"><div class="dialog">
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
  </div></div>`; }
function cogsModal(){ return `
  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs"><div class="dialog">
    <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs">Close</button></div>
    <div class="body grid cols-2">
      <input id="cogs-id" type="hidden"/>
      <input id="cogs-date" class="input" type="date"/>
      <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income"/>
      <input id="cogs-produceCost" class="input" type="number" step="0.01" placeholder="Produce Cost"/>
      <input id="cogs-itemCost" class="input" type="number" step="0.01" placeholder="Item Cost"/>
      <input id="cogs-freight" class="input" type="number" step="0.01" placeholder="Freight"/>
      <input id="cogs-delivery" class="input" type="number" step="0.01" placeholder="Delivery"/>
      <input id="cogs-other" class="input" type="number" step="0.01" placeholder="Other"/>
    </div>
    <div class="foot"><button class="btn" id="save-cogs">Save</button></div>
  </div></div>`; }
function taskModal(){ return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task"><div class="dialog">
    <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
    <div class="body grid">
      <input id="task-id" type="hidden"/>
      <input id="task-title" class="input" placeholder="Title"/>
      <select id="task-status"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
    </div>
    <div class="foot"><button class="btn" id="save-task">Save</button></div>
  </div></div>`; }
function userModal(){ return `
  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user"><div class="dialog">
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
  </div></div>`; }
function imgPreviewModal(){ return `
  <div class="modal-backdrop" id="mb-img"></div>
  <div class="modal img-modal" id="m-img"><div class="dialog">
    <div class="head"><strong>Preview</strong><button class="btn ghost" data-close="m-img">Close</button></div>
    <div class="body"><div class="imgbox"><img id="preview-img" src="" alt="Preview"/></div></div>
  </div></div>`; }
function ensureGlobalModals(){
  if($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals';
  wrap.innerHTML=postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal()+imgPreviewModal();
  document.body.appendChild(wrap);
  attachImageUpload('#post-imgfile','#post-img');
}

/* ===================== Search utils + PWA + Boot ===================== */
window.buildSearchIndex=function(){
  const posts=load('posts',[]), inv=load('inventory',[]), prods=load('products',[]), cogs=load('cogs',[]), users=load('users',[]);
  const pages=[{id:'about',label:'About',section:'Pages',route:'about'},{id:'policy',label:'Policy',section:'Pages',route:'policy'},{id:'license',label:'License',section:'Pages',route:'license'},{id:'setup',label:'Setup Guide',section:'Pages',route:'setup'},{id:'contact',label:'Contact',section:'Pages',route:'contact'},{id:'guide',label:'User Guide',section:'Pages',route:'guide'}];
  const ix=[]; posts.forEach(p=>ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`})); inv.forEach(i=>ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`})); prods.forEach(p=>ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`})); cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.delivery} ${r.other}`})); users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`})); pages.forEach(p=>ix.push(p)); return ix;
};
window.searchAll=function(index,q){ const term=(q||'').toLowerCase(); return index.map(item=>{ const s=((item.label||'').toLowerCase().includes(term)?2:0)+((item.text||'').toLowerCase().includes(term)?1:0); return {item,score:s}; }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item); };
window.scrollToRow=function(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); };

// Online / offline hints
window.addEventListener('online',  ()=> notify('Back online','ok'));
window.addEventListener('offline', ()=> notify('You are offline','warn'));

// PWA registration (safe GET, no HEAD)
(function(){
  if (!('serviceWorker' in navigator)) return;
  const swUrl = 'service-worker.js';
  const tryRegister = () => navigator.serviceWorker.register(swUrl).catch(err => console.warn('[sw] registration failed:', err));
  fetch(swUrl, { method: 'GET', cache: 'no-cache' })
    .then(r => { if (!r.ok) return; if ('requestIdleCallback' in window) requestIdleCallback(tryRegister); else setTimeout(tryRegister, 300); })
    .catch(() => {});
})();

// PWA install UI (omnibox + custom button hook-ready)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; notify('Install available — use your browser menu to add to Home','ok'); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; notify('App installed 🎉','ok'); });

// Boot
(function boot(){
  try { if (typeof renderApp==='function' && window.session) renderApp(); else if (typeof renderLogin==='function') renderLogin(); }
  catch(e){ notify(e.message||'Startup error','danger'); if (typeof renderLogin==='function') renderLogin(); }
})();