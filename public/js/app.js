// Part A — Core bootstrap (Firebase, helpers, theme, cloud, auth, router)
/* =========================
   Part A — Core bootstrap
   ========================= */

// --- Firebase (v8) -----------------------------------------------------------
// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAlElNC22VZKTGu4QkF0rUl_vdbY4k5_pA",
  authDomain: "inventory-us.firebaseapp.com",
  databaseURL: "https://inventory-us-default-rtdb.firebaseio.com",
  projectId: "inventory-us",
  // storageBucket: "inventory-us.firebasestorage.app",
  storageBucket: "inventory-us.appspot.com",
  messagingSenderId: "685621968644",
  appId: "1:685621968644:web:a88ec978f1ab9b4f49da51",
  measurementId: "G-L6NRD0B1B6"
};

// Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
const db   = firebase.database();

// --- Tiny DOM helpers & notifier --------------------------------------------
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const notify = (msg, type='ok')=>{
  const n = $('#notification'); if (!n) return;
  n.textContent = msg; n.className = `notification show ${type}`;
  setTimeout(()=>{ n.className='notification'; }, 2400);
};

// --- LocalStorage raw helpers -----------------------------------------------
const _lsGet = (k, f)=>{ try{ const v=localStorage.getItem(k); return v==null?f:JSON.parse(v);}catch{ return f; } };
const _lsSet = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

// --- Rescue screen -----------------------------------------------------------
function showRescue(err){
  const root = document.getElementById('root');
  if (!root) return;
  const msg = (err && (err.stack || err.message)) ? String(err.stack || err.message) : 'Unknown error';
  root.innerHTML = `
    <div style="max-width:680px;margin:40px auto;padding:16px;border:1px solid #ddd;border-radius:12px;font-family:system-ui">
      <h2 style="margin:0 0 8px">Something crashed after login</h2>
      <p style="color:#666;margin:0 0 12px">I’ll still show you controls to recover, and the exact error below.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="rz-signout" style="padding:8px 12px">Sign out</button>
        <button id="rz-clearls" style="padding:8px 12px">Clear LocalStorage</button>
        <button id="rz-retry"   style="padding:8px 12px">Retry render</button>
      </div>
      <pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px">${msg}</pre>
    </div>`;
  document.getElementById('rz-signout')?.addEventListener('click', async ()=>{
    try { await auth.signOut(); } catch {}
    location.reload();
  });
  document.getElementById('rz-clearls')?.addEventListener('click', ()=>{
    try { localStorage.clear(); } catch {}
    location.reload();
  });
  document.getElementById('rz-retry')?.addEventListener('click', ()=>{
    try { renderApp(); } catch (e) { console.error(e); notify(e?.message||'Retry failed','danger'); }
  });
}

// quick console diag: run _diags() in DevTools
window._diags = function(){
  return {
    user: auth.currentUser ? { email: auth.currentUser.email, uid: auth.currentUser.uid } : null,
    route: currentRoute,
    hasSession: !!session,
    hasAppEl: !!document.querySelector('.app'),
    role: session?.role,
    authMode: session?.authMode || 'firebase'
  };
};

// --- Theme -------------------------------------------------------------------
const THEME_MODES = [
  { key:'light', name:'Light' },
  { key:'dark',  name:'Dark'  },
  { key:'aqua',  name:'Aqua'  },
];
const THEME_SIZES = [
  { key:'small',  pct: 90, label:'Small' },
  { key:'medium', pct:100, label:'Medium' },
  { key:'large',  pct:112, label:'Large' }
];
function getTheme(){ return _lsGet('_theme2', { mode:'aqua', size:'medium' }); }
function applyTheme(){
  const t = getTheme();
  const size = THEME_SIZES.find(s=>s.key===t.size)?.pct ?? 100;
  document.documentElement.setAttribute('data-theme', t.mode==='light' ? 'light' : (t.mode==='dark' ? 'dark' : ''));
  document.documentElement.style.setProperty('--font-scale', size + '%');
}
applyTheme();

// --- Cloud Sync (Realtime Database) ------------------------------------------
const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
const cloud = (function(){
  let liveRefs = [];
  const on      = ()=> !!_lsGet('_cloudOn', false);
  const setOn   = v => _lsSet('_cloudOn', !!v);
  const uid     = ()=> auth.currentUser?.uid;
  const pathFor = key => db.ref(`tenants/${uid()}/kv/${key}`);

  async function saveKV(key, val){
    if (!on() || !uid()) return;
    await pathFor(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP });
  }
  async function pullAllOnce(){
    if (!uid()) return;
    const snap = await db.ref(`tenants/${uid()}/kv`).get();
    if (!snap.exists()) return;
    const all = snap.val() || {};
    Object.values(all).forEach(row=>{
      if (row && row.key && 'val' in row) _lsSet(row.key, row.val);
    });
  }
  function subscribeAll(){
    if (!uid()) return;
    unsubscribeAll();
    CLOUD_KEYS.forEach(key=>{
      const ref = pathFor(key);
      const handler = ref.on('value', (snap)=>{
        const data = snap.val();
        if (!data) return;
        const curr = _lsGet(key, null);
        if (JSON.stringify(curr) !== JSON.stringify(data.val)){
          _lsSet(key, data.val);
          if (key==='_theme2') applyTheme();
          renderApp();
        }
      });
      liveRefs.push({ ref, handler });
    });
  }
  function unsubscribeAll(){ liveRefs.forEach(({ref})=>{ try{ref.off();}catch{} }); liveRefs=[]; }
  async function pushAll(){
    if (!uid()) return;
    for (const k of CLOUD_KEYS){
      const v = _lsGet(k, null);
      if (v !== null && v !== undefined) await saveKV(k, v);
    }
  }
  async function enable(){
    if (!uid()) throw new Error('Sign in first.');
    setOn(true);
    await firebase.database().goOnline();
    await pullAllOnce();
    await pushAll();
    subscribeAll();
  }
  function disable(){ setOn(false); unsubscribeAll(); }

  return { isOn:on, enable, disable, saveKV, pullAllOnce, subscribeAll, pushAll };
})();

// --- Friendly save/load wrappers (use Cloud if ON) ---------------------------
function load(k, f){ return _lsGet(k, f); }
function save(k, v){
  _lsSet(k, v);
  try{ if (cloud.isOn() && auth.currentUser) cloud.saveKV(k, v); }catch{}
}

// --- Roles & permissions ------------------------------------------------------
const ROLES = ['user','associate','manager','admin'];
const SUPER_ADMINS = ['admin@sushi.com','admin@inventory.com']; // auto-upgrade to admin here

function role(){ return (session?.role)||'user'; }
function canView(){ return true; }
function canAdd(){ return ['admin','manager','associate'].includes(role()); }
function canEdit(){ return ['admin','manager'].includes(role()); }
function canDelete(){ return ['admin'].includes(role()); }

// --- Globals + seed ----------------------------------------------------------
let session      = load('session', null);
let currentRoute = load('_route', 'home');
let searchQuery  = load('_searchQ', '');

// built-in demo admin (local auth)
const DEMO_ADMIN_EMAIL = 'admin@inventory.com';
const DEMO_ADMIN_PASS  = 'admin123';

(function seedOnFirstRun(){
  if (load('_seeded_v2', false)) {
    // ensure demo admin exists in users even for existing installs
    const users = load('users', []);
    if (!users.find(u => (u.email||'').toLowerCase() === DEMO_ADMIN_EMAIL)){
      users.push({ name:'Admin', username:'admin', email:DEMO_ADMIN_EMAIL, contact:'', role:'admin', password:'', img:'' });
      save('users', users);
    }
    return;
  }
  const now = Date.now();
  save('users', [
    { name:'Admin',     username:'admin',     email:'admin@sushi.com',     contact:'', role:'admin',     password:'', img:'' },
    { name:'Admin',     username:'admin',     email:DEMO_ADMIN_EMAIL,      contact:'', role:'admin',     password:'', img:'' },
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
  save('_seeded_v2', true);
})();

// --- Router + idle logout ----------------------------------------------------
function go(route){ currentRoute = route; save('_route', route); renderApp(); }
let idleTimer = null;
const IDLE_LIMIT = 10*60*1000;
function resetIdleTimer(){
  if (!session) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async ()=>{ try{ await auth.signOut(); } finally { notify('Signed out due to inactivity','warn'); } }, IDLE_LIMIT);
}
['click','mousemove','keydown','touchstart','scroll'].forEach(evt=> window.addEventListener(evt, resetIdleTimer, {passive:true}));

// --- Auth state --------------------------------------------------------------
auth.onAuthStateChanged(async (user) => {
  console.log('[auth] onAuthStateChanged:', !!user, user?.email || '');
  try {
    await ensureSessionAndRender(user);
  } catch (err) {
    console.error('[auth] ensureSessionAndRender crashed:', err);
    notify(err?.message || 'Render failed', 'danger');
    showRescue(err);
  }
});

async function ensureSessionAndRender(user) {
  try {
    applyTheme();

    // NEW: allow "local admin session" even if not signed into Firebase
    const stored = load('session', null);
    if (!user && stored && stored.authMode === 'local') {
      session = stored;
      resetIdleTimer();
      currentRoute = load('_route', 'home');
      renderApp();
      return;
    }

    if (!user) {
      session = null;
      save('session', null);
      if (idleTimer) clearTimeout(idleTimer);
      renderLogin();
      return;
    }

    const email = (user.email || '').toLowerCase();
    let users = load('users', []);
    let prof = users.find(u => (u.email || '').toLowerCase() === email);

    if (!prof) {
      const roleGuess = SUPER_ADMINS.includes(email) ? 'admin' : 'user';
      prof = {
        name: roleGuess === 'admin' ? 'Admin' : 'User',
        username: email.split('@')[0],
        email,
        contact: '',
        role: roleGuess,
        password: '',
        img: ''
      };
      users.push(prof);
      save('users', users);
    } else if (SUPER_ADMINS.includes(email) && prof.role !== 'admin') {
      prof.role = 'admin';
      save('users', users);
    }

    session = { ...prof, authMode: 'firebase' };
    save('session', session);

    try {
      if (cloud?.isOn?.()) {
        try { await firebase.database().goOnline(); } catch {}
        try { await cloud.pullAllOnce(); } catch {}
        try { cloud.subscribeAll(); } catch {}
      }
    } catch {}

    resetIdleTimer();
    currentRoute = load('_route', 'home');

    try { renderApp(); }
    catch (err) { console.error('[renderApp] crashed:', err); notify(err?.message || 'Render error', 'danger'); showRescue(err); }

  } catch (outer) {
    console.error('[ensureSessionAndRender] outer crash:', outer);
    notify(outer?.message || 'Render failed', 'danger');
    showRescue(outer);
  }
}

// ---- SAFETY: global COGS helper (prevents "cogs is not defined") ----
(function(){
  if (!window.getCogs) window.getCogs = () => (typeof load === 'function' ? (load('cogs', []) || []) : []);
  if (typeof window.sumSalesByMonth !== 'function') {
    window.sumSalesByMonth = (year, month) => {
      const rows = getCogs();
      const parseYMD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m ? { y:+m[1], m:+m[2], d:+m[3] } : null; };
      return rows.filter(r=>{const d=parseYMD(r.date); return d && d.y===year && d.m===month;})
                 .reduce((s, r)=> s + Number(r.grossIncome||0), 0);
    };
  }
})();

// Part B — Login UI + shell + renderApp + global hooks
// ===================== Part B =====================

// ---------- Login / Logout ----------
function renderLogin() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login">
      <div class="card login-card">
        <div class="card-body">
          <div class="login-logo" style="display:grid;place-items:center;gap:10px;margin-bottom:10px">
            <div class="logo" style="
                width:84px;height:84px;border-radius:22px;
                display:grid;place-items:center;
                background: radial-gradient(ellipse at 30% 30%, var(--brand), var(--brand-2));
                color: #fff; font-size:34px; font-weight:800; box-shadow: var(--shadow);
            ">📦</div>
          </div>
          <h2 style="text-align:center;margin:6px 0 2px">Inventory</h2>
          <p class="login-note" style="text-align:center;color:var(--muted);margin-bottom:12px">Sign in to continue</p>

          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username" />
            <input id="li-pass" class="input" type="password" placeholder="Password" autocomplete="current-password" />
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>

            <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted)">
              <a id="link-forgot" href="#" style="text-decoration:none">Forgot password?</a>
              <a id="link-register" href="#" style="text-decoration:none">Create account</a>
            </div>

            <div style="font-size:12px;color:var(--muted);margin-top:8px">
              Tip: You can always log in with <strong>${DEMO_ADMIN_EMAIL}</strong> / <strong>${DEMO_ADMIN_PASS}</strong> (local admin).
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Auth modals (local to login) -->
    <div class="modal-backdrop" id="mb-auth"></div>

    <div class="modal" id="m-signup">
      <div class="dialog">
        <div class="head"><strong>Create account</strong><button class="btn ghost" id="cl-signup">Close</button></div>
        <div class="body grid">
          <input id="su-name" class="input" placeholder="Full name" />
          <input id="su-email" class="input" type="email" placeholder="Email" />
          <input id="su-pass" class="input" type="password" placeholder="Password" />
          <input id="su-pass2" class="input" type="password" placeholder="Confirm password" />
        </div>
        <div class="foot"><button class="btn" id="btnSignupDo"><i class="ri-user-add-line"></i> Sign up</button></div>
      </div>
    </div>

    <div class="modal" id="m-reset">
      <div class="dialog">
        <div class="head"><strong>Reset password</strong><button class="btn ghost" id="cl-reset">Close</button></div>
        <div class="body grid">
          <input id="fp-email" class="input" type="email" placeholder="Your email" />
        </div>
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset link</button></div>
      </div>
    </div>
  `;

  const openAuthModal = (id)=>{ $('#mb-auth')?.classList.add('active'); $(id)?.classList.add('active'); };
  const closeAuthModal = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); };

  // --- Sign in (supports demo local admin) ---
  const doSignIn = async () => {
    const email = (document.getElementById('li-email')?.value || '').trim().toLowerCase();
    const pass  = document.getElementById('li-pass')?.value || '';

    if (!email || !pass) { notify('Enter email & password', 'warn'); return; }

    // Local demo admin (works even without Firebase)
    if (email === DEMO_ADMIN_EMAIL && pass === DEMO_ADMIN_PASS) {
      const users = load('users', []);
      let prof = users.find(u => (u.email||'').toLowerCase() === DEMO_ADMIN_EMAIL);
      if (!prof) {
        prof = { name:'Admin', username:'admin', email: DEMO_ADMIN_EMAIL, contact:'', role:'admin', password:'', img:'' };
        users.push(prof); save('users', users);
      }
      session = { ...prof, authMode: 'local' };
      save('session', session);
      notify('Welcome, Admin (local mode)');
      renderApp();
      return;
    }

    // Normal Firebase email/password
    try {
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      await auth.signInWithEmailAndPassword(email, pass);
      notify('Welcome!');
      // Fallback render if needed
      const started = Date.now();
      const poll = setInterval(() => {
        const rendered = !!document.querySelector('.app');
        const timedOut = Date.now() - started > 2000;
        if (rendered || timedOut) {
          clearInterval(poll);
          if (!rendered) {
            try { ensureSessionAndRender(auth.currentUser); } catch (err) { console.error(err); notify(err?.message||'Render failed','danger'); }
          }
        }
      }, 100);
    } catch (e) {
      const code = e?.code || '';
      if (code === 'auth/user-not-found') {
        notify('No account found. Use Create account to register.', 'warn');
        openAuthModal('#m-signup');
        $('#su-email').value = email;
      } else if (code === 'auth/wrong-password') {
        notify('Incorrect password. Try Forgot password.', 'danger');
      } else if (code === 'auth/network-request-failed') {
        notify('Network error: check your connection.', 'danger');
      } else {
        notify(e?.message || 'Login failed', 'danger');
      }
    }
  };

  // --- Signup (Firebase) ---
  const doSignup = async ()=>{
    const name  = ($('#su-name')?.value || '').trim();
    const email = ($('#su-email')?.value || '').trim().toLowerCase();
    const pass  = ($('#su-pass')?.value || '');
    const pass2 = ($('#su-pass2')?.value || '');
    if (!email || !pass) return notify('Email and password are required','warn');
    if (pass !== pass2)  return notify('Passwords do not match','warn');

    try{
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      await auth.createUserWithEmailAndPassword(email, pass);
      // profile added in ensureSessionAndRender; also auto-promote super-admins
      try { await auth.currentUser.updateProfile({ displayName: name || email.split('@')[0] }); } catch {}
      notify('Account created — you are signed in');
      closeAuthModal();
    }catch(e){
      notify(e?.message || 'Could not create account','danger');
    }
  };

  // --- Forgot password (Firebase) ---
  const doReset = async ()=>{
    const email = ($('#fp-email')?.value || '').trim().toLowerCase();
    if (!email) return notify('Enter your email','warn');
    try{
      if (!navigator.onLine) throw new Error('You appear to be offline.');
      await auth.sendPasswordResetEmail(email);
      notify('Reset email sent — check your inbox','ok');
      closeAuthModal();
    }catch(e){
      notify(e?.message || 'Could not send reset email','danger');
    }
  };

  document.getElementById('btnLogin')?.addEventListener('click', doSignIn);
  document.getElementById('li-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
  document.getElementById('link-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuthModal('#m-reset'); $('#fp-email').value = ($('#li-email')?.value||''); });
  document.getElementById('link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuthModal('#m-signup'); $('#su-email').value = ($('#li-email')?.value||''); });

  document.getElementById('cl-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuthModal(); });
  document.getElementById('cl-reset')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuthModal(); });

  document.getElementById('btnSignupDo')?.addEventListener('click', doSignup);
  document.getElementById('btnResetDo')?.addEventListener('click', doReset);
}

async function doLogout(){
  try { cloud?.disable?.(); } catch {}
  await auth.signOut();
  // also clear local session (covers local admin mode)
  save('session', null);
  notify('Signed out');
}

// ---------- Sidebar + Topbar (includes mobile socials) ----------
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

// ---------- Global delegated listeners ----------
document.addEventListener('click', (e)=>{
  const item = e.target.closest('.sidebar .item[data-route]');
  if (!item) return;
  const r = item.getAttribute('data-route');
  if (r) go(r);
}, { passive: true });

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (!btn) return;
  const id = btn.getAttribute('data-close');
  if (id && typeof closeModal === 'function') { closeModal(id); }
}, { passive: true });

// ---------- Sidebar search ----------
function hookSidebarInteractions(){
  const input   = document.getElementById('globalSearch');
  const results = document.getElementById('searchResults');
  if (!input || !results) return;

  let searchTimer;
  const openResultsPage = (q)=>{
    window.searchQuery = q; save && save('_searchQ', q);
    if (window.currentRoute !== 'search') go('search'); else renderApp();
  };

  input.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) { openResultsPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); }
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.remove('active'); results.innerHTML=''; return; }
    searchTimer = setTimeout(() => {
      let out = [];
      if (typeof buildSearchIndex === 'function' && typeof searchAll === 'function') {
        const indexData = buildSearchIndex();
        out = searchAll(indexData, q).slice(0, 12);
      } else {
        out = [{ route:'search', id:'', label:`Search "${q}"`, section:'All' }];
      }
      if (!out.length) { results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML = out.map(r => `
        <div class="result" data-route="${r.route}" data-id="${r.id||''}">
          <strong>${r.label}</strong> <span style="color:var(--muted)">— ${r.section||''}</span>
        </div>`).join('');
      results.classList.add('active');

      results.querySelectorAll('.result').forEach(row => {
        row.onclick = () => {
          const r = row.getAttribute('data-route');
          const id = row.getAttribute('data-id') || '';
          const label = row.textContent.trim();
          openResultsPage(label);
          results.classList.remove('active');
          input.value = '';
          closeSidebar();
          if (id && typeof scrollToRow === 'function') setTimeout(()=> scrollToRow(id), 80);
        };
      });
    }, 120);
  });

  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) {
      results.classList.remove('active');
    }
  });
}

// ---------- App shell / renderer ----------
function renderApp(){
  if (!window.session) { renderLogin(); return; }

  const root = document.getElementById('root');
  const safeView = (route) => {
    const m = {
      home:       typeof viewHome === 'function'      ? viewHome
                 : ()=> `<div class="card"><div class="card-body"><h3>Home</h3><p>Content coming soon.</p></div></div>`,
      dashboard:  typeof viewDashboard === 'function' ? viewDashboard
                 : ()=> `<div class="card"><div class="card-body"><h3>Dashboard</h3><p>Content coming soon.</p></div></div>`,
      inventory:  typeof viewInventory === 'function' ? viewInventory
                 : ()=> `<div class="card"><div class="card-body"><h3>Inventory</h3><p>Content coming soon.</p></div></div>`,
      products:   typeof viewProducts === 'function'  ? viewProducts
                 : ()=> `<div class="card"><div class="card-body"><h3>Products</h3><p>Content coming soon.</p></div></div>`,
      cogs:       typeof viewCOGS === 'function'      ? viewCOGS
                 : ()=> `<div class="card"><div class="card-body"><h3>COGS</h3><p>Content coming soon.</p></div></div>`,
      tasks:      typeof viewTasks === 'function'     ? viewTasks
                 : ()=> `<div class="card"><div class="card-body"><h3>Tasks</h3><p>Content coming soon.</p></div></div>`,
      settings:   typeof viewSettings === 'function'  ? viewSettings
                 : ()=> `<div class="card"><div class="card-body"><h3>Settings</h3><p>Content coming soon.</p></div></div>`,
      search:     typeof viewSearch === 'function'    ? viewSearch
                 : ()=> `<div class="card"><div class="card-body"><h3>Search</h3><p>Type in the sidebar.</p></div></div>`,
      policy:     ()=> typeof viewPage === 'function' ? viewPage('policy')  : `<div class="card"><div class="card-body"><h3>Policy</h3></div></div>`,
      license:    ()=> typeof viewPage === 'function' ? viewPage('license') : `<div class="card"><div class="card-body"><h3>License</h3></div></div>`,
      setup:      ()=> typeof viewPage === 'function' ? viewPage('setup')   : `<div class="card"><div class="card-body"><h3>Setup Guide</h3></div></div>`,
      contact:    ()=> typeof viewPage === 'function' ? viewPage('contact') : `<div class="card"><div class="card-body"><h3>Contact</h3></div></div>`,
      guide:      ()=> typeof viewPage === 'function' ? viewPage('guide')   : `<div class="card"><div class="card-body"><h3>User Guide</h3></div></div>`,
    };
    const fn = m[route] || m.home;
    return typeof fn === 'function' ? fn() : fn;
  };

  root.innerHTML = `
    <div class="app">
      ${renderSidebar(currentRoute)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">
          ${safeView(currentRoute)}
        </div>
      </div>
    </div>
  `;

  // Wire chrome
  hookSidebarInteractions();
  document.getElementById('burger')?.addEventListener('click', openSidebar, { passive:true });
  document.getElementById('backdrop')?.addEventListener('click', closeSidebar, { passive:true });
  document.getElementById('btnHome')?.addEventListener('click', ()=> go('home'));
  document.getElementById('btnLogout')?.addEventListener('click', doLogout);

  // Clickable tiles
  document.querySelectorAll('.card.tile[data-go]').forEach(t => {
    t.style.cursor = 'pointer';
    t.onclick = () => { const r = t.getAttribute('data-go'); if (r) go(r); };
  });

  // Any button/link inside main that navigates
  document.querySelectorAll('#main [data-go]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = btn.getAttribute('data-go'); const id = btn.getAttribute('data-id');
      if (r) go(r);
      if (id && typeof scrollToRow === 'function') setTimeout(()=> scrollToRow(id), 80);
    });
  });

  // Phone images
  if (typeof enableMobileImagePreview === 'function') enableMobileImagePreview();
}

function openSidebar(){ document.getElementById('sidebar')?.classList.add('open'); document.getElementById('backdrop')?.classList.add('active'); }
function closeSidebar(){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('backdrop')?.classList.remove('active'); }

// Part C — Home (weekly videos + shuffle), Search, Dashboard, Posts
// ===================== Part C =====================

// ---------- Small utilities ----------
(function(){
  if (!window.USD) window.USD = (x)=> `$${Number(x||0).toFixed(2)}`;

  if (!window.parseYMD) {
    window.parseYMD = (s)=>{
      if (!s || typeof s !== 'string') return null;
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      return { y: +m[1], m: +m[2], d: +m[3] };
    };
  }

  if (!window.getISOWeek) {
    window.getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    };
  }

  if (!window.HOT_VIDEOS) {
    window.HOT_VIDEOS = [
      { title: 'Countryside (CC0)', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', poster: 'https://i.imgur.com/7v2C8bX.jpeg' },
      { title: 'Big Buck Bunny (CC)', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', poster: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217' },
      { title: 'Sintel Trailer (CC)', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', poster: 'https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg' },
      { title: 'Flower Close-ups (CC0)', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.jpg' }
    ];
  }

  if (!window.pickWeeklyVideoIndex) {
    window.pickWeeklyVideoIndex = ()=>{
      const now = new Date();
      const w = getISOWeek(now);
      return w % HOT_VIDEOS.length;
    };
  }
})();

// ---------- Home ----------
function viewHome(){
  const weeklyIdx = pickWeeklyVideoIndex();
  return `
    <div class="card">
      <div class="card-body">
        <h3 style="margin-top:0">Welcome 👋</h3>
        <p style="color:var(--muted)">Pick a section or watch a quick hot pick video (updates weekly). Tap Shuffle to change.</p>

        <div class="grid cols-4 auto" style="margin-bottom:12px">
          <div class="card tile" data-go="inventory">
            <div class="card-body" style="display:flex;gap:10px;align-items:center">
              <i class="ri-archive-2-line"></i><div><div>Inventory</div></div>
            </div>
          </div>
          <div class="card tile" data-go="products">
            <div class="card-body" style="display:flex;gap:10px;align-items:center">
              <i class="ri-store-2-line"></i><div><div>Products</div></div>
            </div>
          </div>
          <div class="card tile" data-go="cogs">
            <div class="card-body" style="display:flex;gap:10px;align-items:center">
              <i class="ri-money-dollar-circle-line"></i><div><div>COGS</div></div>
            </div>
          </div>
          <div class="card tile" data-go="tasks">
            <div class="card-body" style="display:flex;gap:10px;align-items:center">
              <i class="ri-list-check-2"></i><div><div>Tasks</div></div>
            </div>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <h4 style="margin:0">Hot Weekly Video</h4>
                <div style="display:flex;gap:8px">
                  <button class="btn ghost" id="btnShuffleVideo"><i class="ri-shuffle-line"></i> Shuffle</button>
                </div>
              </div>
              <div id="videoWrap" data-video-index="${weeklyIdx}">
                <div id="videoTitle" style="font-weight:700;margin-bottom:8px"></div>
                <video
                  id="hotVideo"
                  style="width:100%;border-radius:12px;border:1px solid var(--card-border)"
                  controls
                  playsinline
                  preload="metadata"
                  poster="">
                  <source id="hotVideoSrc" src="" type="video/mp4" />
                  Your browser does not support HTML5 video.
                </video>
                <div style="color:var(--muted);font-size:12px;margin-top:6px">
                  On iPhone, videos require a tap to play (autoplay is restricted).
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function wireHome(){
  const wrap = document.getElementById('videoWrap');
  const vEl  = document.getElementById('hotVideo');
  const src  = document.getElementById('hotVideoSrc');
  const title= document.getElementById('videoTitle');
  const btn  = document.getElementById('btnShuffleVideo');
  if (!wrap || !vEl || !src || !title) return;

  const setVideo = (idx)=>{
    const pool = window.HOT_VIDEOS || [];
    if (!pool.length) return;
    const i = ((idx % pool.length) + pool.length) % pool.length;
    const item = pool[i];
    title.textContent = item.title || 'Hot pick';
    src.src = item.src; vEl.poster = item.poster || '';
    try{ vEl.load(); }catch(_){}
  };

  const startIdx = parseInt(wrap.getAttribute('data-video-index') || '0', 10) || 0;
  setVideo(startIdx);

  btn?.addEventListener('click', ()=>{
    const pool = window.HOT_VIDEOS || [];
    if (!pool.length) return;
    const curr = parseInt(wrap.getAttribute('data-video-index') || '0', 10) || 0;
    let next = Math.floor(Math.random()*pool.length);
    if (pool.length > 1 && next === curr) next = (next+1) % pool.length;
    wrap.setAttribute('data-video-index', String(next));
    setVideo(next);
    notify('Shuffled video', 'ok');
  });
}

// ---------- Search ----------
function viewSearch(){
  const q = (window.searchQuery || '').trim();
  const hasSearch = (typeof buildSearchIndex === 'function' && typeof searchAll === 'function');
  const index = hasSearch ? buildSearchIndex() : [];
  const out = q && hasSearch ? searchAll(index, q) : (q ? [{route:'dashboard', id:'', label:`Search for “${q}”`, section:'General'}] : []);

  return `
    <div class="card">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Search</h3>
          <div style="color:var(--muted)">Query: <strong>${q || '(empty)'}</strong></div>
        </div>
        ${out.length ? `
          <div class="grid">
            ${out.map(r => `
              <div class="card">
                <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:700">${r.label}</div>
                    <div style="color:var(--muted);font-size:12px">${r.section || ''}</div>
                  </div>
                  <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
                </div>
              </div>`).join('')}
          </div>` : `<p style="color:var(--muted)">No results.</p>`}
      </div>
    </div>
  `;
}

// ---------- Dashboard ----------
function viewDashboard(){
  const posts = load('posts', []);
  const inv   = load('inventory', []);
  const prods = load('products', []);
  const users = load('users', []);
  const tasks = load('tasks', []);
  const cogs  = load('cogs', []);

  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;

  const sumForMonth = (year, month)=> cogs
    .filter(r => { const p = parseYMD(r.date); return p && p.y===year && p.m===month; })
    .reduce((s, r)=> s + Number(r.grossIncome||0), 0);

  const today = new Date();
  const cy = today.getFullYear(), cm = today.getMonth()+1;
  const py = cm === 1 ? (cy-1) : cy;
  const pm = cm === 1 ? 12 : (cm-1);
  const ly = cy-1, lm = cm;

  const totalThisMonth = sumForMonth(cy, cm);
  const totalPrevMonth = sumForMonth(py, pm);
  const totalLastYearSameMonth = sumForMonth(ly, lm);

  const pct = (a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0? 100 : 0));
  const mom = pct(totalThisMonth, totalPrevMonth);
  const yoy = pct(totalThisMonth, totalLastYearSameMonth);

  const fmtPct = (v)=> `${v>=0?'+':''}${v.toFixed(1)}%`;
  const trendColor = (v)=> v>=0 ? 'var(--ok)' : 'var(--danger)';

  return `
    <div class="grid cols-4 auto">
      <div class="card tile" data-go="inventory" style="cursor:pointer"><div>Total Items</div><h2>${inv.length}</h2></div>
      <div class="card tile" data-go="products"  style="cursor:pointer"><div>Products</div><h2>${prods.length}</h2></div>
      <div class="card tile" data-go="settings"  style="cursor:pointer"><div>Users</div><h2>${users.length}</h2></div>
      <div class="card tile" data-go="tasks"     style="cursor:pointer"><div>Tasks</div><h2>${tasks.length}</h2></div>
    </div>

    <div class="grid cols-4 auto" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn)">
        <div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div>
      </div>
      <div class="card" style="border-left:4px solid var(--danger)">
        <div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div>
      </div>

      <div class="card">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>Sales (Month-to-Date)</strong>
            <button class="btn ghost" data-go="cogs"><i class="ri-line-chart-line"></i> Details</button>
          </div>
          <div style="margin-top:6px"><span style="color:var(--muted)">This month:</span> <strong>${USD(totalThisMonth)}</strong></div>
          <div><span style="color:var(--muted)">Prev month:</span> ${USD(totalPrevMonth)} <span style="color:${trendColor(mom)}">${fmtPct(mom)} MoM</span></div>
          <div><span style="color:var(--muted)">Same month last year:</span> ${USD(totalLastYearSameMonth)} <span style="color:${trendColor(yoy)}">${fmtPct(yoy)} YoY</span></div>
        </div>
      </div>

      <div class="card" data-go="tasks" style="cursor:pointer">
        <div class="card-body"><strong>Tasks</strong><div style="color:var(--muted)">Manage lanes</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          ${canAdd() ? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>` : ''}
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
          ${posts.map(p => `
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
    </div>
  `;
}

function wireDashboard(){
  const addPostBtn = document.getElementById('addPost');
  if (addPostBtn) addPostBtn.onclick = () => openModal('m-post');
}

function wirePosts(){
  const sec = document.querySelector('[data-section="posts"]'); 
  if (!sec) return;

  // Save (modal)
  document.getElementById('save-post')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const posts = load('posts', []);
    const id = document.getElementById('post-id')?.value || ('post_'+Date.now());
    const obj = {
      id,
      title: (document.getElementById('post-title')?.value || '').trim(),
      body: (document.getElementById('post-body')?.value || '').trim(),
      img:  (document.getElementById('post-img')?.value || '').trim(),
      createdAt: Date.now()
    };
    if (!obj.title) return notify('Title required','warn');
    const i = posts.findIndex(x=>x.id===id);
    if (i>=0) { if (!canEdit()) return notify('No permission','warn'); posts[i]=obj; }
    else posts.unshift(obj);
    save('posts', posts);
    closeModal('m-post');
    notify('Saved'); renderApp();
  });

  // Edit/Delete
  sec.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if (!id) return;

    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const posts = load('posts', []);
      const p = posts.find(x=>x.id===id); if (!p) return;
      openModal('m-post');
      document.getElementById('post-id').value = p.id;
      document.getElementById('post-title').value = p.title;
      document.getElementById('post-body').value = p.body;
      document.getElementById('post-img').value = p.img||'';
    } else {
      if (!canDelete()) return notify('No permission','warn');
      let posts = load('posts', []).filter(x=>x.id!==id);
      save('posts', posts); notify('Deleted'); renderApp();
    }
  });
}

// Hook render to wire home/dashboard/posts
(function(){
  const _old = window.renderApp;
  if (!_old || _old.__wrapC) return;
  window.renderApp = function(){
    _old.call(this);
    if (window.currentRoute === 'home') wireHome?.();
    if (window.currentRoute === 'dashboard') { wireDashboard?.(); wirePosts?.(); }
  };
  window.renderApp.__wrapC = true;
})();

// Part D — Inventory / Products / COGS / Tasks
// ===================== Part D =====================

// ---------- CSV export ----------
function downloadCSV(filename, rows, headers) {
  try {
    const csvRows = [];
    if (headers && headers.length) csvRows.push(headers.join(','));
    for (const r of rows) {
      const vals = headers.map(h => {
        const v = r[h];
        const s = (v === undefined || v === null) ? '' : String(v);
        const needsQuotes = /[",\n]/.test(s);
        const escaped = s.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
      });
      csvRows.push(vals.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    notify('Exported CSV', 'ok');
  } catch (e) {
    notify('Export failed', 'danger');
  }
}

// ---------- Inventory ----------
function viewInventory(){
  const items = load('inventory', []);
  return `
    <div class="card">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Inventory</h3>
          <div style="display:flex;gap:8px">
            <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd() ? `<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>` : ''}
          </div>
        </div>
        <div class="table-wrap" data-section="inventory">
          <table class="table">
            <thead><tr>
              <th>Image</th><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${items.map(it => {
                const warnClass =
                  it.stock <= it.threshold
                    ? (it.stock <= Math.max(1, Math.floor(it.threshold * 0.6)) ? 'tr-danger' : 'tr-warn')
                    : '';
                return `<tr id="${it.id}" class="${warnClass}">
                  <td>
                    <div class="thumb-wrap">
                      ${
                        it.img
                          ? `<img class="thumb inv-preview" data-src="${it.img}" alt=""/>`
                          : `<div class="thumb inv-preview" data-src="icons/icon-512.png" style="display:grid;place-items:center">📦</div>`
                      }
                      <img class="thumb-large" src="${it.img || 'icons/icon-512.png'}" alt=""/>
                    </div>
                  </td>
                  <td>${it.name}</td>
                  <td>${it.code}</td>
                  <td>${it.type || '-'}</td>
                  <td>${USD(it.price)}</td>
                  <td>
                    ${canAdd()? `
                      <button class="btn ghost" data-dec="${it.id}">–</button>
                      <span style="padding:0 10px">${it.stock}</span>
                      <button class="btn ghost" data-inc="${it.id}">+</button>
                    ` : `<span>${it.stock}</span>`}
                  </td>
                  <td>
                    ${canAdd()? `
                      <button class="btn ghost" data-dec-th="${it.id}">–</button>
                      <span style="padding:0 10px">${it.threshold}</span>
                      <button class="btn ghost" data-inc-th="${it.id}">+</button>
                    ` : `<span>${it.threshold}</span>`}
                  </td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function wireInventory(){
  const sec = document.querySelector('[data-section="inventory"]');
  if (!sec) return;

  document.getElementById('export-inventory')?.addEventListener('click', ()=>{
    const items = load('inventory', []);
    downloadCSV('inventory.csv', items, ['id','name','code','type','price','stock','threshold','img']);
  });

  document.getElementById('addInv')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-inv');
    $('#inv-id').value='';
    $('#inv-name').value='';
    $('#inv-code').value='';
    $('#inv-type').value='Other';
    $('#inv-price').value='0';
    $('#inv-stock').value='0';
    $('#inv-threshold').value='0';
    $('#inv-img').value='';
  });

  document.getElementById('save-inv')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const items = load('inventory', []);
    const id = $('#inv-id').value || ('inv_'+Date.now());
    const obj = {
      id,
      name: $('#inv-name').value.trim(),
      code: $('#inv-code').value.trim(),
      type: $('#inv-type').value.trim(),
      price: parseFloat($('#inv-price').value || '0'),
      stock: parseInt($('#inv-stock').value || '0'),
      threshold: parseInt($('#inv-threshold').value || '0'),
      img: $('#inv-img').value.trim(),
    };
    if (!obj.name) return notify('Name required','warn');
    const i = items.findIndex(x=>x.id===id);
    if (i>=0) { if (!canEdit()) return notify('No permission','warn'); items[i]=obj; }
    else items.push(obj);
    save('inventory', items);
    closeModal('m-inv'); notify('Saved'); renderApp();
  });

  sec.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const items = load('inventory', []);
    const get = (id)=> items.find(x=>x.id===id);

    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const id = btn.getAttribute('data-edit');
      const it = get(id); if (!it) return;
      openModal('m-inv');
      $('#inv-id').value=id;
      $('#inv-name').value=it.name;
      $('#inv-code').value=it.code;
      $('#inv-type').value=it.type || 'Other';
      $('#inv-price').value=it.price;
      $('#inv-stock').value=it.stock;
      $('#inv-threshold').value=it.threshold;
      $('#inv-img').value=it.img || '';
      return;
    }

    if (btn.hasAttribute('data-del')) {
      if (!canDelete()) return notify('No permission','warn');
      const id = btn.getAttribute('data-del');
      const next = items.filter(x=>x.id!==id);
      save('inventory', next); notify('Deleted'); renderApp(); return;
    }

    const id =
      btn.getAttribute('data-inc') ||
      btn.getAttribute('data-dec') ||
      btn.getAttribute('data-inc-th') ||
      btn.getAttribute('data-dec-th');

    if (!id) return;
    if (!canAdd()) return notify('No permission','warn');
    const it = get(id); if (!it) return;

    if (btn.hasAttribute('data-inc')) { it.stock++; }
    if (btn.hasAttribute('data-dec')) { it.stock = Math.max(0, it.stock-1); }
    if (btn.hasAttribute('data-inc-th')) { it.threshold++; }
    if (btn.hasAttribute('data-dec-th')) { it.threshold = Math.max(0, it.threshold-1); }

    save('inventory', items); renderApp();
  });
}

// ---------- Products ----------
function viewProducts(){
  const items = load('products', []);
  return `
    <div class="card">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Products</h3>
          <div style="display:flex;gap:8px">
            <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd() ? `<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>` : ''}
          </div>
        </div>
        <div class="table-wrap" data-section="products">
          <table class="table">
            <thead><tr>
              <th>Image</th><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${items.map(it => `
                <tr id="${it.id}">
                  <td>
                    <div class="thumb-wrap">
                      ${
                        it.img
                          ? `<img class="thumb prod-thumb" data-card="${it.id}" alt="" src="${it.img}"/>`
                          : `<div class="thumb prod-thumb" data-card="${it.id}" style="display:grid;place-items:center;cursor:pointer">🛒</div>`
                      }
                      <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
                    </div>
                  </td>
                  <td>${it.name}</td>
                  <td>${it.barcode||''}</td>
                  <td>${USD(it.price)}</td>
                  <td>${it.type||'-'}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function wireProducts(){
  const sec = document.querySelector('[data-section="products"]');
  if (!sec) return;

  document.getElementById('export-products')?.addEventListener('click', ()=>{
    const items = load('products', []);
    downloadCSV('products.csv', items, ['id','name','barcode','price','type','ingredients','instructions','img']);
  });

  document.getElementById('addProd')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-prod');
    $('#prod-id').value='';
    $('#prod-name').value='';
    $('#prod-barcode').value='';
    $('#prod-price').value='0';
    $('#prod-type').value='';
    $('#prod-ingredients').value='';
    $('#prod-instructions').value='';
    $('#prod-img').value='';
  });

  document.getElementById('save-prod')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const items = load('products', []);
    const id = $('#prod-id').value || ('p_'+Date.now());
    const obj = {
      id,
      name: $('#prod-name').value.trim(),
      barcode: $('#prod-barcode').value.trim(),
      price: parseFloat($('#prod-price').value || '0'),
      type: $('#prod-type').value.trim(),
      ingredients: $('#prod-ingredients').value.trim(),
      instructions: $('#prod-instructions').value.trim(),
      img: $('#prod-img').value.trim()
    };
    if (!obj.name) return notify('Name required','warn');
    const i = items.findIndex(x=>x.id===id);
    if (i>=0) { if (!canEdit()) return notify('No permission','warn'); items[i]=obj; }
    else items.push(obj);
    save('products', items);
    closeModal('m-prod');
    notify('Saved'); renderApp();
  });

  // Row actions + product card modal
  sec.addEventListener('click', (e)=>{
    const prodCard = e.target.closest('.prod-thumb');
    if (prodCard){
      const id = prodCard.getAttribute('data-card');
      const items = load('products', []);
      const it = items.find(x=>x.id===id); if (!it) return;
      $('#pc-name').textContent = it.name;
      $('#pc-img').src = it.img || 'icons/icon-512.png';
      $('#pc-barcode').textContent = it.barcode || '';
      $('#pc-price').textContent = USD(it.price);
      $('#pc-type').textContent = it.type || '';
      $('#pc-ingredients').textContent = it.ingredients || '';
      $('#pc-instructions').textContent = it.instructions || '';
      openModal('m-card');
      return;
    }

    const btn = e.target.closest('button'); 
    if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); 
    if (!id) return;

    const items = load('products', []);
    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const it = items.find(x=>x.id===id); if (!it) return;
      openModal('m-prod');
      $('#prod-id').value=id;
      $('#prod-name').value=it.name;
      $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price;
      $('#prod-type').value=it.type||'';
      $('#prod-ingredients').value=it.ingredients||'';
      $('#prod-instructions').value=it.instructions||'';
      $('#prod-img').value=it.img||'';
    } else {
      if (!canDelete()) return notify('No permission','warn');
      const next = items.filter(x=>x.id!==id);
      save('products', next); notify('Deleted'); renderApp();
    }
  });
}

// ---------- COGS ----------
function viewCOGS(){
  const rows = load('cogs', []);
  const totals = rows.reduce((a,r)=>({
    grossIncome:a.grossIncome+(+r.grossIncome||0),
    produceCost:a.produceCost+(+r.produceCost||0),
    itemCost:a.itemCost+(+r.itemCost||0),
    freight:a.freight+(+r.freight||0),
    delivery:a.delivery+(+r.delivery||0),
    other:a.other+(+r.other||0)
  }),{grossIncome:0,produceCost:0,itemCost:0,freight:0,delivery:0,other:0});
  const grossProfit = (r)=> (+r.grossIncome||0) - ((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  const totalProfit = grossProfit(totals);

  return `
    <div class="card">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">COGS</h3>
          <div style="display:flex;gap:8px">
            <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd() ? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>` : ''}
          </div>
        </div>
        <div class="table-wrap" data-section="cogs">
          <table class="table">
            <thead><tr>
              <th>Date</th><th>Gross Income</th><th>Produce Cost</th><th>Item Cost</th>
              <th>Freight</th><th>Delivery</th><th>Other</th><th>Gross Profit</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${rows.map(r=>`
                <tr id="${r.id}">
                  <td>${r.date}</td>
                  <td>${USD(r.grossIncome)}</td>
                  <td>${USD(r.produceCost)}</td>
                  <td>${USD(r.itemCost)}</td>
                  <td>${USD(r.freight)}</td>
                  <td>${USD(r.delivery)}</td>
                  <td>${USD(r.other)}</td>
                  <td>${USD(grossProfit(r))}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
              <tr class="tr-total">
                <th>Total</th>
                <th>${USD(totals.grossIncome)}</th>
                <th>${USD(totals.produceCost)}</th>
                <th>${USD(totals.itemCost)}</th>
                <th>${USD(totals.freight)}</th>
                <th>${USD(totals.delivery)}</th>
                <th>${USD(totals.other)}</th>
                <th>${USD(totalProfit)}</th>
                <th></th>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function wireCOGS(){
  const sec = document.querySelector('[data-section="cogs"]'); 
  if (!sec) return;

  document.getElementById('export-cogs')?.addEventListener('click', ()=>{
    const rows = load('cogs', []);
    downloadCSV('cogs.csv', rows, [
      'id','date','grossIncome','produceCost','itemCost','freight','delivery','other'
    ]);
  });

  document.getElementById('addCOGS')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-cogs');
    $('#cogs-id').value='';
    $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value='0';
    $('#cogs-produceCost').value='0';
    $('#cogs-itemCost').value='0';
    $('#cogs-freight').value='0';
    $('#cogs-delivery').value='0';
    $('#cogs-other').value='0';
  });

  document.getElementById('save-cogs')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const rows = load('cogs', []);
    const id = $('#cogs-id').value || ('c_'+Date.now());
    const row = {
      id,
      date: $('#cogs-date').value || new Date().toISOString().slice(0,10),
      grossIncome: parseFloat($('#cogs-grossIncome').value || '0'),
      produceCost: parseFloat($('#cogs-produceCost').value || '0'),
      itemCost: parseFloat($('#cogs-itemCost').value || '0'),
      freight: parseFloat($('#cogs-freight').value || '0'),
      delivery: parseFloat($('#cogs-delivery').value || '0'),
      other: parseFloat($('#cogs-other').value || '0'),
    };
    const i = rows.findIndex(x=>x.id===id);
    if (i>=0) { if (!canEdit()) return notify('No permission','warn'); rows[i]=row; }
    else rows.push(row);
    save('cogs', rows);
    closeModal('m-cogs'); notify('Saved'); renderApp();
  });

  sec.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if (!id) return;

    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const rows = load('cogs', []); const r = rows.find(x=>x.id===id); if (!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=id;
      $('#cogs-date').value=r.date;
      $('#cogs-grossIncome').value=r.grossIncome;
      $('#cogs-produceCost').value=r.produceCost;
      $('#cogs-itemCost').value=r.itemCost;
      $('#cogs-freight').value=r.freight;
      $('#cogs-delivery').value=r.delivery;
      $('#cogs-other').value=r.other;
    } else {
      if (!canDelete()) return notify('No permission','warn');
      let rows = load('cogs', []).filter(x=>x.id!==id);
      save('cogs', rows); notify('Deleted'); renderApp();
    }
  });
}

// ---------- Tasks (DnD any lane, CRUD with roles) ----------
function viewTasks(){
  const items = load('tasks', []);
  const lane = (key, label, color)=>`
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
    </div>
  `;
  return `
    <div data-section="tasks">
      ${lane('todo','To do','#f59e0b')}
      ${lane('inprogress','In progress','#3b82f6')}
      ${lane('done','Done','#10b981')}
    </div>
  `;
}

function wireTasks(){
  const root = document.querySelector('[data-section="tasks"]'); 
  if (!root) return;

  document.getElementById('addTask')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-task');
    $('#task-id').value='';
    $('#task-title').value='';
    $('#task-status').value='todo';
  });

  document.getElementById('save-task')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const items = load('tasks', []);
    const id = $('#task-id').value || ('t_'+Date.now());
    const obj = { id, title: $('#task-title').value.trim(), status: $('#task-status').value };
    if (!obj.title) return notify('Title required','warn');
    const i = items.findIndex(x=>x.id===id);
    if (i>=0) { if (!canEdit()) return notify('No permission','warn'); items[i]=obj; }
    else items.push(obj);
    save('tasks',items);
    closeModal('m-task');
    notify('Saved'); renderApp();
  });

  root.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if (!id) return;
    const items = load('tasks', []);

    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const t = items.find(x=>x.id===id); if (!t) return;
      openModal('m-task');
      $('#task-id').value = t.id;
      $('#task-title').value = t.title;
      $('#task-status').value = t.status;
    } else {
      if (!canDelete()) return notify('No permission','warn');
      const next = items.filter(x=>x.id!==id);
      save('tasks', next); notify('Deleted'); renderApp();
    }
  });

  setupDnD();
}

function setupDnD(){
  const lanes = ['todo','inprogress','done'];
  const allow = { 'todo':new Set(lanes), 'inprogress':new Set(lanes), 'done':new Set(lanes) };

  document.querySelectorAll('[data-task]').forEach(card=>{
    card.ondragstart = (e)=> {
      e.dataTransfer.setData('text/plain', card.getAttribute('data-task'));
      e.dataTransfer.dropEffect = 'move';
    };
  });

  lanes.forEach(k=>{
    const laneGrid  = document.getElementById('lane-'+k);
    const parentCard = laneGrid?.closest('.lane-row');
    if (!laneGrid) return;

    const over = (e)=>{
      e.preventDefault();
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) { parentCard?.classList.remove('drop'); return; }
      const items = load('tasks', []);
      const t = items.find(x=>x.id===id);
      if (t && allow[t.status].has(k)) parentCard?.classList.add('drop');
      else parentCard?.classList.remove('drop');
    };
    const leave = ()=> parentCard?.classList.remove('drop');
    const drop = (e)=>{
      e.preventDefault();
      if (!canAdd()) return notify('No permission','warn'); // move requires write
      parentCard?.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      const items = load('tasks', []);
      const t = items.find(x=>x.id===id); 
      if (!t) return;
      if (!allow[t.status].has(k)) { notify('Move not allowed','warn'); return; }
      t.status = k; 
      save('tasks', items); 
      renderApp();
    };

    laneGrid.ondragover  = over;
    laneGrid.ondragenter = (e)=> e.preventDefault();
    laneGrid.ondragleave = leave;
    laneGrid.ondrop      = drop;
  });
}

// Hook Part D into render
(function(){
  const _old = window.renderApp;
  if (!_old || _old.__wrapD) return;
  window.renderApp = function(){
    _old.call(this);
    if (window.currentRoute === 'inventory')  wireInventory?.();
    if (window.currentRoute === 'products')   wireProducts?.();
    if (window.currentRoute === 'cogs')       wireCOGS?.();
    if (window.currentRoute === 'tasks')      wireTasks?.();
  };
  window.renderApp.__wrapD = true;
})();

// Part E — Settings (Cloud/Theme + Users CRUD), Contact, Modals
// ===================== Part E =====================

// ---------- Modal helpers (global app modals) ----------
function openModal(id){
  const m = document.getElementById(id);
  const mb = document.getElementById('mb-'+(id.split('-')[1]||''));
  if (m) m.classList.add('active');
  if (mb) mb.classList.add('active');
}
function closeModal(id){
  const m = document.getElementById(id);
  const mb = document.getElementById('mb-'+(id.split('-')[1]||''));
  if (m) m.classList.remove('active');
  if (mb) mb.classList.remove('active');
}

// Mobile image preview
function enableMobileImagePreview(){
  const isPhone = window.matchMedia('(max-width: 740px)').matches;
  if (!isPhone) return;
  document.querySelectorAll('.inv-preview, .prod-thumb').forEach(el=>{
    el.style.cursor = 'pointer';
    el.addEventListener('click', ()=>{
      const src = el.getAttribute('data-src') || el.getAttribute('src') || 'icons/icon-512.png';
      const img = document.getElementById('preview-img');
      if (img) img.src = src;
      openModal('m-img');
    });
  });
}

// ---------- Static pages + Contact builder ----------
window.pageContent = window.pageContent || {};
Object.assign(window.pageContent, {
  policy: `<h3>Policy</h3>
    <div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden">
      <iframe src="policy.html" style="width:100%;height:calc(100vh - 220px);border:none"></iframe>
    </div>`,
  license:`<h3>License</h3>
    <div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden">
      <iframe src="license.html" style="width:100%;height:calc(100vh - 220px);border:none"></iframe>
    </div>`,
  setup:  `<h3>Setup Guide</h3>
    <div style="border:1px solid var(--card-border); border-radius:12px; overflow:hidden;">
      <iframe src="setup-guide.html" style="width:100%; height: calc(100vh - 220px); border:none;"></iframe>
    </div>
    <p style="color:var(--muted); font-size:12px; margin-top:8px">
      Tip: open in a new tab if you want a full-page view.
    </p>`,
  guide:`<h3>User Guide</h3>
    <div style="border:1px solid var(--card-border);border-radius:12px;overflow:hidden">
      <iframe src="guide.html" style="width:100%;height:calc(100vh - 220px);border:none"></iframe>
    </div>`,
  contact:`<h3>Contact</h3>
    <p>Send an email directly from here. If EmailJS is available, it will send via your template; otherwise it will open your email app.</p>
    <div class="grid cols-2">
      <input id="ct-to"    class="input" type="email" placeholder="Recipient email (To)" value="${load('contact_to','you@example.com')}"/>
      <input id="ct-email" class="input" type="email" placeholder="Your email (reply-to)" value="${session?.email||''}"/>
    </div>
    <input id="ct-name" class="input" placeholder="Your name" value="${session?.name||''}"/>
    <textarea id="ct-msg" class="input" rows="5" placeholder="Message"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <button id="ct-send" class="btn"><i class="ri-send-plane-line"></i> Send</button>
    </div>
    <p style="color:var(--muted);font-size:12px;margin-top:6px">Settings no longer include email config; specify the recipient here.</p>`
});

function viewPage(key){
  return `<div class="card"><div class="card-body">${(window.pageContent && window.pageContent[key]) || '<p>Page</p>'}</div></div>`;
}

function wireContact(){
  const btn = document.getElementById('ct-send');
  if (!btn) return;
  btn.onclick = async ()=>{
    const to   = (document.getElementById('ct-to')?.value || '').trim();
    const name = (document.getElementById('ct-name')?.value || '').trim();
    const email= (document.getElementById('ct-email')?.value || '').trim();
    const msg  = (document.getElementById('ct-msg')?.value || '').trim();
    if (!to || !name || !email || !msg){ notify('Please fill all fields','warn'); return; }
    save('contact_to', to);

    const hasEmailJS = !!(window.emailjs && window.emailjs.send);
    if (hasEmailJS){
      try{
        if (!window.__emailjs_inited){
          // window.emailjs.init('YOUR_PUBLIC_KEY');
          window.__emailjs_inited = true;
        }
        await window.emailjs.send('service_id', 'template_id', {
          from_name: name, reply_to: email, message: msg, to_email: to
        });
        notify('Message sent!', 'ok');
        $('#ct-msg').value='';
      }catch(e){
        notify('Failed via EmailJS. Opening your email app…','warn');
        window.location.href = `mailto:${encodeURIComponent(to)}`
          + `?subject=${encodeURIComponent('Contact from Inventory App')}`
          + `&body=${encodeURIComponent(`From: ${name} <${email}>\n\n${msg}`)}`;
      }
    } else {
      window.location.href = `mailto:${encodeURIComponent(to)}`
        + `?subject=${encodeURIComponent('Contact from Inventory App')}`
        + `&body=${encodeURIComponent(`From: ${name} <${email}>\n\n${msg}`)}`;
    }
  };
}

// ---------- Settings (Cloud + Theme + Users) ----------
function viewSettings(){
  const users = load('users', []);
  const theme = (typeof getTheme === 'function') ? getTheme() : {mode:'aqua', size:'medium'};
  const cloudOn = (typeof cloud?.isOn === 'function') ? cloud.isOn() : false;

  return `
    <div class="grid">
      <!-- Cloud -->
      <div class="card">
        <div class="card-body">
          <h3 style="margin-top:0">Cloud Sync</h3>
          <p style="color:var(--muted)">Keep your data in Firebase Realtime Database. Works offline; sync when online.</p>
          <div class="theme-inline">
            <div>
              <label style="font-size:12px;color:var(--muted)">Status</label>
              <select id="cloud-toggle" class="input">
                <option value="off" ${!cloudOn?'selected':''}>Off</option>
                <option value="on"  ${cloudOn?'selected':''}>On</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted)">Actions</label><br/>
              <button class="btn" id="cloud-sync-now"><i class="ri-cloud-line"></i> Sync Now</button>
            </div>
          </div>
          <p style="color:var(--muted);font-size:12px;margin-top:8px">Note: Cloud Sync requires a Firebase login (local admin cannot use cloud).</p>
        </div>
      </div>

      <!-- Theme -->
      <div class="card">
        <div class="card-body">
          <h3 style="margin-top:0">Theme</h3>
          <div class="theme-inline">
            <div>
              <label style="font-size:12px;color:var(--muted)">Mode</label>
              <select id="theme-mode" class="input">
                ${(window.THEME_MODES||[{key:'light',name:'Light'},{key:'dark',name:'Dark'},{key:'aqua',name:'Aqua'}])
                  .map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted)">Font Size</label>
              <select id="theme-size" class="input">
                ${(window.THEME_SIZES||[{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}])
                  .map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Users -->
      <div class="card">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">Users</h3>
            ${canAdd()? `<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
          </div>
          <table class="table" data-section="users">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u=>`
                <tr id="${u.email}">
                  <td>${u.name}</td>
                  <td>${u.email}</td>
                  <td>${u.role}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    ${postModal()}
    ${invModal()}
    ${prodModal()}
    ${prodCardModal()}
    ${cogsModal()}
    ${taskModal()}
    ${userModal()}
    ${imgPreviewModal()}
  `;
}

// Role option limits when non-admin edits
function allowedRoleOptions(){
  const r = role();
  if (r === 'admin') return ROLES;
  if (r === 'manager') return ['user','associate','manager']; // no admin escalation
  if (r === 'associate') return ['user','associate'];
  return ['user']; // viewer cannot change roles, only view
}

function wireSettings(){
  // Theme instant apply
  const mode = document.getElementById('theme-mode');
  const size = document.getElementById('theme-size');
  const applyThemeNow = ()=>{
    const t = { mode: mode.value, size: size.value };
    save('_theme2', t);
    applyTheme();
    renderApp();
  };
  mode?.addEventListener('change', applyThemeNow);
  size?.addEventListener('change', applyThemeNow);

  // Cloud controls
  const toggle = document.getElementById('cloud-toggle');
  const syncNow = document.getElementById('cloud-sync-now');

  toggle?.addEventListener('change', async (e)=>{
    const val = e.target.value;
    try {
      if (val === 'on'){
        if (!auth.currentUser){ notify('Sign in with Firebase to use Cloud Sync.','warn'); toggle.value='off'; return; }
        await firebase.database().goOnline();
        await cloud.enable();
        notify('Cloud Sync ON');
      } else {
        cloud.disable();
        await firebase.database().goOffline();
        notify('Cloud Sync OFF');
      }
    } catch(err){
      notify(err?.message || 'Could not change sync','danger');
      toggle.value = cloud.isOn() ? 'on' : 'off';
    }
  });

  syncNow?.addEventListener('click', async ()=>{
    try{
      if (!auth.currentUser){ notify('Sign in with Firebase to use Cloud Sync.','warn'); return; }
      if (!cloud.isOn()){ notify('Turn Cloud Sync ON first in Settings.','warn'); return; }
      if (!navigator.onLine){ notify('You appear to be offline.','warn'); return; }
      await firebase.database().goOnline();
      await cloud.pushAll();
      notify('Synced');
    }catch(e){
      notify((e && e.message) || 'Sync failed','danger');
    }
  });

  // Users section wiring
  wireUsers();
}

function wireUsers(){
  const addBtn = document.getElementById('addUser');
  const table = document.querySelector('[data-section="users"]');

  addBtn?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-user');
    $('#user-name').value='';
    $('#user-email').value='';
    $('#user-username').value='';
    $('#user-img').value='';
    const sel = $('#user-role');
    sel.innerHTML = allowedRoleOptions().map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join('');
    sel.value = allowedRoleOptions()[0];
  });

  document.getElementById('save-user')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    const users = load('users', []);
    const email = ($('#user-email')?.value || '').trim().toLowerCase();
    if (!email) return notify('Email required','warn');
    const allowed = allowedRoleOptions();
    const chosenRole = ($('#user-role')?.value || 'user');
    if (!allowed.includes(chosenRole)) return notify('Role not allowed','warn');

    const obj = {
      name: ($('#user-name')?.value || email.split('@')[0]).trim(),
      email,
      username: ($('#user-username')?.value || email.split('@')[0]).trim(),
      role: chosenRole,
      img: ($('#user-img')?.value || '').trim(),
      contact:'', password:''
    };
    const i = users.findIndex(x=>x.email.toLowerCase()===email);
    if (i>=0) {
      if (!canEdit()) return notify('No permission','warn');
      users[i]=obj;
    } else {
      users.push(obj);
    }
    save('users', users);
    closeModal('m-user'); notify('Saved'); renderApp();
  });

  table?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const email = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if (!email) return;

    if (btn.hasAttribute('data-edit')) {
      if (!canEdit()) return notify('No permission','warn');
      const users = load('users', []); const u = users.find(x=>x.email===email); if (!u) return;
      openModal('m-user');
      $('#user-name').value=u.name;
      $('#user-email').value=u.email;
      $('#user-username').value=u.username;
      $('#user-img').value=u.img||'';
      const sel = $('#user-role');
      sel.innerHTML = allowedRoleOptions().map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join('');
      sel.value = allowedRoleOptions().includes(u.role) ? u.role : 'user';
    } else {
      if (!canDelete()) return notify('No permission','warn');
      let users = load('users', []).filter(x=>x.email!==email);
      save('users', users); notify('Deleted'); renderApp();
    }
  });
}

// ---------- ALL Modals ----------
function postModal(){
  return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post">
    <div class="dialog">
      <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
      <div class="body grid">
        <input id="post-id" type="hidden" />
        <input id="post-title" class="input" placeholder="Title" />
        <textarea id="post-body" class="input" placeholder="Body"></textarea>
        <input id="post-img" class="input" placeholder="Image URL (optional)" />
      </div>
      <div class="foot"><button class="btn" id="save-post">Save</button></div>
    </div>
  </div>`;
}

function invModal(){
  return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv">
    <div class="dialog">
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
      <div class="body grid">
        <input id="inv-id" type="hidden" />
        <input id="inv-name" class="input" placeholder="Name" />
        <input id="inv-code" class="input" placeholder="Code" />
        <select id="inv-type" class="input">
          <option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option>
        </select>
        <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price" />
        <input id="inv-stock" class="input" type="number" placeholder="Stock" />
        <input id="inv-threshold" class="input" type="number" placeholder="Threshold" />
        <input id="inv-img" class="input" placeholder="Image URL (optional)" />
      </div>
      <div class="foot"><button class="btn" id="save-inv">Save</button></div>
    </div>
  </div>`;
}

function prodModal(){
  return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod">
    <div class="dialog">
      <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
      <div class="body grid">
        <input id="prod-id" type="hidden" />
        <input id="prod-name" class="input" placeholder="Name" />
        <input id="prod-barcode" class="input" placeholder="Barcode" />
        <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price" />
        <input id="prod-type" class="input" placeholder="Type" />
        <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
        <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
        <input id="prod-img" class="input" placeholder="Image URL (optional)" />
      </div>
      <div class="foot"><button class="btn" id="save-prod">Save</button></div>
    </div>
  </div>`;
}

function prodCardModal(){
  return `
  <div class="modal-backdrop" id="mb-card"></div>
  <div class="modal" id="m-card">
    <div class="dialog">
      <div class="head"><strong id="pc-name">Product</strong><button class="btn ghost" data-close="m-card">Close</button></div>
      <div class="body grid cols-2">
        <div><img id="pc-img" style="width:100%;border-radius:12px;border:1px solid var(--card-border)" /></div>
        <div class="grid">
          <div><strong>Barcode:</strong> <span id="pc-barcode"></span></div>
          <div><strong>Price:</strong> <span id="pc-price"></span></div>
          <div><strong>Type:</strong> <span id="pc-type"></span></div>
          <div><strong>Ingredients:</strong><div id="pc-ingredients"></div></div>
          <div><strong>Instructions:</strong><div id="pc-instructions"></div></div>
        </div>
      </div>
    </div>
  </div>`;
}

function cogsModal(){
  return `
  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs">
    <div class="dialog">
      <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs">Close</button></div>
      <div class="body grid cols-2">
        <input id="cogs-id" type="hidden" />
        <input id="cogs-date" class="input" type="date" />
        <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income" />
        <input id="cogs-produceCost" class="input" type="number" step="0.01" placeholder="Produce Cost" />
        <input id="cogs-itemCost" class="input" type="number" step="0.01" placeholder="Item Cost" />
        <input id="cogs-freight" class="input" type="number" step="0.01" placeholder="Freight" />
        <input id="cogs-delivery" class="input" type="number" step="0.01" placeholder="Delivery" />
        <input id="cogs-other" class="input" type="number" step="0.01" placeholder="Other" />
      </div>
      <div class="foot"><button class="btn" id="save-cogs">Save</button></div>
    </div>
  </div>`;
}

function taskModal(){
  return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden" />
        <input id="task-title" class="input" placeholder="Title" />
        <select id="task-status">
          <option value="todo">To do</option>
          <option value="inprogress">In progress</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div class="foot"><button class="btn" id="save-task">Save</button></div>
    </div>
  </div>`;
}

function userModal(){
  return `
  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user">
    <div class="dialog">
      <div class="head"><strong>User</strong><button class="btn ghost" data-close="m-user">Close</button></div>
      <div class="body grid">
        <input id="user-name" class="input" placeholder="Name" />
        <input id="user-email" class="input" type="email" placeholder="Email" />
        <input id="user-username" class="input" placeholder="Username" />
        <select id="user-role"></select>
        <input id="user-img" class="input" placeholder="Image URL (optional)" />
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>`;
}

function imgPreviewModal(){
  return `
  <div class="modal-backdrop" id="mb-img"></div>
  <div class="modal img-modal" id="m-img">
    <div class="dialog">
      <div class="head"><strong>Preview</strong><button class="btn ghost" data-close="m-img">Close</button></div>
      <div class="body"><div class="imgbox"><img id="preview-img" src="" alt="Preview"/></div></div>
    </div>
  </div>`;
}

// Hook Settings & Contact into render
(function(){
  const _old = window.renderApp;
  if (!_old || _old.__wrapE) return;
  window.renderApp = function(){
    _old.call(this);
    if (window.currentRoute === 'settings') wireSettings();
    if (window.currentRoute === 'contact')  wireContact();
    enableMobileImagePreview?.();
  };
  window.renderApp.__wrapE = true;
})();

// Part F — Search utilities + boot + tiny debug API
// ===================== Part F =====================

if (typeof window.buildSearchIndex !== 'function') {
  window.buildSearchIndex = function buildSearchIndex(){
    const posts = load('posts', []);
    const inv   = load('inventory', []);
    const prods = load('products', []);
    const cogs  = load('cogs', []);
    const users = load('users', []);

    const pages = [
      { id:'policy',  label:'Policy',      section:'Pages', route:'policy'  },
      { id:'license', label:'License',     section:'Pages', route:'license' },
      { id:'setup',   label:'Setup Guide', section:'Pages', route:'setup'   },
      { id:'contact', label:'Contact',     section:'Pages', route:'contact' },
      { id:'guide',   label:'User Guide',  section:'Pages', route:'guide'   },
    ];

    const ix = [];
    posts.forEach(p => ix.push({ id:p.id, label:p.title, section:'Posts', route:'dashboard', text:`${p.title} ${p.body}` }));
    inv.forEach(i => ix.push({ id:i.id, label:i.name, section:'Inventory', route:'inventory', text:`${i.name} ${i.code} ${i.type}` }));
    prods.forEach(p => ix.push({ id:p.id, label:p.name, section:'Products', route:'products', text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}` }));
    cogs.forEach(r => ix.push({ id:r.id, label:r.date, section:'COGS', route:'cogs', text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.delivery} ${r.other}` }));
    users.forEach(u => ix.push({ id:u.email, label:u.name, section:'Users', route:'settings', text:`${u.name} ${u.email} ${u.role}` }));
    pages.forEach(p => ix.push(p));
    return ix;
  };
}

if (typeof window.searchAll !== 'function') {
  window.searchAll = function searchAll(index, q){
    const term = (q || '').toLowerCase();
    return index
      .map(item => {
        const labelHit = (item.label||'').toLowerCase().includes(term) ? 2 : 0;
        const textHit  = (item.text ||'').toLowerCase().includes(term) ? 1 : 0;
        return { item, score: labelHit + textHit };
      })
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .map(x => x.item);
  };
}

if (typeof window.scrollToRow !== 'function') {
  window.scrollToRow = function scrollToRow(id){
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  };
}

// Online / offline hints
(function(){
  if (!('addEventListener' in window)) return;
  window.addEventListener('online',  ()=> typeof notify==='function' && notify('Back online','ok'));
  window.addEventListener('offline', ()=> typeof notify==='function' && notify('You are offline','warn'));
})();

// Optional Service Worker
(function(){
  if (!('serviceWorker' in navigator)) return;
  const swUrl = 'service-worker.js';
  const tryRegister = () => navigator.serviceWorker.register(swUrl).catch(err => console.warn('[sw] registration failed:', err));
  fetch(swUrl, { method: 'HEAD' })
    .then(r => { if (!r.ok) return; if ('requestIdleCallback' in window) requestIdleCallback(tryRegister); else setTimeout(tryRegister, 500); })
    .catch(() => {});
})();

// First paint bootstrapping
(function boot(){
  try {
    if (typeof renderApp === 'function' && window.session) renderApp();
    else if (typeof renderLogin === 'function') renderLogin();
  } catch(e){
    if (typeof notify === 'function') notify(e.message || 'Startup error','danger');
    if (typeof renderLogin === 'function') renderLogin();
  }
})();

// Tiny debug API
window._inventory = Object.assign(window._inventory || {}, {
  go: (typeof go === 'function' ? go : undefined),
  load: (typeof load === 'function' ? load : undefined),
  save: (typeof save === 'function' ? save : undefined),
  cloud: (typeof cloud !== 'undefined' ? cloud : undefined),
  theme: (typeof getTheme === 'function' ? getTheme() : undefined),
  renderApp: (typeof renderApp === 'function' ? renderApp : undefined),
  role: ()=>role(),
  perms: { canAdd, canEdit, canDelete }
});