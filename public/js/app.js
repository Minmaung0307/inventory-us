/* =========================
   Inventory — Single-file SPA logic (Firebase v8 + LocalStorage)
   ========================= */

/* ---------- Small helpers ---------- */
function USD(x){ return `$${Number(x || 0).toFixed(2)}`; }
function parseYMD(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
function getISOWeek(d){ const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const n=t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-n); const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil((((t - y0) / 86400000) + 1)/7); }
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const safeJSON = (s,f=null)=>{ try{ return JSON.parse(s) }catch{ return f } };
function notify(msg,type='ok'){ const n=$('#notification'); if(!n)return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>{ n.className='notification'; },2400); }

/* ---------- Firebase config (replace with your real keys) ---------- */
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

/* ---------- Theme ---------- */
const THEME_MODES = [{key:'light',name:'Light'},{key:'dark',name:'Dark'},{key:'aqua',name:'Aqua'}];
const THEME_SIZES = [{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}];
function applyTheme(){
  const t = _gload('_theme2', { mode:'aqua', size:'medium' });
  const size = THEME_SIZES.find(s=>s.key===t.size)?.pct ?? 100;
  document.documentElement.setAttribute('data-theme', t.mode==='light' ? 'light' : (t.mode==='dark' ? 'dark' : ''));
  document.documentElement.style.setProperty('--font-scale', size + '%');
}

/* ---------- Roles ---------- */
const ROLES = ['user','associate','manager','admin'];
const SUPER_ADMINS = ['admin@sushi.com','admin@inventory.com'];
const DEMO_ADMIN_EMAIL = 'admin@inventory.com';
const DEMO_ADMIN_PASS  = 'admin123';

function role(){ return (session?.role)||'user'; }
const canView   = ()=> true;
const canAdd    = ()=> ['admin','manager','associate'].includes(role());
const canEdit   = ()=> ['admin','manager'].includes(role());
const canDelete = ()=> ['admin'].includes(role());

/* ---------- Per-user (tenant) storage ---------- */
/* All user data is kept per-tenant (separate for each logged-in account).
   Local keys are automatically namespaced with the tenantKey. */
let session      = safeJSON(localStorage.getItem('session'), null);
let currentRoute = localStorage.getItem('_route') || 'home';
let searchQuery  = localStorage.getItem('_searchQ') || '';

function tenantKey(){
  if (auth.currentUser) return `uid:${auth.currentUser.uid}`;
  if (session?.email)   return `local:${(session.email||'').toLowerCase()}`;
  return 'anon';
}
function kscope(k){ return `${tenantKey()}::${k}`; }
function _gload(k, f){ return safeJSON(localStorage.getItem(kscope(k)), f); }
function _gsave(k, v){ try{ localStorage.setItem(kscope(k), JSON.stringify(v)); }catch{} }

/* Save that also pushes to cloud (if on) */
function saveData(key, val){
  _gsave(key, val);
  try { if (cloud.isOn() && auth.currentUser) cloud.saveKV(key, val); } catch{}
}

/* ---------- Cloud Sync (per-tenant at /tenants/{uid}/kv/{key}) ---------- */
const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
const cloud = (function(){
  let liveRefs = [];
  const on      = ()=> safeJSON(localStorage.getItem('global::_cloudOn'), false);
  const setOn   = v => localStorage.setItem('global::_cloudOn', JSON.stringify(!!v));
  const uid     = ()=> auth.currentUser?.uid;
  const pathFor = key => db.ref(`tenants/${uid()}/kv/${key}`);
  async function saveKV(key, val){ if (!on() || !uid()) return; await pathFor(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP }); }
  async function pullAllOnce(){
    if (!uid()) return;
    const snap = await db.ref(`tenants/${uid()}/kv`).get();
    if (!snap.exists()) return;
    const all = snap.val() || {};
    Object.values(all).forEach(row=>{
      if (row && row.key && 'val' in row) _gsave(row.key, row.val); // into tenant space
    });
    applyTheme();
  }
  function subscribeAll(){
    if (!uid()) return; unsubscribeAll();
    CLOUD_KEYS.forEach(key=>{
      const ref = pathFor(key);
      const handler = ref.on('value',(snap)=>{
        const data=snap.val(); if(!data)return;
        const curr=_gload(key,null);
        if (JSON.stringify(curr)!==JSON.stringify(data.val)){
          _gsave(key,data.val);
          if (key==='_theme2') applyTheme();
          renderApp();
        }
      });
      liveRefs.push({ref,handler});
    });
  }
  function unsubscribeAll(){ liveRefs.forEach(({ref})=>{ try{ref.off();}catch{} }); liveRefs=[]; }
  async function pushAll(){ if (!uid()) return; for (const k of CLOUD_KEYS){ const v=_gload(k,null); if (v!==null && v!==undefined) await saveKV(k,v); } }
  async function enable(){ if (!uid()) throw new Error('Sign in first.'); setOn(true); await firebase.database().goOnline(); await pullAllOnce(); await pushAll(); subscribeAll(); }
  function disable(){ setOn(false); unsubscribeAll(); }
  return { isOn:on, enable, disable, saveKV, pullAllOnce, subscribeAll, pushAll };
})();

/* ---------- One-time per-user demo seed (no limits) ---------- */
function seedDemoForUserOnce(){
  const flag = _gload('_seeded_v4', false);
  if (flag) return;
  // Seed a few items; truly no hard-cap exists anywhere in code.
  const now = Date.now();
  _gsave('users', _gload('users', [
    { name:'Admin',     username:'admin',     email:'admin@sushi.com',     contact:'', role:'admin',     password:'', img:'' },
    { name:'Manager',   username:'manager',   email:'manager@sushi.com',   contact:'', role:'manager',   password:'', img:'' },
    { name:'Associate', username:'associate', email:'associate@sushi.com', contact:'', role:'associate', password:'', img:'' },
    { name:'Viewer',    username:'viewer',    email:'cashier@sushi.com',   contact:'', role:'user',      password:'', img:'' }
  ]));
  _gsave('inventory', _gload('inventory', [
    { id:'inv1', img:'', name:'Nori Sheets', code:'NOR-100', type:'Dry', price:3.00, stock:80, threshold:30 },
    { id:'inv2', img:'', name:'Sushi Rice',  code:'RIC-200', type:'Dry', price:1.50, stock:24, threshold:20 },
  ]));
  _gsave('products', _gload('products', [
    { id:'p1', img:'', name:'Salmon Nigiri', barcode:'11100001', price:5.99, type:'Nigiri', ingredients:'Rice, Salmon', instructions:'Brush with nikiri.' }
  ]));
  _gsave('posts', _gload('posts', [{ id:'post1', title:'Welcome to Inventory', body:'Track stock, manage products, and work faster.', img:'', createdAt: now }]));
  _gsave('tasks', _gload('tasks', [
    { id:'t1', title:'Prep Salmon', status:'todo' },
    { id:'t2', title:'Cook Rice', status:'inprogress' }
  ]));
  _gsave('cogs', _gload('cogs', [
    { id:'c1', date:'2024-08-01', grossIncome:1200, produceCost:280, itemCost:180, freight:45, delivery:30, other:20 }
  ]));
  _gsave('_theme2', _gload('_theme2', { mode:'aqua', size:'medium' }));
  _gsave('_seeded_v4', true);
}

/* ---------- Auth state ---------- */
const ALLOW_LOCAL_AUTOLOGIN = true;
applyTheme();

auth.onAuthStateChanged(async (user) => {
  try { await ensureSessionAndRender(user); } catch (e){ console.error(e); notify('Render failed','danger'); showRescue(e); }
});

async function ensureSessionAndRender(user){
  // local fallback auto-login (demo admin)
  const stored = safeJSON(localStorage.getItem('session'), null);
  if (!user && stored && stored.authMode === 'local' && ALLOW_LOCAL_AUTOLOGIN){
    session = stored; currentRoute = localStorage.getItem('_route') || 'home';
    applyTheme(); seedDemoForUserOnce(); renderApp(); setupSessionPrompt(); return;
  }

  if (!user){
    session = null; localStorage.removeItem('session'); renderLogin(); return;
  }

  const email = (user.email||'').toLowerCase();
  const allUsers = _gload('users', []);
  let prof = allUsers.find(u => (u.email||'').toLowerCase() === email);

  if (!prof){
    const roleGuess = SUPER_ADMINS.includes(email) ? 'admin' : 'user';
    prof = { name:user.displayName||email.split('@')[0], username:email.split('@')[0], email, role:roleGuess, img:'', contact:'', password:'' };
    allUsers.push(prof); _gsave('users', allUsers);
  } else if (SUPER_ADMINS.includes(email) && prof.role!=='admin'){
    prof.role='admin'; _gsave('users', allUsers);
  }

  session = { ...prof, authMode:'firebase' };
  localStorage.setItem('session', JSON.stringify(session));

  seedDemoForUserOnce();           // per-user
  if (cloud.isOn()){ try{ await firebase.database().goOnline(); }catch{} try{ await cloud.pullAllOnce(); }catch{} try{ cloud.subscribeAll(); }catch{} }

  currentRoute = localStorage.getItem('_route') || 'home';
  renderApp(); setupSessionPrompt();
}

/* ---------- Login screen ---------- */
function renderLogin(){
  const root = document.getElementById('root');
  root.innerHTML = `
  <div class="login">
    <div class="card login-card">
      <div class="card-body">
        <div class="login-logo">
          <div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div>
        </div>
        <p class="login-note">Sign in to continue</p>
        <div class="grid">
          <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username" />
          <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password" />
          <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          <div style="display:flex;justify-content:space-between;gap:8px">
            <a id="link-forgot"   href="#" class="btn ghost"   style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</a>
            <a id="link-register" href="#" class="btn secondary" style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Create account</a>
          </div>
          <div class="login-note">Tip: demo admin: <strong>${DEMO_ADMIN_EMAIL}</strong> / <strong>${DEMO_ADMIN_PASS}</strong></div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-auth"></div>
  <div class="modal" id="m-signup">
    <div class="dialog">
      <div class="head"><strong>Create account</strong><button class="btn ghost" id="cl-signup">Close</button></div>
      <div class="body grid">
        <input id="su-name"  class="input" placeholder="Full name" />
        <input id="su-email" class="input" type="email" placeholder="Email" />
        <input id="su-pass"  class="input" type="password" placeholder="Password" />
        <input id="su-pass2" class="input" type="password" placeholder="Confirm password" />
      </div>
      <div class="foot"><button class="btn" id="btnSignupDo"><i class="ri-user-add-line"></i> Sign up</button></div>
    </div>
  </div>

  <div class="modal" id="m-reset">
    <div class="dialog">
      <div class="head"><strong>Reset password</strong><button class="btn ghost" id="cl-reset">Close</button></div>
      <div class="body grid"><input id="fp-email" class="input" type="email" placeholder="Your email" /></div>
      <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset / Local reset</button></div>
    </div>
  </div>`;

  const openModal  = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
  const closeModal = ()  => { $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

  // sign in
  const doSignIn = async ()=>{
    const email = ($('#li-email')?.value||'').trim().toLowerCase();
    const pass  = $('#li-pass')?.value||'';
    if (!email || !pass) return notify('Enter email & password','warn');

    // local demo admin
    if (email===DEMO_ADMIN_EMAIL && pass===DEMO_ADMIN_PASS){
      // ensure local profile exists in THIS tenant’s users list
      let users = _gload('users', []);
      let u = users.find(x=> (x.email||'').toLowerCase()===DEMO_ADMIN_EMAIL);
      if (!u){ u={ name:'Admin', username:'admin', email:DEMO_ADMIN_EMAIL, role:'admin', img:'', contact:'', password:'' }; users.push(u); _gsave('users', users); }
      session = { ...u, authMode:'local' }; localStorage.setItem('session', JSON.stringify(session));
      seedDemoForUserOnce(); applyTheme(); renderApp(); setupSessionPrompt(); notify('Welcome, Admin (local mode)');
      return;
    }

    try{
      if (!navigator.onLine) throw new Error('Offline');
      await auth.signInWithEmailAndPassword(email, pass);
      notify('Welcome!');
      setTimeout(()=>{ if (!document.querySelector('.app')) ensureSessionAndRender(auth.currentUser); }, 600);
    }catch(e){
      // try local user list
      const users = _gload('users', []);
      const u = users.find(x=> (x.email||'').toLowerCase()===email && (x.password||'')===pass);
      if (u){ session={...u,authMode:'local'}; localStorage.setItem('session', JSON.stringify(session)); seedDemoForUserOnce(); applyTheme(); renderApp(); setupSessionPrompt(); notify('Signed in (Local mode)'); return; }
      const map = {
        'auth/invalid-email':'Invalid email.',
        'auth/user-not-found':'No account found.',
        'auth/wrong-password':'Incorrect password.',
        'auth/network-request-failed':'Network error.'
      };
      notify(map[e?.code]||'Login failed','danger');
    }
  };

  const doSignup = async ()=>{
    const name = ($('#su-name')?.value||'').trim();
    const email= ($('#su-email')?.value||'').trim().toLowerCase();
    const pass = $('#su-pass')?.value||'';
    const pass2= $('#su-pass2')?.value||'';
    if (!email || !pass) return notify('Email & password required','warn');
    if (pass!==pass2) return notify('Passwords do not match','warn');
    try{
      if (!navigator.onLine) throw new Error('Offline');
      await auth.createUserWithEmailAndPassword(email, pass);
      try{ await auth.currentUser.updateProfile({ displayName: name||email.split('@')[0] }); }catch{}
      notify('Account created'); $('#mb-auth').classList.remove('active'); $('#m-signup').classList.remove('active');
    }catch(e){
      // local signup
      let users=_gload('users',[]);
      if (users.find(x=> (x.email||'').toLowerCase()===email)){ notify('User exists. Use Sign In.','warn'); return; }
      const role = SUPER_ADMINS.includes(email) ? 'admin' : 'user';
      const u={ name:name||email.split('@')[0], username:email.split('@')[0], email, role, img:'', contact:'', password:pass };
      users.push(u); _gsave('users', users);
      session={...u, authMode:'local'}; localStorage.setItem('session', JSON.stringify(session));
      seedDemoForUserOnce(); applyTheme(); renderApp(); setupSessionPrompt(); notify('Account created (Local mode)');
    }
  };

  const doReset = async ()=>{
    const email = ($('#fp-email')?.value||'').trim().toLowerCase();
    if (!email) return notify('Enter your email','warn');
    try{ if (!navigator.onLine) throw new Error('Offline'); await auth.sendPasswordResetEmail(email); notify('Reset email sent'); }
    catch(e){
      // local temp password
      const users=_gload('users',[]); const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
      if (i<0) return notify('No local user found','warn');
      const temp='reset'+Math.floor(1000+Math.random()*9000); users[i].password=temp; _gsave('users', users);
      notify('Local reset: temp password = '+temp);
    }
  };

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doSignIn(); });
  $('#link-register')?.addEventListener('click', e=>{ e.preventDefault(); $('#mb-auth').classList.add('active'); $('#m-signup').classList.add('active'); });
  $('#cl-signup')?.addEventListener('click', e=>{ e.preventDefault(); $('#mb-auth').classList.remove('active'); $('#m-signup').classList.remove('active'); });
  $('#link-forgot')?.addEventListener('click', e=>{ e.preventDefault(); $('#mb-auth').classList.add('active'); $('#m-reset').classList.add('active'); });
  $('#cl-reset')?.addEventListener('click', e=>{ e.preventDefault(); $('#mb-auth').classList.remove('active'); $('#m-reset').classList.remove('active'); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

/* ---------- Shell / Navigation ---------- */
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
      <div class="brand"><div class="logo">📦</div><div class="title">Inventory</div></div>
      <div class="search-wrap">
        <input id="globalSearch" placeholder="Search everything…" autocomplete="off" />
        <div id="searchResults" class="search-results"></div>
      </div>
      <h6>Menu</h6>
      <nav class="nav">${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}</nav>
      <h6>Links</h6>
      <div class="links">${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}</div>
      <h6>Social</h6>
      <div class="socials-row">
        <a href="https://youtube.com" target="_blank" rel="noopener"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener"><i class="ri-instagram-line"></i></a>
        <a href="https://tiktok.com" target="_blank" rel="noopener"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com" target="_blank" rel="noopener"><i class="ri-twitter-x-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left">
        <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${(currentRoute||'home').slice(0,1).toUpperCase()+ (currentRoute||'home').slice(1)}</strong></div>
      </div>
      <div class="right">
        <div class="socials-compact" style="display:flex;gap:8px;align-items:center">
          <a href="https://youtube.com" target="_blank" rel="noopener"><i class="ri-youtube-fill"></i></a>
          <a href="https://facebook.com" target="_blank" rel="noopener"><i class="ri-facebook-fill"></i></a>
          <a href="https://instagram.com" target="_blank" rel="noopener"><i class="ri-instagram-line"></i></a>
        </div>
        <button class="btn ghost" id="btnHome"><i class="ri-home-5-line"></i> Home</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}
document.addEventListener('click', (e)=>{
  const item = e.target.closest('.sidebar .item[data-route]');
  if (!item) return;
  const r = item.getAttribute('data-route'); if (r){ go(r); closeSidebar(); }
});
function openSidebar(){ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); }
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }

function go(route){ currentRoute = route; localStorage.setItem('_route', route); renderApp(); }
function safeView(route){
  switch(route){
    case 'home': return viewHome();
    case 'search': return viewSearch();
    case 'dashboard': return viewDashboard();
    case 'inventory': return viewInventory();
    case 'products': return viewProducts();
    case 'cogs': return viewCOGS();
    case 'tasks': return viewTasks();
    case 'settings': return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide':
      return viewPage(route);
    default: return viewHome();
  }
}
function wireRoute(route){
  $('#btnLogout')?.addEventListener('click', doLogout);
  $('#btnHome')?.addEventListener('click', ()=>go('home'));
  $('#burger')?.addEventListener('click', openSidebar);
  $('#backdrop')?.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-go]').forEach(el=> el.addEventListener('click', ()=>{ const r=el.getAttribute('data-go'); const id=el.getAttribute('data-id'); if(r){ go(r); if(id) setTimeout(()=>scrollToRow(id),80); } }));

  hookSidebarSearch();
  ensureGlobalModals();
  wireSessionModal();
  enableMobileImagePreview();

  if (route==='home')      wireHome();
  if (route==='dashboard'){ wireDashboard(); wirePosts(); }
  if (route==='inventory') wireInventory();
  if (route==='products')  wireProducts();
  if (route==='cogs')      wireCOGS();
  if (route==='tasks')     wireTasks();
  if (route==='settings')  wireSettings();
  if (route==='contact')   wireContact();
}
function renderApp(){
  if (!session){ renderLogin(); return; }
  const root = document.getElementById('root');
  const route = currentRoute || 'home';
  root.innerHTML = `<div class="app">${renderSidebar(route)}<div>${renderTopbar()}<div class="main" id="main">${safeView(route)}</div></div></div>`;
  wireRoute(route);
}

/* ---------- Search ---------- */
function hookSidebarSearch(){
  const input=$('#globalSearch'), results=$('#searchResults'); if (!input || !results) return;
  let t;
  const openPage=(q)=>{ window.searchQuery=q; localStorage.setItem('_searchQ', q); if (currentRoute!=='search') go('search'); else renderApp(); };
  input.addEventListener('keydown', e=>{ if (e.key==='Enter'){ const q=input.value.trim(); if(q){ openPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); } }});
  input.addEventListener('input', ()=>{
    clearTimeout(t);
    const q=input.value.trim().toLowerCase();
    if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    t=setTimeout(()=>{
      const out=searchAll(buildSearchIndex(), q).slice(0,12);
      if (!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span class="muted">— ${r.section||''}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id')||''; const label=row.textContent.trim(); openPage(label); results.classList.remove('active'); input.value=''; closeSidebar(); if(id) setTimeout(()=>scrollToRow(id),80); };
      });
    },120);
  });
  document.addEventListener('click', (e)=>{ if (!results.contains(e.target) && e.target!==input){ results.classList.remove('active'); }});
}
function viewSearch(){
  const q = (window.searchQuery||'').trim();
  const out = q ? searchAll(buildSearchIndex(), q) : [];
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Search</h3><div class="muted">Query: <strong>${q||'(empty)'}</strong></div>
    </div>
    ${out.length? `<div class="grid">${out.map(r=>`
      <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:700">${r.label}</div><div class="muted" style="font-size:12px">${r.section||''}</div></div>
        <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
      </div></div>`).join('')}</div>` : `<p class="muted">No results.</p>`}
  </div></div>`;
}
function buildSearchIndex(){
  const posts=_gload('posts',[]), inv=_gload('inventory',[]), prods=_gload('products',[]), cogs=_gload('cogs',[]), users=_gload('users',[]);
  const pages=[{id:'about',label:'About',section:'Pages',route:'about'},{id:'policy',label:'Policy',section:'Pages',route:'policy'},{id:'license',label:'License',section:'Pages',route:'license'},{id:'setup',label:'Setup Guide',section:'Pages',route:'setup'},{id:'contact',label:'Contact',section:'Pages',route:'contact'},{id:'guide',label:'User Guide',section:'Pages',route:'guide'},];
  const ix=[]; posts.forEach(p=>ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`})); 
  inv.forEach(i=>ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`})); 
  prods.forEach(p=>ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`})); 
  cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.delivery} ${r.other}`})); 
  users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p)); return ix;
}
function searchAll(index, q){
  const norm = s => (s||'').toLowerCase();
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  return index.map(item=>{
    const label = norm(item.label), text = norm(item.text||''); let hits=0;
    const ok = tokens.every(t=>{ const h = label.includes(t) || text.includes(t); if(h) hits++; return h; });
    const score = ok ? (hits*3 + (label.includes(tokens[0]||'')?2:0)) : 0;
    return {item,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
}
function scrollToRow(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

/* ---------- Home (Hot videos) ---------- */
(function initVideos(){
  const DEFAULT_LIB = [
    { title:'DEAF KEV – Invincible (NCS)', id:'J2X5mJ3HDYE' },
    { title:'Alan Walker – Spectre (NCS)', id:'AOeY-nDp7hI' },
    { title:'Janji – Heroes Tonight (NCS)', id:'3nQNiWdeH2Q' },
    { title:'Tobu – Candyland (NCS)', id:'IIrCDAV3EgI' },
    { title:'Itro & Tobu – Cloud 9', id:'VtKbiyyVZks' },
    { title:'Elektronomia – Sky High', id:'TW9d8vYrVFQ' },
    { title:'Syn Cole – Feel Good', id:'q1ULJ92aldE' },
    { title:'LAKEY – Better Days', id:'RXLzvo6kvVQ' },
  ];
  if (!window.HOT_VIDEOS_LIBRARY) window.HOT_VIDEOS_LIBRARY = DEFAULT_LIB.slice();
  window.buildWeeklySet = (size=10)=>{ const lib=window.HOT_VIDEOS_LIBRARY||[]; if(!lib.length) return []; const week=getISOWeek(new Date()); const start=week%lib.length; const out=[]; for(let i=0;i<size;i++) out.push(lib[(start+i)%lib.length]); return out; };
  window.HOT_VIDEOS = buildWeeklySet(10);
  window.pickWeeklyIndex = ()=>{ const n=Math.max(1,(window.HOT_VIDEOS||[]).length); return getISOWeek(new Date())%n; };
  function _load(){ return safeJSON(localStorage.getItem('_ytBlacklist'),{}); }
  function _save(m){ localStorage.setItem('_ytBlacklist', JSON.stringify(m)); }
  window.ytBlacklistAdd=(id)=>{ const m=_load(); m[id]=Date.now(); _save(m); };
  window.ytIsBlacklisted=(id)=>!!_load()[id];
  window.ytBlacklistClear=()=>_save({});
})();
function viewHome(){
  const idx=pickWeeklyIndex();
  return `<div class="card"><div class="card-body">
    <h3 style="margin:0 0 10px">Welcome 👋</h3>
    <div class="grid cols-4 auto" style="margin-bottom:12px">
      <div class="card tile" data-go="inventory"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-archive-2-line"></i><div>Inventory</div></div></div>
      <div class="card tile" data-go="products"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-store-2-line"></i><div>Products</div></div></div>
      <div class="card tile" data-go="cogs"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-money-dollar-circle-line"></i><div>COGS</div></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body" style="display:flex;gap:10px;align-items:center"><i class="ri-list-check-2"></i><div>Tasks</div></div></div>
    </div>
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h4 style="margin:0">Hot Music & Videos</h4>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" id="btnShuffleVideo"><i class="ri-shuffle-line"></i> Shuffle</button>
          <a class="btn secondary" id="btnOpenYouTube" href="#" target="_blank" rel="noopener"><i class="ri-youtube-fill"></i> Open on YouTube</a>
        </div>
      </div>
      <div id="videoWrap" data-vid-index="${idx}">
        <div id="ytHost" style="width:100%;aspect-ratio:16/9;border:1px solid var(--card-border);border-radius:12px;overflow:hidden"></div>
        <div id="mvTitle" style="margin-top:8px;font-weight:700"></div>
        <div class="muted" style="font-size:12px;margin-top:4px">Tip: on mobile, tap to start playback.</div>
      </div>
    </div></div></div></div>`;
}
function wireHome(){
  const wrap=$('#videoWrap'), title=$('#mvTitle'), openYT=$('#btnOpenYouTube'), hostId='ytHost';
  if (!wrap) return;
  function loadYT(){ return new Promise(res=>{ if (window.YT && YT.Player) return res(); const s=document.createElement('script'); s.src="https://www.youtube.com/iframe_api"; document.head.appendChild(s); window.onYouTubeIframeAPIReady=()=>res(); }); }
  function nextIndex(start){ const list=window.HOT_VIDEOS||[]; if(!list.length) return 0; for(let k=0;k<list.length;k++){ const i=(start+k)%list.length; if(!ytIsBlacklisted(list[i].id)) return i; } ytBlacklistClear(); return start%list.length; }
  let player=null;
  function setByIndex(idx){
    const list=window.HOT_VIDEOS||[]; if(!list.length) return;
    const i=nextIndex(idx); const {id,title:t}=list[i];
    wrap.setAttribute('data-vid-index', String(i));
    title.textContent=t||'Hot video'; openYT.href=`https://www.youtube.com/watch?v=${id}`;
    const opts={ host:'https://www.youtube-nocookie.com', videoId:id, playerVars:{ rel:0, modestbranding:1, playsinline:1, origin:location.origin }, events:{ onError:()=>{ ytBlacklistAdd(id); notify('Video not available. Skipping…','warn'); setByIndex(i+1); } } };
    if(!player) player=new YT.Player(hostId, opts); else player.loadVideoById(id);
  }
  loadYT().then(()=>{ const start=parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0; setByIndex(start); $('#btnShuffleVideo')?.addEventListener('click',()=>{ const list=window.HOT_VIDEOS||[]; if(!list.length) return; const curr=parseInt(wrap.getAttribute('data-vid-index')||'0',10)||0; let next=Math.floor(Math.random()*list.length); if(list.length>1 && next===curr) next=(next+1)%list.length; setByIndex(next); notify('Shuffled','ok'); }); });
}

/* ---------- Dashboard + Posts ---------- */
function viewDashboard(){
  const posts=_gload('posts',[]), inv=_gload('inventory',[]), prods=_gload('products',[]), users=_gload('users',[]), tasks=_gload('tasks',[]), cogs=_gload('cogs',[]);
  const lowCt  = inv.filter(i=> i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i=> i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  const sumForMonth=(y,m)=> cogs.filter(r=>{ const p=parseYMD(r.date); return p && p.y===y && p.m===m; }).reduce((s,r)=> s + (+r.grossIncome||0), 0);
  const today=new Date(), cy=today.getFullYear(), cm=today.getMonth()+1;
  const py=cm===1?cy-1:cy, pm=cm===1?12:cm-1, ly=cy-1, lm=cm;
  const totalThis=sumForMonth(cy,cm), totalPrev=sumForMonth(py,pm), totalLY=sumForMonth(ly,lm);
  const pct=(a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0?100:0)); const mom=pct(totalThis,totalPrev), yoy=pct(totalThis,totalLY);
  const c=(v)=> v>=0?'var(--ok)':'var(--danger)'; const fp=(v)=>`${v>=0?'+':''}${v.toFixed(1)}%`;

  return `
    <div class="grid cols-4 auto">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Total Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
    </div>

    <div class="grid cols-4 auto" style="margin-top:12px">
      <div class="card"><div class="card-body" style="border-left:4px solid var(--warn)"><strong>Low stock</strong><div class="muted">${lowCt}</div></div></div>
      <div class="card"><div class="card-body" style="border-left:4px solid var(--danger)"><strong>Critical</strong><div class="muted">${critCt}</div></div></div>
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Sales (Month-to-Date)</strong><button class="btn ghost" data-go="cogs"><i class="ri-line-chart-line"></i> Details</button>
        </div>
        <div style="margin-top:6px"><span class="muted">This month:</span> <strong>${USD(totalThis)}</strong></div>
        <div><span class="muted">Prev month:</span> ${USD(totalPrev)} <span style="color:${c(mom)}">${fp(mom)} MoM</span></div>
        <div><span class="muted">Same month last year:</span> ${USD(totalLY)} <span style="color:${c(yoy)}">${fp(yoy)} YoY</span></div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Posts</h3>${canAdd()?`<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
      </div>
      <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
        ${posts.map(p=>`
          <div class="card" id="${p.id}"><div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><strong>${p.title}</strong><div class="muted" style="font-size:12px">${new Date(p.createdAt).toLocaleString()}</div></div>
              <div>
                ${canEdit()?`<button class="btn ghost" data-edit="${p.id}"><i class="ri-edit-line"></i></button>`:''}
                ${canDelete()?`<button class="btn danger" data-del="${p.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
              </div>
            </div>
            ${p.img?`<img src="${p.img}" style="width:100%;border-radius:12px;margin-top:10px;border:1px solid var(--card-border)"/>`:''}
            <p style="margin-top:8px">${p.body}</p>
          </div></div>`).join('')}
      </div>
    </div></div>`;
}
function wireDashboard(){ $('#addPost')?.addEventListener('click', ()=> openModal('m-post')); }
function wirePosts(){
  const sec = document.querySelector('[data-section="posts"]'); if (!sec) return;

  const btn = $('#save-post');
  if (btn && !btn.__wired){
    btn.__wired = true;
    btn.addEventListener('click', ()=>{
      if (!canAdd()) return notify('No permission','warn');
      const posts=_gload('posts',[]);
      const id=$('#post-id').value || ('post_'+Date.now());
      const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), img:($('#post-img')?.value||'').trim(), createdAt: Date.now() };
      if (!obj.title) return notify('Title required','warn');
      const i=posts.findIndex(x=>x.id===id);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); posts[i]=obj; } else posts.unshift(obj);
      saveData('posts', posts); closeModal('m-post'); notify('Saved'); renderApp();
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const b=e.target.closest('button'); if(!b) return;
      const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
      if (b.hasAttribute('data-edit')){
        if (!canEdit()) return notify('No permission','warn');
        const p=_gload('posts',[]).find(x=>x.id===id); if(!p) return;
        openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body; $('#post-img').value=p.img||'';
      } else {
        if (!canDelete()) return notify('No permission','warn');
        saveData('posts', _gload('posts',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ---------- Inventory ---------- */
function attachImageUpload(fileSel, textSel){
  const f=$(fileSel), t=$(textSel); if(!f||!t) return;
  f.onchange=()=>{ const file=f.files && f.files[0]; if(!file) return; const r=new FileReader(); r.onload=()=>{ t.value=r.result; }; r.readAsDataURL(file); };
}
function viewInventory(){
  const items=_gload('inventory',[]);
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Inventory</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="inventory"><table class="table">
      <thead><tr><th>Image</th><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
      <tbody>${items.map(it=>{
        const warn = it.stock <= it.threshold ? (it.stock <= Math.max(1, Math.floor(it.threshold*0.6)) ? 'tr-danger' : 'tr-warn') : '';
        return `<tr id="${it.id}" class="${warn}">
          <td><div class="thumb-wrap">
            ${ it.img ? `<img class="thumb inv-preview" data-src="${it.img}" src="${it.img}" alt=""/>` : `<div class="thumb inv-preview" data-src="icons/icon-512.png" style="display:grid;place-items:center">📦</div>` }
            <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
          </div></td>
          <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td>
          <td>${USD(it.price)}</td>
          <td>${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button><span style="padding:0 10px">${it.stock}</span><button class="btn ghost" data-inc="${it.id}">+</button>` : `<span>${it.stock}</span>`}</td>
          <td>${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button><span style="padding:0 10px">${it.threshold}</span><button class="btn ghost" data-inc-th="${it.id}">+</button>` : `<span>${it.threshold}</span>`}</td>
          <td>
            ${canEdit()?`<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
            ${canDelete()?`<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
          </td>
        </tr>`;
      }).join('')}</tbody></table></div></div></div>`;
}
function wireInventory(){
  const sec=document.querySelector('[data-section="inventory"]'); if(!sec) return;

  $('#export-inventory')?.addEventListener('click', ()=>{
    const rows=_gload('inventory',[]); // exclude img col
    const headers=['id','name','code','type','price','stock','threshold'];
    const csvRows=[headers.join(',')];
    for(const r of rows){
      const vals=headers.map(h=>{ const s=(r[h]??'').toString().replace(/"/g,'""'); return /[",\n]/.test(s)?`"${s}"`:s; });
      csvRows.push(vals.join(','));
    }
    const blob=new Blob([csvRows.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='inventory.csv'; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV');
  });

  $('#addInv')?.addEventListener('click', ()=>{
    if (!canAdd()) return notify('No permission','warn');
    openModal('m-inv'); $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value=''; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value=''; $('#inv-img').value='';
    attachImageUpload('#inv-imgfile','#inv-img');
  });

  const saveBtn=$('#save-inv');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if (!canAdd()) return notify('No permission','warn');
      const items=_gload('inventory',[]);
      const id=$('#inv-id').value || ('inv_'+Date.now());
      const obj={ id,
        name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
        price: parseFloat($('#inv-price').value||'0'), stock: parseInt($('#inv-stock').value||'0'), threshold: parseInt($('#inv-threshold').value||'0'),
        img:($('#inv-img').value||'').trim()
      };
      if (!obj.name) return notify('Name required','warn');
      const i=items.findIndex(x=>x.id===id);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      saveData('inventory',items); closeModal('m-inv'); notify('Saved'); renderApp();
    });
  }

  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const items=_gload('inventory',[]);
      const get=id=>items.find(x=>x.id===id);

      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
        openModal('m-inv');
        $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
        $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold; $('#inv-img').value=it.img||'';
        attachImageUpload('#inv-imgfile','#inv-img');
        return;
      }
      if (btn.hasAttribute('data-del')){
        if(!canDelete()) return notify('No permission','warn');
        const id=btn.getAttribute('data-del'); saveData('inventory', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp(); return;
      }

      const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
      if(!id) return; if(!canAdd()) return notify('No permission','warn');
      const it=get(id); if(!it) return;
      if (btn.hasAttribute('data-inc')) it.stock++;
      if (btn.hasAttribute('data-dec')) it.stock=Math.max(0, it.stock-1);
      if (btn.hasAttribute('data-inc-th')) it.threshold++;
      if (btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0, it.threshold-1);
      saveData('inventory', items); renderApp();
    });
  }
}

/* ---------- Products ---------- */
function viewProducts(){
  const items=_gload('products',[]);
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Products</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="products"><table class="table">
      <thead><tr><th>Image</th><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th></tr></thead>
      <tbody>${items.map(it=>`
        <tr id="${it.id}">
          <td><div class="thumb-wrap">
            ${ it.img ? `<img class="thumb prod-thumb" data-card="${it.id}" src="${it.img}" alt=""/>` : `<div class="thumb prod-thumb" data-card="${it.id}" style="display:grid;place-items:center;cursor:pointer">🛒</div>` }
            <img class="thumb-large" src="${it.img||'icons/icon-512.png'}" alt=""/>
          </div></td>
          <td>${it.name}</td><td>${it.barcode||''}</td><td>${USD(it.price)}</td><td>${it.type||'-'}</td>
          <td>
            ${canEdit()?`<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
            ${canDelete()?`<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
          </td>
        </tr>`).join('')}</tbody></table></div></div></div>`;
}
function wireProducts(){
  const sec=document.querySelector('[data-section="products"]'); if(!sec) return;

  $('#export-products')?.addEventListener('click', ()=>{
    const rows=_gload('products',[]); const headers=['id','name','barcode','price','type','ingredients','instructions'];
    const csv=[headers.join(',')]; for(const r of rows){ const vals=headers.map(h=>{ const s=(r[h]??'').toString().replace(/"/g,'""'); return /[",\n]/.test(s)?`"${s}"`:s; }); csv.push(vals.join(',')); }
    const blob=new Blob([csv.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='products.csv'; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV');
  });

  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-prod'); $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value=''; $('#prod-img').value=''; attachImageUpload('#prod-imgfile','#prod-img');
  });

  const saveBtn=$('#save-prod');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=_gload('products',[]);
      const id=$('#prod-id').value || ('p_'+Date.now());
      const obj={ id,
        name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(), price: parseFloat($('#prod-price').value||'0'),
        type:$('#prod-type').value.trim(), ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim(), img:($('#prod-img').value||'').trim()
      };
      if (!obj.name) return notify('Name required','warn');
      const i=items.findIndex(x=>x.id===id);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      saveData('products', items); closeModal('m-prod'); notify('Saved'); renderApp();
    });
  }

  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const thumb=e.target.closest('.prod-thumb');
      if (thumb){
        const id=thumb.getAttribute('data-card'); const it=_gload('products',[]).find(x=>x.id===id); if(!it) return;
        $('#pc-name').textContent=it.name; $('#pc-img').src=it.img||'icons/icon-512.png'; $('#pc-barcode').textContent=it.barcode||'';
        $('#pc-price').textContent=USD(it.price); $('#pc-type').textContent=it.type||''; $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||'';
        openModal('m-card'); return;
      }
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const it=_gload('products',[]).find(x=>x.id===id); if(!it) return;
        openModal('m-prod'); $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
        $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
        $('#prod-instructions').value=it.instructions||''; $('#prod-img').value=it.img||''; attachImageUpload('#prod-imgfile','#prod-img');
      }else{
        if(!canDelete()) return notify('No permission','warn');
        saveData('products', _gload('products',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ---------- COGS ---------- */
function viewCOGS(){
  const rows=_gload('cogs',[]);
  const totals=rows.reduce((a,r)=>({grossIncome:a.grossIncome+(+r.grossIncome||0),produceCost:a.produceCost+(+r.produceCost||0),itemCost:a.itemCost+(+r.itemCost||0),freight:a.freight+(+r.freight||0),delivery:a.delivery+(+r.delivery||0),other:a.other+(+r.other||0)}),{grossIncome:0,produceCost:0,itemCost:0,freight:0,delivery:0,other:0});
  const profit=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  return `<div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">COGS</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
        ${canAdd()?`<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
      </div>
    </div>
    <div class="table-wrap" data-section="cogs"><table class="table">
      <thead><tr><th>Date</th><th>Gross Income</th><th>Produce Cost</th><th>Item Cost</th><th>Freight</th><th>Delivery</th><th>Other</th><th>Gross Profit</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr id="${r.id}">
          <td>${r.date}</td><td>${USD(r.grossIncome)}</td><td>${USD(r.produceCost)}</td><td>${USD(r.itemCost)}</td>
          <td>${USD(r.freight)}</td><td>${USD(r.delivery)}</td><td>${USD(r.other)}</td><td>${USD(profit(r))}</td>
          <td>${canEdit()?`<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''}${canDelete()?` <button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
        </tr>`).join('')}
        <tr class="tr-total">
          <th>Total</th><th>${USD(totals.grossIncome)}</th><th>${USD(totals.produceCost)}</th><th>${USD(totals.itemCost)}</th>
          <th>${USD(totals.freight)}</th><th>${USD(totals.delivery)}</th><th>${USD(totals.other)}</th><th>${USD(profit(totals))}</th><th></th>
        </tr>
      </tbody></table></div></div></div>`;
}
function wireCOGS(){
  const sec=document.querySelector('[data-section="cogs"]'); if(!sec) return;
  $('#export-cogs')?.addEventListener('click', ()=>{
    const rows=_gload('cogs',[]); const headers=['id','date','grossIncome','produceCost','itemCost','freight','delivery','other'];
    const csv=[headers.join(',')]; for(const r of rows){ const vals=headers.map(h=>{ const s=(r[h]??'').toString().replace(/"/g,'""'); return /[",\n]/.test(s)?`"${s}"`:s; }); csv.push(vals.join(',')); }
    const blob=new Blob([csv.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='cogs.csv'; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV');
  });
  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-cogs'); $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value=''; $('#cogs-freight').value=''; $('#cogs-delivery').value=''; $('#cogs-other').value='';
  });
  const saveBtn=$('#save-cogs');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const rows=_gload('cogs',[]); const id=$('#cogs-id').value || ('c_'+Date.now());
      const row={ id, date:$('#cogs-date').value||new Date().toISOString().slice(0,10),
        grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0), itemCost:+($('#cogs-itemCost').value||0),
        freight:+($('#cogs-freight').value||0), delivery:+($('#cogs-delivery').value||0), other:+($('#cogs-other').value||0) };
      const i=rows.findIndex(x=>x.id===id);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); rows[i]=row; } else rows.push(row);
      saveData('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp();
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return; const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const r=_gload('cogs',[]).find(x=>x.id===id); if(!r) return;
        openModal('m-cogs'); $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome; $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-delivery').value=r.delivery; $('#cogs-other').value=r.other;
      } else {
        if(!canDelete()) return notify('No permission','warn');
        saveData('cogs', _gload('cogs',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }
}

/* ---------- Tasks (DnD even into empty lanes) ---------- */
function viewTasks(){
  const items=_gload('tasks',[]);
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo'&&canAdd()?`<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="grid lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>${t.title}</div>
                <div>${canEdit()?`<button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>`:''}${canDelete()?` <button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  return `<div data-section="tasks">${lane('todo','To do','#f59e0b')}${lane('inprogress','In progress','#3b82f6')}${lane('done','Done','#10b981')}</div>`;
}
function wireTasks(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;

  $('#addTask')?.addEventListener('click', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo'; });

  const saveBtn=$('#save-task');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=_gload('tasks',[]); const id=$('#task-id').value||('t_'+Date.now());
      const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value||'todo' };
      if (!obj.title) return notify('Title required','warn');
      const i=items.findIndex(x=>x.id===id);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      saveData('tasks', items); closeModal('m-task'); notify('Saved'); renderApp();
    });
  }

  if (!root.__wired){
    root.__wired=true;
    root.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      const items=_gload('tasks',[]);
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const t=items.find(x=>x.id===id); if(!t) return; openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
      } else {
        if(!canDelete()) return notify('No permission','warn');
        saveData('tasks', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
      }
    });
  }

  setupDnD();
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click',(e)=>{
        if(e.target.closest('button')) return;
        if(!canAdd()) return notify('No permission','warn');
        const id=card.getAttribute('data-task'); const items=_gload('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return;
        t.status = t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        saveData('tasks', items); renderApp();
      });
    });
  }
}
function setupDnD(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;
  root.querySelectorAll('.task-card').forEach(card=>{
    card.setAttribute('draggable','true');
    card.addEventListener('dragstart',(e)=>{ const id=card.getAttribute('data-task'); if(!id) return; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', id); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  root.querySelectorAll('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=(e)=>{ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch{} row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    grid.addEventListener('dragenter',show); grid.addEventListener('dragover',show); grid.addEventListener('dragleave',hide);
    grid.addEventListener('drop',(e)=>{ e.preventDefault(); hide(); if(!lane) return; if(!canAdd()) return notify('No permission','warn');
      const id=e.dataTransfer.getData('text/plain'); if(!id) return; const items=_gload('tasks',[]); const t=items.find(x=>x.id===id); if(!t) return; t.status=lane; saveData('tasks',items); renderApp(); });
  });
}

/* ---------- Settings + Users ---------- */
function viewSettings(){
  const users=_gload('users',[]); const theme=_gload('_theme2',{mode:'aqua',size:'medium'}); const cloudOn=cloud.isOn();
  return `<div class="grid">
    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Cloud Sync</h3><p class="muted">Keep your data in Firebase Realtime Database.</p>
      <div class="theme-inline">
        <div><label class="muted" style="font-size:12px">Status</label>
          <select id="cloud-toggle" class="input"><option value="off"${!cloudOn?' selected':''}>Off</option><option value="on"${cloudOn?' selected':''}>On</option></select>
        </div>
        <div><label class="muted" style="font-size:12px">Actions</label><br/><button class="btn" id="cloud-sync-now"><i class="ri-cloud-line"></i> Sync Now</button></div>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">Cloud Sync requires Firebase login. Data is always per-user.</p>
    </div></div>

    <div class="card"><div class="card-body">
      <h3 style="margin-top:0">Theme</h3>
      <div class="theme-inline">
        <div><label class="muted" style="font-size:12px">Mode</label>
          <select id="theme-mode" class="input">${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}</select>
        </div>
        <div><label class="muted" style="font-size:12px">Font Size</label>
          <select id="theme-size" class="input">${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}</select>
        </div>
      </div>
    </div></div>

    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Users</h3>${canAdd()?`<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
      </div>
      <table class="table" data-section="users">
        <thead><tr><th>Avatar</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>${users.map(u=>`
          <tr id="${u.email}">
            <td><div class="thumb-wrap">
              ${u.img?`<img class="thumb" alt="" src="${u.img}"/>`:`<div class="thumb" style="display:grid;place-items:center">👤</div>`}
              <img class="thumb-large" src="${u.img||'icons/icon-512.png'}" alt=""/>
            </div></td>
            <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
            <td>${canEdit()?`<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''}${canDelete()?` <button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div></div>
  </div>`;
}
function allowedRoleOptions(){
  const r=role(); if (r==='admin') return ROLES;
  if (r==='manager') return ['user','associate','manager'];
  if (r==='associate') return ['user','associate'];
  return ['user'];
}
function wireSettings(){
  // theme
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=()=>{ _gsave('_theme2',{mode:mode.value,size:size.value}); applyTheme(); renderApp(); };
  mode?.addEventListener('change',applyNow); size?.addEventListener('change',applyNow);

  // cloud
  $('#cloud-toggle')?.addEventListener('change', async (e)=>{
    const val=e.target.value;
    try{
      if (val==='on'){
        if (!auth.currentUser){ notify('Sign in with Firebase first.','warn'); e.target.value='off'; return; }
        await firebase.database().goOnline(); await cloud.enable(); notify('Cloud Sync ON');
      } else { cloud.disable(); await firebase.database().goOffline(); notify('Cloud Sync OFF'); }
    }catch(err){ notify(err?.message||'Could not change sync','danger'); e.target.value=cloud.isOn()?'on':'off'; }
  });
  $('#cloud-sync-now')?.addEventListener('click', async ()=>{
    try{
      if (!auth.currentUser) return notify('Sign in to use Cloud Sync.','warn');
      if (!cloud.isOn())     return notify('Turn Cloud Sync ON first.','warn');
      if (!navigator.onLine) return notify('Offline','warn');
      await firebase.database().goOnline(); await cloud.pushAll(); notify('Synced');
    }catch(e){ notify('Sync failed','danger'); }
  });

  // users
  wireUsers();
}
function wireUsers(){
  $('#addUser')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-img').value='';
    const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts[0];
    attachImageUpload('#user-imgfile','#user-img');
  });

  const saveBtn=$('#save-user');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const users=_gload('users',[]);
      const email=($('#user-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Email required','warn');
      const allowed=allowedRoleOptions(); const chosen=($('#user-role')?.value||'user'); if(!allowed.includes(chosen)) return notify('Role not allowed','warn');
      const obj={
        name:($('#user-name')?.value || email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(),
        role: chosen, img:($('#user-img')?.value||'').trim(), contact:'', password:''
      };
      const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
      if (i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);   // ✅ NO LIMIT
      saveData('users', users); closeModal('m-user'); notify('Saved'); renderApp();
    });
  }

  document.querySelector('[data-section="users"]')?.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const u=_gload('users',[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-img').value=u.img||'';
      const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts.includes(u.role)?u.role:'user';
      attachImageUpload('#user-imgfile','#user-img');
    } else {
      if(!canDelete()) return notify('No permission','warn');
      saveData('users', _gload('users',[]).filter(x=>x.email!==email)); notify('Deleted'); renderApp();
    }
  });
}

/* ---------- Static pages (iframes) + Contact ---------- */
window.pageContent = {
  about:  `<h3>About Inventory</h3><p class="muted">Fast, offline-friendly inventory, products, COGS and tasks for small & medium businesses. Role-based access, CSV export, drag-and-drop tasks, per-user data, and optional cloud sync.</p><div class="pageframe"><iframe src="about.html"></iframe></div>`,
  policy: `<h3>Policy</h3><div class="pageframe"><iframe src="policy.html"></iframe></div>`,
  license:`<h3>License</h3><div class="pageframe"><iframe src="license.html"></iframe></div>`,
  setup:  `<h3>Setup Guide</h3><div class="pageframe"><iframe src="setup-guide.html"></iframe></div>`,
  guide:  `<h3>User Guide</h3><div class="pageframe"><iframe src="guide.html"></iframe></div>`,
  contact:`<h3>Contact</h3><div class="pageframe"><iframe src="contact.html"></iframe></div>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${window.pageContent[key]||'<p>Page</p>'}</div></div>`; }
function wireContact(){ /* EmailJS handled inside contact.html */ }

/* ---------- Modals ---------- */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }
function enableMobileImagePreview(){ const phone=matchMedia('(max-width:740px)').matches; if(!phone) return; $$('.inv-preview,.prod-thumb').forEach(el=>{ el.style.cursor='pointer'; el.addEventListener('click',()=>{ const src=el.getAttribute('data-src')||el.getAttribute('src')||'icons/icon-512.png'; const img=$('#preview-img'); if(img) img.src=src; openModal('m-img'); }); }); }

function postModal(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post"><div class="dialog">
    <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
    <div class="body grid"><input id="post-id" type="hidden" /><input id="post-title" class="input" placeholder="Title"/><textarea id="post-body" class="input" placeholder="Body"></textarea><input id="post-img" class="input" placeholder="Image URL or upload below"/><input id="post-imgfile" type="file" accept="image/*" class="input"/></div>
    <div class="foot"><button class="btn" id="save-post">Save</button></div>
  </div></div>`; }
function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv"><div class="dialog">
    <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
    <div class="body grid">
      <input id="inv-id" type="hidden" /><input id="inv-name" class="input" placeholder="Name"/><input id="inv-code" class="input" placeholder="Code"/>
      <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
      <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/><input id="inv-stock" class="input" type="number" placeholder="Stock"/>
      <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/><input id="inv-img" class="input" placeholder="Image URL or upload below"/><input id="inv-imgfile" type="file" accept="image/*" class="input"/>
    </div><div class="foot"><button class="btn" id="save-inv">Save</button></div>
  </div></div>`; }
function prodModal(){ return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod"><div class="dialog">
    <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
    <div class="body grid">
      <input id="prod-id" type="hidden" /><input id="prod-name" class="input" placeholder="Name"/><input id="prod-barcode" class="input" placeholder="Barcode"/>
      <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/><input id="prod-type" class="input" placeholder="Type"/>
      <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea><textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
      <input id="prod-img" class="input" placeholder="Image URL or upload below"/><input id="prod-imgfile" type="file" accept="image/*" class="input"/>
    </div><div class="foot"><button class="btn" id="save-prod">Save</button></div>
  </div></div>`; }
function prodCardModal(){ return `
  <div class="modal-backdrop" id="mb-card"></div>
  <div class="modal" id="m-card"><div class="dialog">
    <div class="head"><strong id="pc-name">Product</strong><button class="btn ghost" data-close="m-card">Close</button></div>
    <div class="body grid cols-2">
      <div><img id="pc-img" style="width:100%;border-radius:12px;border:1px solid var(--card-border)"/></div>
      <div class="grid"><div><strong>Barcode:</strong> <span id="pc-barcode"></span></div><div><strong>Price:</strong> <span id="pc-price"></span></div><div><strong>Type:</strong> <span id="pc-type"></span></div><div><strong>Ingredients:</strong><div id="pc-ingredients"></div></div><div><strong>Instructions:</strong><div id="pc-instructions"></div></div></div>
    </div>
  </div></div>`; }
function cogsModal(){ return `
  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs"><div class="dialog">
    <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs">Close</button></div>
    <div class="body grid cols-2">
      <input id="cogs-id" type="hidden" /><input id="cogs-date" class="input" type="date"/>
      <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income"/>
      <input id="cogs-produceCost" class="input" type="number" step="0.01" placeholder="Produce Cost"/>
      <input id="cogs-itemCost" class="input" type="number" step="0.01" placeholder="Item Cost"/>
      <input id="cogs-freight" class="input" type="number" step="0.01" placeholder="Freight"/>
      <input id="cogs-delivery" class="input" type="number" step="0.01" placeholder="Delivery"/>
      <input id="cogs-other" class="input" type="number" step="0.01" placeholder="Other"/>
    </div><div class="foot"><button class="btn" id="save-cogs">Save</button></div>
  </div></div>`; }
function taskModal(){ return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task"><div class="dialog">
    <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
    <div class="body grid"><input id="task-id" type="hidden" /><input id="task-title" class="input" placeholder="Title"/><select id="task-status"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select></div>
    <div class="foot"><button class="btn" id="save-task">Save</button></div>
  </div></div>`; }
function userModal(){ return `
  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user"><div class="dialog">
    <div class="head"><strong>User</strong><button class="btn ghost" data-close="m-user">Close</button></div>
    <div class="body grid"><input id="user-name" class="input" placeholder="Name"/><input id="user-email" class="input" type="email" placeholder="Email"/><input id="user-username" class="input" placeholder="Username"/><select id="user-role"></select><input id="user-img" class="input" placeholder="Image URL or upload below"/><input id="user-imgfile" type="file" accept="image/*" class="input"/></div>
    <div class="foot"><button class="btn" id="save-user">Save</button></div>
  </div></div>`; }
function imgPreviewModal(){ return `
  <div class="modal-backdrop" id="mb-img"></div>
  <div class="modal img-modal" id="m-img"><div class="dialog">
    <div class="head"><strong>Preview</strong><button class="btn ghost" data-close="m-img">Close</button></div>
    <div class="body"><div class="imgbox"><img id="preview-img" src="" alt="Preview"/></div></div>
  </div></div>`; }

function ensureGlobalModals(){
  if ($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals';
  wrap.innerHTML = postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal()+imgPreviewModal()+sessionPromptModal();
  document.body.appendChild(wrap);
  attachImageUpload('#post-imgfile','#post-img');
}

/* ---------- Idle session prompt (20min) then 60s auto-logout ---------- */
const SESSION_PROMPT_ENABLED = true, PROMPT_AFTER_MIN=20, PROMPT_GRACE_SEC=60;
const PROMPT_AFTER_MS = PROMPT_AFTER_MIN*60*1000, PROMPT_GRACE_MS = PROMPT_GRACE_SEC*1000;
let __lastActivity=Date.now(), __sessionPromptInterval=null, __sessionPromptOpen=false, __sessionPromptWired=false;
let __sessionPromptDeadline=0, __sessionPromptTicker=null, __sessionPromptHardTimeout=null;
function sessionPromptModal(){ return `
  <div class="modal-backdrop" id="mb-session"></div>
  <div class="modal" id="m-session"><div class="dialog">
    <div class="head"><strong id="session-title">Stay signed in?</strong><button class="btn ghost" id="session-close" data-close="m-session">Close</button></div>
    <div class="body"><p class="muted" style="margin:0">You’ve been inactive for a while. Would you like to stay signed in?</p><div id="session-countdown" class="muted" style="margin-top:8px;font-size:12px"></div></div>
    <div class="foot"><button class="btn secondary" id="session-stay"><i class="ri-shield-check-line"></i> Stay signed in</button><button class="btn danger" id="session-logout"><i class="ri-logout-box-r-line"></i> Logout</button></div>
  </div></div>`; }
function __updateCountdown(){ const el=$('#session-countdown'); if(!el||!__sessionPromptDeadline) return; const remain=Math.max(0, Math.ceil((__sessionPromptDeadline-Date.now())/1000)); el.textContent=`Will log out in ${remain}s if no response…`; }
function __cancelSessionPromptTimers(){ if(__sessionPromptTicker){clearInterval(__sessionPromptTicker);__sessionPromptTicker=null;} if(__sessionPromptHardTimeout){clearTimeout(__sessionPromptHardTimeout);__sessionPromptHardTimeout=null;} __sessionPromptDeadline=0; }
function __keepSession(){ __cancelSessionPromptTimers(); __sessionPromptOpen=false; try{ closeModal('m-session'); }catch{} __markActivity(); notify('Continuing your session','ok'); }
function __openSessionPrompt(){ if(__sessionPromptOpen) return; openModal('m-session'); __sessionPromptOpen=true; __sessionPromptDeadline=Date.now()+PROMPT_GRACE_MS; __updateCountdown(); __sessionPromptTicker=setInterval(__updateCountdown,1000);
  __sessionPromptHardTimeout=setTimeout(()=>{ __sessionPromptOpen=false; __cancelSessionPromptTimers(); doLogout(); }, PROMPT_GRACE_MS); }
function __markActivity(){ __lastActivity=Date.now(); if(__sessionPromptOpen) __keepSession(); }
function setupSessionPrompt(){
  if (!SESSION_PROMPT_ENABLED) return;
  if (!window.__activityListenersAdded){
    ['click','keydown','mousemove','scroll','touchstart'].forEach(evt=>document.addEventListener(evt,__markActivity,{passive:true}));
    window.__activityListenersAdded=true;
  }
  if (__sessionPromptInterval) clearInterval(__sessionPromptInterval);
  __sessionPromptInterval=setInterval(()=>{ if(!session) return; const idleFor=Date.now()-__lastActivity; if(idleFor>=PROMPT_AFTER_MS && !__sessionPromptOpen) __openSessionPrompt(); }, 30000);
}
function wireSessionModal(){
  if (__sessionPromptWired) return;
  $('#session-stay')?.addEventListener('click', __keepSession);
  $('#session-close')?.addEventListener('click', __keepSession);
  $('#session-logout')?.addEventListener('click', ()=>{ __cancelSessionPromptTimers(); __sessionPromptOpen=false; doLogout(); });
  __sessionPromptWired=true;
}

/* ---------- Logout ---------- */
async function doLogout(){
  try{ cloud.disable(); }catch{}
  try{ await auth.signOut(); }catch{}
  session=null; localStorage.removeItem('session');
  currentRoute='home'; localStorage.setItem('_route','home');
  if (__sessionPromptInterval){ clearInterval(__sessionPromptInterval); __sessionPromptInterval=null; }
  __cancelSessionPromptTimers();
  notify('Signed out'); renderLogin();
}

/* ---------- Rescue screen (if something crashes) ---------- */
function showRescue(err){
  const root=$('#root'); if(!root) return;
  const msg=String((err && (err.stack||err.message)) || 'Unknown error');
  root.innerHTML=`<div style="max-width:680px;margin:40px auto;padding:16px;border:1px solid #ddd;border-radius:12px">
    <h2 style="margin:0 0 8px">Something crashed</h2><p class="muted" style="margin:0 0 12px">You can recover or sign out below.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button id="rz-signout" class="btn">Sign out</button>
      <button id="rz-clearls" class="btn ghost">Clear LocalStorage</button>
      <button id="rz-retry" class="btn secondary">Retry render</button>
    </div><pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px">${msg}</pre></div>`;
  $('#rz-signout')?.addEventListener('click', async ()=>{ try{ await auth.signOut(); }catch{} location.reload(); });
  $('#rz-clearls')?.addEventListener('click', ()=>{ try{ localStorage.clear(); }catch{} location.reload(); });
  $('#rz-retry')?.addEventListener('click', ()=>{ try{ renderApp(); }catch(e){ console.error(e); notify('Retry failed','danger'); } });
}

/* ---------- SW registration (GET-safe) ---------- */
(function(){
  if (!('serviceWorker' in navigator)) return;
  const swUrl='service-worker.js'; const tryReg=()=>navigator.serviceWorker.register(swUrl).catch(err=>console.warn('[sw] reg failed',err));
  fetch(swUrl,{method:'GET',cache:'no-cache'}).then(r=>{ if(!r.ok) return; if('requestIdleCallback' in window) requestIdleCallback(tryReg); else setTimeout(tryReg,400); }).catch(()=>{});
})();

/* ---------- Boot ---------- */
(function boot(){
  try{ if (session) renderApp(); else renderLogin(); } catch(e){ notify('Startup error','danger'); renderLogin(); }
})();