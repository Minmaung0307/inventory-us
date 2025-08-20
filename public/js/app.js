/* Inventory SPA — Firestore + EmailJS (v1.0.2)
   -----------------------------------------------------
   - Ensure compat SDKs are loaded: app, auth, firestore
   - window.__FIREBASE_CONFIG must be defined in index.html
   - Optional: fill EmailJS IDs below (used on Contact page if you add one)
   ----------------------------------------------------- */

(() => {
  'use strict';

  /* ---------- EmailJS config (optional) ---------- */
  const EMAILJS_PUBLIC_KEY = 'WT0GOYrL9HnDKvLUf';
  const EMAILJS_SERVICE_ID = 'service_z9tkmvr';
  const EMAILJS_TEMPLATE_ID = 'template_q5q471f';

  /* ---------- Firebase (Compat) ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) {
    console.error('Firebase SDK or config missing. Add compat SDKs and __FIREBASE_CONFIG.');
  }
  if (firebase.apps.length === 0) {
    firebase.initializeApp(window.__FIREBASE_CONFIG);
  }
  const auth = firebase.auth();
  const fs   = firebase.firestore();

  /* ---------- Demo admins ---------- */
  const DEMO_ADMINS = [
    { email: 'admin@inventory.com',        pass: 'admin123' },
    { email: 'minmaung0307@gmail.com',     pass: 'admin123' }
  ];

  /* ---------- Constants ---------- */
  const ROLES = ['user','associate','manager','admin'];
  const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
  const IDLE_MS = 20 * 60 * 1000; // 20 minutes

  /* ---------- Tiny utils ---------- */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const USD = (x)=> `$${Number(x||0).toFixed(2)}`;
  function safeJSON(s, f=null){ try{ const v=JSON.parse(s); return v??f; }catch{ return f; } }
  function notify(msg,type='ok'){
    const n=$('#notification'); if(!n) return;
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=>{ n.className='notification'; }, 2400);
  }

  /* ---------- State & storage ---------- */
  const state = {
    session: safeJSON(localStorage.getItem('session'), null),
    route:   safeJSON(localStorage.getItem('_route'),'dashboard'),
    searchQ: safeJSON(localStorage.getItem('_searchQ'),''),
    cloudOn: safeJSON(localStorage.getItem('_cloudOn'), true)
  };
  function kscope(k){
    if (state.session?.authMode==='local' && state.session?.email) return `local:${state.session.email.toLowerCase()}:${k}`;
    const uid = auth?.currentUser?.uid || null;
    return uid ? `uid:${uid}:${k}` : `anon:${k}`;
  }
  function load(k,f){ return safeJSON(localStorage.getItem(kscope(k)), f); }
  function saveLocal(k,v){ try{ localStorage.setItem(kscope(k), JSON.stringify(v)); }catch{} }
  function save(k,v){
    saveLocal(k,v);
    if (cloud.isOn() && auth?.currentUser) {
      cloud.saveKV(k, v).catch(()=>{});
    }
  }
  function role(){ return state.session?.role || 'user'; }
  function canAdd(){ return ['associate','manager','admin'].includes(role()); }
  function canEdit(){ return ['manager','admin'].includes(role()); }
  function canDelete(){ return role()==='admin'; }

  /* ---------- Theme ---------- */
  const THEME_MODES = [
    { key:'sunset', name:'Sunset (soft orange)' },
    { key:'sky',    name:'Sky (soft blue)' },
    { key:'meadow', name:'Meadow (soft green)' },
    { key:'light',  name:'Light' },
    { key:'dark',   name:'Dark' },
  ];
  const THEME_SIZES = [
    { key:'small',  pct:90,  label:'Small'  },
    { key:'medium', pct:100, label:'Medium' },
    { key:'large',  pct:112, label:'Large'  },
  ];
  function applyTheme(){
    const def = { mode:'sunset', size:'medium' };
    let t = load('_theme2', def);
    if (!t || typeof t!=='object') { t=def; save('_theme2',t); }
    const mode = THEME_MODES.find(m=>m.key===t.mode)?.key || 'sunset';
    const sizePct = THEME_SIZES.find(s=>s.key===t.size)?.pct || 100;
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.setProperty('--font-scale', sizePct + '%');
  }

  /* ---------- Firestore “cloud KV” (no RTDB) ---------- */
  const cloud = (function(){
    const on  = ()=> !!safeJSON(localStorage.getItem('_cloudOn'), true);
    const set = (v)=> { try{ localStorage.setItem('_cloudOn', JSON.stringify(!!v)); }catch{} };
    const uid = ()=> auth?.currentUser?.uid || null;
    const docFor = (k)=> fs.collection('tenants').doc(uid()).collection('kv').doc(k);

    async function saveKV(key,val){
      if(!on() || !uid()) return;
      await docFor(key).set({
        key,
        val,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
    }
    async function pullAllOnce(){
      if(!uid()) return;
      const snap = await fs.collection('tenants').doc(uid()).collection('kv').get();
      snap.forEach(d=>{
        const row=d.data();
        if(row && row.key && 'val' in row){
          localStorage.setItem(kscope(row.key), JSON.stringify(row.val));
        }
      });
    }
    const unsubs = [];
    function subscribeAll(){
      if(!uid()) return;
      CLOUD_KEYS.forEach(key=>{
        const un = docFor(key).onSnapshot(s=>{
          if(!s.exists) return;
          const row=s.data(); if(!row) return;
          const curr = load(key, null);
          if (JSON.stringify(curr)!==JSON.stringify(row.val)){
            localStorage.setItem(kscope(key), JSON.stringify(row.val));
            if (key==='_theme2') applyTheme();
            renderApp();
          }
        });
        unsubs.push(un);
      });
    }
    function unsubscribeAll(){ unsubs.splice(0).forEach(u=>{ try{u();}catch{} }); }
    async function pushAll(){
      if(!uid()) return;
      for (const k of CLOUD_KEYS){
        const v = load(k, null);
        if (v!==null && v!==undefined) await saveKV(k, v);
      }
    }
    async function enable(){
      if(!uid()) throw new Error('Sign in first');
      set(true);
      try{ await fs.enableNetwork(); }catch{}
      await pullAllOnce(); await pushAll(); subscribeAll();
    }
    async function disable(){ set(false); unsubscribeAll(); try{ await fs.disableNetwork(); }catch{} }

    return { isOn:on, enable, disable, saveKV, pullAllOnce, subscribeAll, pushAll };
  })();

  /* ---------- IDB guard for auth persistence (no eval) ---------- */
  function __checkIndexedDB(){
    return new Promise(res=>{
      try{
        const req = indexedDB.open('__inv_idb__');
        req.onsuccess = ()=>{ try{ req.result.close(); indexedDB.deleteDatabase('__inv_idb__'); }catch{}; res(true); };
        req.onerror   = ()=> res(false);
      }catch{ res(false); }
    });
  }
  (async ()=>{
    try{
      if (auth?.setPersistence){
        const ok = await __checkIndexedDB();
        const mode = ok ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
        await auth.setPersistence(mode);
      }
    }catch(e){ console.warn('[auth] persistence set failed', e); }
  })();

  /* ---------- Seed demo data (per local scope) ---------- */
  function seedTenantOnce(){
    const FLAG = load('_seeded_v1', false);
    if (FLAG) return;
    const now = Date.now();
    const me  = (state.session?.email || 'user@example.com').toLowerCase();
    const uname = me.split('@')[0];

    const users = load('users', []);
    if (!users.find(u => (u.email||'').toLowerCase() === me)){
      const guessed = DEMO_ADMINS.some(d=>d.email===me) ? 'admin' : 'user';
      users.push({ name: uname, username: uname, email: me, role: guessed, contact:'' });
    }
    save('users', users);

    save('inventory', [
      { id:'inv_'+now,     name:`${uname} Rice`,  code:'RIC-001', type:'Dry',  price:1.20, stock:25, threshold:8 },
      { id:'inv_'+(now+1), name:`${uname} Salmon`,code:'SAL-201', type:'Raw',  price:8.50, stock:12, threshold:6 }
    ]);
    save('products', [
      { id:'p_'+now, name:`${uname} Roll`, barcode:'1001001', price:7.99, type:'Roll', ingredients:'Rice,Nori,Salmon', instructions:'8 pcs' }
    ]);
    save('posts', [
      { id:'post_'+now, title:`Welcome, ${uname}`, body:'This is your workspace. Add inventory, products, COGS, tasks.', createdAt: now }
    ]);
    save('tasks', [ { id:'t_'+now, title:'Sample task', status:'todo' } ]);
    save('cogs',  [ { id:'c_'+now, date: new Date().toISOString().slice(0,10), grossIncome:900, produceCost:220, itemCost:130, freight:20, other:8 } ]);
    save('_seeded_v1', true);
  }

  /* ---------- Auth listener ---------- */
  auth.onAuthStateChanged(async (user)=>{
    try{ await ensureSessionAndRender(user); }
    catch(err){ console.error('[auth] crashed', err); notify(err?.message||'Render failed','danger'); showRescue(err); }
  });

  async function ensureSessionAndRender(user){
    applyTheme();

    const stored = safeJSON(localStorage.getItem('session'), null);

    // Local demo admin fallback still works when not signed in to Firebase
    if (!user && stored?.authMode==='local'){
      state.session = stored;
      seedTenantOnce();
      renderApp();
      setupIdleLogout();
      return;
    }

    if (!user){
      state.session = null;
      saveLocal('session', null);
      renderLogin();
      return;
    }

    // Firebase user => ensure they exist in local "users" list (role)
    const email = (user.email||'').toLowerCase();
    let users = load('users', []);
    let prof  = users.find(u => (u.email||'').toLowerCase()===email);

    if (!prof){
      const guessed = DEMO_ADMINS.some(d=>d.email===email) ? 'admin' : 'user';
      prof = { name: user.displayName || email.split('@')[0], username: email.split('@')[0], email, role: guessed, contact:'' };
      users.push(prof);
      save('users', users);
    } else {
      if (DEMO_ADMINS.some(d=>d.email===email) && prof.role!=='admin'){
        prof.role = 'admin'; save('users', users);
      }
    }

    state.session = { ...prof, authMode:'firebase' };
    saveLocal('session', state.session);

    if (state.cloudOn){
      try{ await fs.enableNetwork(); }catch{}
      try{ await cloud.pullAllOnce(); }catch{}
      cloud.subscribeAll();
    }
    seedTenantOnce();
    renderApp();
    setupIdleLogout();
  }

  /* ---------- Login screen ---------- */
  function renderLogin(){
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = `
      <div class="login">
        <div class="card login-card">
          <div class="card-body">
            <div class="login-logo">
              <div class="logo">📦</div>
              <div class="title">Inventory</div>
            </div>
            <p class="login-note">Sign in to continue</p>
            <div class="grid">
              <label class="visually-hidden" for="li-email">Email</label>
              <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username" />
              <label class="visually-hidden" for="li-pass">Password</label>
              <input id="li-pass" class="input" type="password" placeholder="Password" autocomplete="current-password" />
              <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
              <div class="login-links">
                <a id="link-forgot"   href="#" class="btn ghost small"><i class="ri-key-2-line"></i> Forgot password</a>
                <a id="link-register" href="#" class="btn secondary small"><i class="ri-user-add-line"></i> Create account</a>
              </div>
              <div class="login-tip">Demo admins: admin@inventory.com / admin123, minmaung0307@gmail.com / admin123</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Auth Modals -->
      <div class="modal-backdrop" id="mb-auth"></div>

      <div class="modal" id="m-signup">
        <div class="dialog">
          <div class="head"><strong>Create account</strong><button class="btn ghost" data-close="m-signup">Close</button></div>
          <div class="body grid">
            <label class="visually-hidden" for="su-name">Full name</label>
            <input id="su-name" class="input" placeholder="Full name"/>
            <label class="visually-hidden" for="su-email">Email</label>
            <input id="su-email" class="input" type="email" placeholder="Email"/>
            <label class="visually-hidden" for="su-pass">Password</label>
            <input id="su-pass" class="input" type="password" placeholder="Password"/>
            <label class="visually-hidden" for="su-pass2">Confirm password</label>
            <input id="su-pass2" class="input" type="password" placeholder="Confirm password"/>
          </div>
          <div class="foot"><button class="btn" id="btnSignupDo"><i class="ri-user-add-line"></i> Sign up</button></div>
        </div>
      </div>

      <div class="modal" id="m-reset">
        <div class="dialog">
          <div class="head"><strong>Reset password</strong><button class="btn ghost" data-close="m-reset">Close</button></div>
          <div class="body grid">
            <label class="visually-hidden" for="fp-email">Email</label>
            <input id="fp-email" class="input" type="email" placeholder="Your email"/>
          </div>
          <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset</button></div>
        </div>
      </div>
    `;

    const open = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
    const close= ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

    $('#link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); open('#m-signup'); });
    $('#link-forgot')?.addEventListener('click',   (e)=>{ e.preventDefault(); open('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
    document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', close));

    async function doSignIn(){
      const email = ($('#li-email')?.value || '').trim().toLowerCase();
      const pass  = $('#li-pass')?.value || '';
      if (!email || !pass) return notify('Enter email & password','warn');

      // Demo admin local fallback
      const demo = DEMO_ADMINS.find(d=>d.email===email && d.pass===pass);
      if (demo){
        const users = load('users',[]);
        let u = users.find(x => (x.email||'').toLowerCase()===demo.email);
        if(!u){ u = { name:'Admin', username:'admin', email:demo.email, role:'admin', contact:'' }; users.push(u); save('users',users); }
        state.session = { ...u, authMode:'local' };
        saveLocal('session', state.session);
        seedTenantOnce();
        notify('Signed in (Local admin)');
        renderApp();
        setupIdleLogout();
        return;
      }

      try{
        await auth.signInWithEmailAndPassword(email, pass);
        notify('Welcome!');
      }catch(e){
        notify(e?.message || 'Login failed','danger');
      }
    }
    $('#btnLogin')?.addEventListener('click', doSignIn);
    $('#li-pass')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') doSignIn(); });

    $('#btnSignupDo')?.addEventListener('click', async ()=>{
      const name  = ($('#su-name')?.value || '').trim();
      const email = ($('#su-email')?.value || '').trim().toLowerCase();
      const pass  = $('#su-pass')?.value || '';
      const pass2 = $('#su-pass2')?.value || '';
      if (!email || !pass) return notify('Email & password required','warn');
      if (pass !== pass2)  return notify('Passwords do not match','warn');
      try{
        await auth.createUserWithEmailAndPassword(email, pass);
        try { await auth.currentUser.updateProfile({ displayName: name || email.split('@')[0] }); } catch {}
        notify('Account created — you are signed in');
        close();
      }catch(e){
        notify(e?.message||'Sign up failed','danger');
      }
    });

    $('#btnResetDo')?.addEventListener('click', async ()=>{
      const email = ($('#fp-email')?.value || '').trim().toLowerCase();
      if (!email) return notify('Enter your email','warn');
      try{
        await auth.sendPasswordResetEmail(email);
        notify('Reset email sent');
        close();
      }catch(e){
        notify(e?.message||'Reset failed','danger');
      }
    });
  }

  /* ---------- Logout ---------- */
  async function doLogout(){
    try{ cloud?.disable?.(); }catch{}
    try{ await auth.signOut(); }catch{}
    state.session = null;
    saveLocal('session', null);
    state.route = 'dashboard'; saveLocal('_route','dashboard');
    notify('Signed out'); renderLogin();
  }

  /* ---------- Search index ---------- */
  function buildSearchIndex(){
    const posts=load('posts',[]), inv=load('inventory',[]), prods=load('products',[]), cogs=load('cogs',[]), users=load('users',[]);
    const pages=[
      { id:'links', label:'Links', section:'Pages', route:'links' },
      { id:'policy',label:'Policy',section:'Pages',route:'links', text:'privacy policy terms usage license' },
      { id:'about', label:'About', section:'Pages',route:'links', text:'about company mission features' },
      { id:'guide', label:'User Guide', section:'Pages', route:'links', text:'guide tutorial keyboard shortcuts tips' }
    ];
    const ix=[];
    posts.forEach(p=>ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`}));
    inv.forEach(i=>ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`}));
    prods.forEach(p=>ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`}));
    cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.other}`}));
    users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
    pages.forEach(p=>ix.push(p));
    return ix;
  }
  function searchAll(index,q){
    const norm=s=>(s||'').toLowerCase();
    const tokens=norm(q).split(/\s+/).filter(Boolean);
    if(!tokens.length) return [];
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
  }

  /* ---------- Layout ---------- */
  function renderSidebar(active='dashboard'){
    const links = [
      { route:'dashboard', icon:'ri-dashboard-line',           label:'Dashboard' },
      { route:'inventory', icon:'ri-archive-2-line',           label:'Inventory' },
      { route:'products',  icon:'ri-store-2-line',             label:'Products' },
      { route:'cogs',      icon:'ri-money-dollar-circle-line', label:'COGS' },
      { route:'tasks',     icon:'ri-list-check-2',             label:'Tasks' },
      { route:'settings',  icon:'ri-settings-3-line',          label:'Settings' },
      { route:'links',     icon:'ri-links-line',               label:'Links' },
      { route:'search',    icon:'ri-search-line',              label:'Search' },
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
          ${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}">
            <i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}
        </div>
        <h6 class="social-caption">SOCIAL</h6>
        <div class="socials-row">
          <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
          <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
          <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
          <a href="https://tiktok.com"   target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
          <a href="https://twitter.com"  target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
        </div>
      </aside>
    `;
  }
  function renderTopbar(){
    return `
      <div class="topbar">
        <div class="left">
          <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
          <div><strong>${(state.route||'dashboard').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
        </div>
        <div class="right">
          <button class="btn ghost" id="btnDash"><i class="ri-dashboard-line"></i> Dashboard</button>
          <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
        </div>
      </div>
      <div class="backdrop" id="backdrop"></div>
    `;
  }

  document.addEventListener('click', (e)=>{
    const item = e.target.closest('.sidebar .item[data-route]');
    if (!item) return;
    const route = item.getAttribute('data-route');
    go(route);
    if (window.matchMedia('(max-width: 920px)').matches){
      closeSidebar();
      setTimeout(()=> $('#main')?.scrollIntoView({behavior:'smooth', block:'start'}), 0);
    }
  });
  document.addEventListener('click',(e)=>{
    const btn = e.target.closest('[data-close]'); if(!btn) return;
    closeModal(btn.getAttribute('data-close'));
  });

  function openSidebar(){ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); }
  function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }
  function ensureSidebarEdge(){
    if (!$('#sidebarEdge')){
      const edge=document.createElement('div'); edge.id='sidebarEdge'; document.body.appendChild(edge);
    }
  }
  function hookEdgeReveal(){
    const edge=$('#sidebarEdge'); if(!edge || edge.__wired) return; edge.__wired=true;
    const open = ()=> openSidebar();
    ['pointerenter','mouseenter','touchstart'].forEach(evt=> edge.addEventListener(evt, open, {passive:true}));
  }

  function go(route){ state.route=route; saveLocal('_route', route); renderApp(); }

  function safeView(route){
    switch(route){
      case 'dashboard': return viewDashboard();
      case 'inventory': return viewInventory();
      case 'products':  return viewProducts();
      case 'cogs':      return viewCOGS();
      case 'tasks':     return viewTasks();
      case 'settings':  return viewSettings();
      case 'links':     return viewLinks();
      case 'search':    return viewSearch();
      default:          return viewDashboard();
    }
  }

  function wireRoute(route){
    $('#btnLogout')?.addEventListener('click', doLogout);
    $('#btnDash')?.addEventListener('click', ()=>go('dashboard'));
    $('#burger')?.addEventListener('click', openSidebar);
    $('#backdrop')?.addEventListener('click', closeSidebar);

    hookSidebarInteractions();
    ensureGlobalModals();
    wireSessionIdleListeners();

    switch(route){
      case 'dashboard': wireDashboard(); wirePosts(); break;
      case 'inventory': wireInventory(); break;
      case 'products':  wireProducts();  break;
      case 'cogs':      wireCOGS();      break;
      case 'tasks':     wireTasks();     break;
      case 'settings':  wireSettings();  break;
      case 'links':     wireLinks();     break;
      case 'search':    /* no-op */     break;
    }
  }

  function renderApp(){
    const root = document.getElementById('root'); if(!root) return;
    if (!state.session){ renderLogin(); return; }
    const route = state.route || 'dashboard';
    root.innerHTML = `
      <div class="app">
        ${renderSidebar(route)}
        <div>
          ${renderTopbar()}
          <div class="main" id="main">${safeView(route)}</div>
        </div>
      </div>
      <div id="notification" class="notification"></div>
    `;
    wireRoute(route);
    ensureSidebarEdge(); hookEdgeReveal();
  }

  /* ---------- Sidebar search ---------- */
  function hookSidebarInteractions(){
    const input = $('#globalSearch'), results = $('#searchResults');
    if (!input || !results) return;

    let timer;
    const openResultsPage = (q)=>{
      state.searchQ = q; saveLocal('_searchQ', q);
      if (state.route!=='search') go('search'); else renderApp();
    };

    input.onkeydown = (e)=>{ if(e.key==='Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); } } };
    input.oninput = ()=>{
      clearTimeout(timer);
      const q = input.value.trim().toLowerCase();
      if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
      timer = setTimeout(()=>{
        const ix = buildSearchIndex();
        const out = searchAll(ix, q).slice(0,12);
        if (!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
        results.innerHTML = out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}">
          <strong>${r.label}</strong><span class="muted"> — ${r.section||''}</span></div>`).join('');
        results.classList.add('active');
        results.querySelectorAll('.result').forEach(row=>{
          row.onclick = ()=>{
            const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id')||'';
            openResultsPage(row.textContent.trim()); results.classList.remove('active'); input.value=''; closeSidebar();
            if (id) setTimeout(()=>{ const el=document.getElementById(id); el?.scrollIntoView({behavior:'smooth',block:'center'}); }, 80);
          };
        });
      }, 120);
    };
    document.addEventListener('click', (e)=>{ if(!results.contains(e.target) && e.target!==input){ results.classList.remove('active'); } });
  }

  /* ---------- Pages ---------- */
  // Dashboard
  function viewDashboard(){
    const posts=load('posts',[]), inv=load('inventory',[]), prods=load('products',[]), users=load('users',[]), tasks=load('tasks',[]), cogs=load('cogs',[]);
    const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
    const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;

    return `
      <div class="grid cols-4 auto">
        <div class="card tile go" data-go="inventory"><div>Total Items</div><h2>${inv.length}</h2></div>
        <div class="card tile go" data-go="products"><div>Products</div><h2>${prods.length}</h2></div>
        <div class="card tile go" data-go="settings"><div>Users</div><h2>${users.length}</h2></div>
        <div class="card tile go" data-go="tasks"><div>Tasks</div><h2>${tasks.length}</h2></div>
      </div>

      <div class="grid cols-3 auto" style="margin-top:12px">
        <div class="card warn"><div class="card-body"><strong>Low stock</strong><div class="muted">${lowCt}</div></div></div>
        <div class="card danger"><div class="card-body"><strong>Critical</strong><div class="muted">${critCt}</div></div></div>
        <div class="card go" data-go="cogs"><div class="card-body"><strong>COGS</strong><div class="muted">Open details</div></div></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-body">
          <div class="row-head">
            <h3 class="m0">Posts</h3>
            ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
          </div>
          <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
            ${posts.map(p=>`
              <div class="card" id="${p.id}">
                <div class="card-body">
                  <div class="row-head">
                    <div><strong>${p.title}</strong><div class="muted small">${new Date(p.createdAt).toLocaleString()}</div></div>
                    <div>
                      ${canEdit()? `<button class="btn ghost" data-edit="${p.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                      ${canDelete()? `<button class="btn danger" data-del="${p.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                    </div>
                  </div>
                  <p class="mt8">${p.body}</p>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `;
  }
  function wireDashboard(){
    $$('.card.tile.go').forEach(c => c.addEventListener('click', ()=> go(c.getAttribute('data-go')) ));
  }
  function wirePosts(){
    const sec=$('[data-section="posts"]'); if(!sec) return;
    $('#addPost')?.addEventListener('click', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-post'); $('#post-id').value=''; $('#post-title').value=''; $('#post-body').value=''; });
    $('#save-post')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const posts=load('posts',[]); const id=$('#post-id').value || ('post_'+Date.now());
      const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), createdAt: Date.now() };
      if(!obj.title) return notify('Title required','warn');
      const i=posts.findIndex(x=>x.id===id); if (i>=0){ if(!canEdit()) return notify('No permission','warn'); posts[i]=obj; } else posts.unshift(obj);
      save('posts', posts); closeModal('m-post'); notify('Saved'); renderApp();
    });
    if (!sec.__wired){
      sec.__wired=true;
      sec.addEventListener('click',(e)=>{
        const b=e.target.closest('button'); if(!b) return;
        const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
        if (b.hasAttribute('data-edit')){
          if(!canEdit()) return notify('No permission','warn');
          const p=load('posts',[]).find(x=>x.id===id); if(!p) return;
          openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
        }else{
          if(!canDelete()) return notify('No permission','warn');
          save('posts', load('posts',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
        }
      });
    }
  }

  // Inventory
  function viewInventory(){
    const items=load('inventory',[]);
    return `
      <div class="card"><div class="card-body">
        <div class="row-head">
          <h3 class="m0">Inventory</h3>
          <div class="row-actions">
            <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd()? `<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''}
          </div>
        </div>
        <div class="table-wrap" data-section="inventory">
          <table class="table">
            <thead><tr><th>Name</th><th>Code</th><th>Type</th><th class="ar">Price</th><th class="ac">Stock</th><th class="ac">Threshold</th><th>Actions</th></tr></thead>
            <tbody>
              ${items.map(it=>{
                const isLow = it.stock <= it.threshold;
                const isCrit= it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
                const trClass = isCrit ? 'tr-crit' : (isLow ? 'tr-warn' : '');
                return `<tr id="${it.id}" class="${trClass}">
                  <td>${it.name}</td>
                  <td>${it.code}</td>
                  <td>${it.type||'-'}</td>
                  <td class="ar">${USD(it.price)}</td>
                  <td class="ac">
                    ${canAdd()? `<button class="btn ghost mini" data-dec="${it.id}">–</button>
                                  <span class="mono" style="padding:0 10px">${it.stock}</span>
                                  <button class="btn ghost mini" data-inc="${it.id}">+</button>`
                              : `<span>${it.stock}</span>`}
                  </td>
                  <td class="ac">
                    ${canAdd()? `<button class="btn ghost mini" data-dec-th="${it.id}">–</button>
                                  <span class="mono" style="padding:0 10px">${it.threshold}</span>
                                  <button class="btn ghost mini" data-inc-th="${it.id}">+</button>`
                              : `<span>${it.threshold}</span>`}
                  </td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }
  function wireInventory(){
    const sec=$('[data-section="inventory"]'); if(!sec) return;
    $('#export-inventory')?.addEventListener('click',()=>{
      const rows=load('inventory',[]); const headers=['id','name','code','type','price','stock','threshold'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='inventory.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });
    $('#addInv')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      openModal('m-inv');
      $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
      $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
    });
    $('#save-inv')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=load('inventory',[]);
      const id=$('#inv-id').value || ('inv_'+Date.now());
      const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
        price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0') };
      if(!obj.name) return notify('Name required','warn');
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      save('inventory',items); closeModal('m-inv'); notify('Saved'); renderApp();
    });

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
          $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold; return;
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

  // Products
  function viewProducts(){
    const items=load('products',[]);
    return `
      <div class="card"><div class="card-body">
        <div class="row-head">
          <h3 class="m0">Products</h3>
          <div class="row-actions">
            <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd()? `<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''}
          </div>
        </div>

        <div class="table-wrap" data-section="products">
          <table class="table">
            <thead><tr><th>Name</th><th>Barcode</th><th class="ar">Price</th><th>Type</th><th>Actions</th></tr></thead>
            <tbody>
              ${items.map(it=>`
                <tr id="${it.id}">
                  <td><button class="link-as-btn prod-open" data-card="${it.id}" title="Open card">${it.name}</button></td>
                  <td>${it.barcode||''}</td>
                  <td class="ar">${USD(it.price)}</td>
                  <td>${it.type||'-'}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }
  function wireProducts(){
    const sec=$('[data-section="products"]'); if(!sec) return;

    $('#export-products')?.addEventListener('click',()=>{
      const rows=load('products',[]); const headers=['id','name','barcode','price','type','ingredients','instructions'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='products.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#addProd')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      openModal('m-prod');
      $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
      $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
    });

    $('#save-prod')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=load('products',[]);
      const id=$('#prod-id').value || ('p_'+Date.now());
      const obj={ id,
        name:$('#prod-name').value.trim(),
        barcode:$('#prod-barcode').value.trim(),
        price:parseFloat($('#prod-price').value||'0'),
        type:$('#prod-type').value.trim(),
        ingredients:$('#prod-ingredients').value.trim(),
        instructions:$('#prod-instructions').value.trim()
      };
      if(!obj.name) return notify('Name required','warn');
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      save('products', items); closeModal('m-prod'); notify('Saved'); renderApp();
    });

    if (!sec.__wired){
      sec.__wired=true;
      sec.addEventListener('click',(e)=>{
        const cardBtn = e.target.closest('.prod-open');
        if (cardBtn){
          const id=cardBtn.getAttribute('data-card'); const items=load('products',[]); const it=items.find(x=>x.id===id); if(!it) return;
          $('#pc-name').textContent=it.name; $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price);
          $('#pc-type').textContent=it.type||''; $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||'';
          openModal('m-card'); return;
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
          $('#prod-instructions').value=it.instructions||'';
        }else{
          if(!canDelete()) return notify('No permission','warn');
          save('products', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
        }
      });
    }
  }

  // COGS
  function viewCOGS(){
    const rows=load('cogs',[]);
    const totals=rows.reduce((a,r)=>({
      grossIncome:a.grossIncome+(+r.grossIncome||0),
      produceCost:a.produceCost+(+r.produceCost||0),
      itemCost:a.itemCost+(+r.itemCost||0),
      freight:a.freight+(+r.freight||0),
      other:a.other+(+r.other||0)
    }),{grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
    const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0));
    const totalProfit=gp(totals);

    return `
      <div class="card"><div class="card-body">
        <div class="row-head">
          <h3 class="m0">COGS</h3>
          <div class="row-actions">
            <select id="f-year" class="input small" title="Year"></select>
            <select id="f-month" class="input small" title="Month"></select>
            <button class="btn ghost" id="btnFilter"><i class="ri-filter-3-line"></i> Filter</button>
            <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
            ${canAdd()? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
          </div>
        </div>
        <div class="table-wrap" data-section="cogs">
          <table class="table cogs">
            <thead><tr>
              <th>Date</th>
              <th class="ar">G-Income</th>
              <th class="ar">Produce Cost</th>
              <th class="ar">Item Cost</th>
              <th class="ar">Freight</th>
              <th class="ar">Other</th>
              <th class="ar">G-Profit</th>
              <th>Actions</th>
            </tr></thead>
            <tbody id="cogs-body">
              ${rows.map(r=>`
                <tr id="${r.id}">
                  <td>${r.date}</td>
                  <td class="ar">${USD(r.grossIncome)}</td>
                  <td class="ar">${USD(r.produceCost)}</td>
                  <td class="ar">${USD(r.itemCost)}</td>
                  <td class="ar">${USD(r.freight)}</td>
                  <td class="ar">${USD(r.other)}</td>
                  <td class="ar">${USD(gp(r))}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${r.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${r.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
              <tr class="tr-total">
                <th>Total</th>
                <th class="ar">${USD(totals.grossIncome)}</th>
                <th class="ar">${USD(totals.produceCost)}</th>
                <th class="ar">${USD(totals.itemCost)}</th>
                <th class="ar">${USD(totals.freight)}</th>
                <th class="ar">${USD(totals.other)}</th>
                <th class="ar">${USD(totalProfit)}</th>
                <th></th>
              </tr>
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }
  function wireCOGS(){
    const sec=$('[data-section="cogs"]'); if(!sec) return;

    // Build year/month selects
    const rows=load('cogs',[]);
    const years=Array.from(new Set(rows.map(r=> (r.date||'').slice(0,4)).filter(Boolean))).sort();
    const months=[['','All'],['01','Jan'],['02','Feb'],['03','Mar'],['04','Apr'],['05','May'],['06','Jun'],['07','Jul'],['08','Aug'],['09','Sep'],['10','Oct'],['11','Nov'],['12','Dec']];
    const fy=$('#f-year'), fm=$('#f-month');
    if (fy && !fy.__opts){ fy.__opts=true; fy.innerHTML=['','All'].concat(years).map(v=>`<option value="${v}">${v||'All years'}</option>`).join(''); }
    if (fm && !fm.__opts){ fm.__opts=true; fm.innerHTML=months.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); }

    $('#btnFilter')?.addEventListener('click', ()=>{
      const y=($('#f-year')?.value||'').trim();
      const m=($('#f-month')?.value||'').trim();
      const body=$('#cogs-body'); if(!body) return;
      const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0));
      const data = rows.filter(r=>{
        if (y && !String(r.date||'').startsWith(y)) return false;
        if (m && String(r.date||'').slice(5,7)!==m) return false;
        return true;
      });
      const totals=data.reduce((a,r)=>({
        grossIncome:a.grossIncome+(+r.grossIncome||0),
        produceCost:a.produceCost+(+r.produceCost||0),
        itemCost:a.itemCost+(+r.itemCost||0),
        freight:a.freight+(+r.freight||0),
        other:a.other+(+r.other||0)
      }),{grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
      const totalProfit=gp(totals);

      body.innerHTML = data.map(r=>`
        <tr id="${r.id}">
          <td>${r.date}</td>
          <td class="ar">${USD(r.grossIncome)}</td>
          <td class="ar">${USD(r.produceCost)}</td>
          <td class="ar">${USD(r.itemCost)}</td>
          <td class="ar">${USD(r.freight)}</td>
          <td class="ar">${USD(r.other)}</td>
          <td class="ar">${USD(gp(r))}</td>
          <td>
            ${canEdit()? `<button class="btn ghost" data-edit="${r.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
            ${canDelete()? `<button class="btn danger" data-del="${r.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
          </td>
        </tr>`).join('') + `
        <tr class="tr-total">
          <th>Total</th>
          <th class="ar">${USD(totals.grossIncome)}</th>
          <th class="ar">${USD(totals.produceCost)}</th>
          <th class="ar">${USD(totals.itemCost)}</th>
          <th class="ar">${USD(totals.freight)}</th>
          <th class="ar">${USD(totals.other)}</th>
          <th class="ar">${USD(totalProfit)}</th>
          <th></th>
        </tr>`;
    });

    $('#export-cogs')?.addEventListener('click', ()=>{
      const rows=load('cogs',[]); const headers=['id','date','grossIncome','produceCost','itemCost','freight','other'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='cogs.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#addCOGS')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      openModal('m-cogs');
      $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
      $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
      $('#cogs-freight').value=''; $('#cogs-other').value='';
    });

    $('#save-cogs')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const rows=load('cogs',[]);
      const id=$('#cogs-id').value || ('c_'+Date.now());
      const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
        grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
        itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0),
        other:+($('#cogs-other').value||0) };
      const i=rows.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); rows[i]=row; } else rows.push(row);
      save('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp();
    });

    if (!sec.__wired){
      sec.__wired=true;
      sec.addEventListener('click',(e)=>{
        const btn=e.target.closest('button'); if(!btn) return;
        const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
        if (btn.hasAttribute('data-edit')){
          if(!canEdit()) return notify('No permission','warn');
          const r=load('cogs',[]).find(x=>x.id===id); if(!r) return;
          openModal('m-cogs');
          $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
          $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-other').value=r.other;
        }else{
          if(!canDelete()) return notify('No permission','warn');
          save('cogs', load('cogs',[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
        }
      });
    }
  }

  // Tasks (DnD & mobile tap-to-advance)
  function viewTasks(){
    const items=load('tasks',[]);
    const lane=(key,label,color)=>`
      <div class="card lane-row" data-lane="${key}">
        <div class="card-body">
          <div class="row-head">
            <h3 class="m0" style="color:${color}">${label}</h3>
            ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
          </div>
          <div class="grid lane-grid" id="lane-${key}">
            ${items.filter(t=>t.status===key).map(t=>`
              <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
                <div class="card-body task-row">
                  <div>${t.title}</div>
                  <div>
                    ${canEdit()? `<button class="btn ghost" data-edit="${t.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${t.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
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

    $('#addTask')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo';
    });
    $('#save-task')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=load('tasks',[]);
      const id=$('#task-id').value || ('t_'+Date.now());
      const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value||'todo' };
      if(!obj.title) return notify('Title required','warn');
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      save('tasks', items); closeModal('m-task'); notify('Saved'); renderApp();
    });

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

    setupDnD();

    // Tap-to-advance (mobile)
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints>0;
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
    const root=$('[data-section="tasks"]'); if(!root) return;

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

  // Settings (Theme + Cloud + Users)
  function viewSettings(){
    const users=load('users',[]); const theme=load('_theme2', {mode:'sunset', size:'medium'}); const cloudOn=state.cloudOn;
    return `
      <div class="grid">
        <div class="card"><div class="card-body">
          <h3 class="m0">Cloud Sync</h3>
          <p class="muted">Keep your data in Firebase Firestore (per-user KV).</p>
          <div class="grid cols-2">
            <div>
              <label class="small muted">Status</label>
              <select id="cloud-toggle" class="input">
                <option value="off" ${!cloudOn?'selected':''}>Off</option>
                <option value="on" ${cloudOn?'selected':''}>On</option>
              </select>
            </div>
            <div>
              <label class="small muted">Actions</label><br/>
              <button class="btn" id="cloud-sync-now"><i class="ri-cloud-line"></i> Sync Now</button>
            </div>
          </div>
          <p class="muted small" style="margin-top:8px">Cloud Sync requires Firebase login.</p>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 class="m0">Theme</h3>
          <div class="grid cols-2">
            <div>
              <label class="small muted">Mode</label>
              <select id="theme-mode" class="input">
                ${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="small muted">Font Size</label>
              <select id="theme-size" class="input">
                ${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <div class="row-head">
            <h3 class="m0">Users</h3>
            ${canAdd()? `<button class="btn" id="addUser"><i class="ri-user-add-line"></i> Add User</button>`:''}
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
                    ${canEdit()? `<button class="btn ghost" data-edit="${u.email}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${u.email}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div></div>
      </div>
    `;
  }
  function allowedRoleOptions(){
    const r=role(); if(r==='admin') return ROLES;
    if(r==='manager') return ['user','associate','manager'];
    if(r==='associate') return ['user','associate'];
    return ['user'];
  }
  function wireSettings(){
    // Theme (instant)
    const mode=$('#theme-mode'), size=$('#theme-size');
    const applyNow=()=>{ save('_theme2', { mode:mode.value, size:size.value }); applyTheme(); renderApp(); };
    mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

    // Cloud
    const toggle=$('#cloud-toggle'), syncNow=$('#cloud-sync-now');
    toggle?.addEventListener('change', async (e)=>{
      const val=e.target.value;
      try{
        if (val==='on'){
          if(!auth?.currentUser) { notify('Sign in with Firebase to use Cloud Sync.','warn'); toggle.value='off'; return; }
          await fs.enableNetwork(); await cloud.enable(); state.cloudOn=true; notify('Cloud Sync ON');
        }else{
          await cloud.disable(); state.cloudOn=false; notify('Cloud Sync OFF');
        }
      }catch(err){ notify(err?.message||'Could not change sync','danger'); toggle.value=state.cloudOn?'on':'off'; }
    });
    syncNow?.addEventListener('click', async ()=>{
      try{
        if(!auth?.currentUser) return notify('Sign in with Firebase','warn');
        if(!state.cloudOn) return notify('Turn Cloud Sync ON in Settings.','warn');
        if(!navigator.onLine) return notify('You appear to be offline.','warn');
        await fs.enableNetwork(); await cloud.pushAll(); notify('Synced');
      }catch(e){ notify((e&&e.message)||'Sync failed','danger'); }
    });

    // Users
    const addBtn=$('#addUser'); const table=$('[data-section="users"]');
    addBtn?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      openModal('m-user');
      $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value='';
      const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts[0];
    });
    $('#save-user')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const users=load('users',[]);
      const email=($('#user-email')?.value||'').trim().toLowerCase();
      if(!email) return notify('Email required','warn');
      const allowed=allowedRoleOptions(); const chosen=($('#user-role')?.value||'user'); if(!allowed.includes(chosen)) return notify('Role not allowed','warn');
      const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:chosen, contact:'' };
      const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);
      save('users', users); closeModal('m-user'); notify('Saved'); renderApp();
    });
    table?.addEventListener('click', (e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const u=load('users',[]).find(x=>x.email===email); if(!u) return;
        openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username;
        const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value= opts.includes(u.role) ? u.role : 'user';
      }else{
        if(!canDelete()) return notify('No permission','warn');
        save('users', load('users',[]).filter(x=>x.email!==email)); notify('Deleted'); renderApp();
      }
    });
  }

  // Links
  function viewLinks(){
    return `
      <div class="grid cols-3 auto">
        <div class="card link-card go" data-link="about"><div class="card-body"><i class="ri-information-line"></i> About</div></div>
        <div class="card link-card go" data-link="policy"><div class="card-body"><i class="ri-shield-check-line"></i> Policy</div></div>
        <div class="card link-card go" data-link="guide"><div class="card-body"><i class="ri-lightbulb-flash-line"></i> User Guide</div></div>
      </div>
      <div id="linkPage" class="mt16"></div>
    `;
  }
  function wireLinks(){
    const host = $('#linkPage'); if(!host) return;
    const content = {
      about: `<div class="card"><div class="card-body">
                <h3 class="m0">About</h3>
                <p class="muted">A fast, offline-friendly app to manage stock, products, COGS and tasks.</p>
                <ul class="nice-list">
                  <li>Mobile-first, smooth transitions</li>
                  <li>Search across all content</li>
                  <li>Role-based access</li>
                  <li>Realtime sync with Firebase</li>
                </ul>
              </div></div>`,
      policy:`<div class="card"><div class="card-body">
                <h3 class="m0">Policy</h3>
                <p class="muted">We keep your data per-account in your Firebase project.</p>
                <p class="muted">This app stores only the minimum required fields. You can export CSV anytime.</p>
              </div></div>`,
      guide: `<div class="card"><div class="card-body">
                <h3 class="m0">User Guide</h3>
                <ol class="nice-list">
                  <li>Use the sidebar to navigate. On mobile it slides in/out.</li>
                  <li>Inventory: adjust stock with <strong>– / +</strong>. Set thresholds per item.</li>
                  <li>Products: click a product name to open its card.</li>
                  <li>COGS: filter by month/year, export CSV.</li>
                  <li>Tasks: drag between lanes or tap to advance (mobile).</li>
                </ol>
              </div></div>`
    };
    $$('.link-card.go').forEach(c=>{
      c.addEventListener('click', ()=>{
        const key=c.getAttribute('data-link');
        host.innerHTML = content[key] || '';
        host.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
  }

  // Search page
  function viewSearch(){
    const q=(state.searchQ||'').trim();
    const index=buildSearchIndex();
    const out=q? searchAll(index,q):[];
    return `
      <div class="card"><div class="card-body">
        <div class="row-head">
          <h3 class="m0">Search</h3>
          <div class="muted">Query: <strong>${q||'(empty)'}</strong></div>
        </div>
        ${out.length? `<div class="grid">${out.map(r=>`
          <div class="card"><div class="card-body between">
            <div><div class="bold">${r.label}</div><div class="muted small">${r.section||''}</div></div>
            <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
          </div></div>`).join('')}</div>` : `<p class="muted">No results.</p>`}
      </div></div>
    `;
  }

  /* ---------- Modals ---------- */
  function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }

  function postModal(){ return `
    <div class="modal-backdrop" id="mb-post"></div>
    <div class="modal" id="m-post">
      <div class="dialog">
        <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
        <div class="body grid">
          <input id="post-id" type="hidden"/>
          <label class="visually-hidden" for="post-title">Title</label>
          <input id="post-title" class="input" placeholder="Title"/>
          <label class="visually-hidden" for="post-body">Body</label>
          <textarea id="post-body" class="input" placeholder="Body"></textarea>
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
          <label class="visually-hidden" for="inv-name">Name</label>
          <input id="inv-name" class="input" placeholder="Name"/>
          <label class="visually-hidden" for="inv-code">Code</label>
          <input id="inv-code" class="input" placeholder="Code"/>
          <label class="visually-hidden" for="inv-type">Type</label>
          <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
          <label class="visually-hidden" for="inv-price">Price</label>
          <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/>
          <label class="visually-hidden" for="inv-stock">Stock</label>
          <input id="inv-stock" class="input" type="number" placeholder="Stock"/>
          <label class="visually-hidden" for="inv-threshold">Threshold</label>
          <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/>
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
          <label class="visually-hidden" for="prod-name">Name</label>
          <input id="prod-name" class="input" placeholder="Name"/>
          <label class="visually-hidden" for="prod-barcode">Barcode</label>
          <input id="prod-barcode" class="input" placeholder="Barcode"/>
          <label class="visually-hidden" for="prod-price">Price</label>
          <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/>
          <label class="visually-hidden" for="prod-type">Type</label>
          <input id="prod-type" class="input" placeholder="Type"/>
          <label class="visually-hidden" for="prod-ingredients">Ingredients</label>
          <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
          <label class="visually-hidden" for="prod-instructions">Instructions</label>
          <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
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
          <div class="grid">
            <div><strong>Barcode:</strong> <span id="pc-barcode"></span></div>
            <div><strong>Price:</strong> <span id="pc-price"></span></div>
            <div><strong>Type:</strong> <span id="pc-type"></span></div>
          </div>
          <div class="grid">
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
          <label class="visually-hidden" for="cogs-date">Date</label>
          <input id="cogs-date" class="input" type="date"/>
          <label class="visually-hidden" for="cogs-grossIncome">G-Income</label>
          <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income"/>
          <label class="visually-hidden" for="cogs-produceCost">Produce Cost</label>
          <input id="cogs-produceCost"  class="input" type="number" step="0.01" placeholder="Produce Cost"/>
          <label class="visually-hidden" for="cogs-itemCost">Item Cost</label>
          <input id="cogs-itemCost"     class="input" type="number" step="0.01" placeholder="Item Cost"/>
          <label class="visually-hidden" for="cogs-freight">Freight</label>
          <input id="cogs-freight"      class="input" type="number" step="0.01" placeholder="Freight"/>
          <label class="visually-hidden" for="cogs-other">Other</label>
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
          <label class="visually-hidden" for="task-title">Title</label>
          <input id="task-title" class="input" placeholder="Title"/>
          <label class="visually-hidden" for="task-status">Status</label>
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
          <label class="visually-hidden" for="user-name">Name</label>
          <input id="user-name" class="input" placeholder="Name"/>
          <label class="visually-hidden" for="user-email">Email</label>
          <input id="user-email" class="input" type="email" placeholder="Email"/>
          <label class="visually-hidden" for="user-username">Username</label>
          <input id="user-username" class="input" placeholder="Username"/>
          <label class="visually-hidden" for="user-role">Role</label>
          <select id="user-role"></select>
        </div>
        <div class="foot"><button class="btn" id="save-user">Save</button></div>
      </div>
    </div>`; }

  function ensureGlobalModals(){
    if ($('#__modals')) return;
    const wrap=document.createElement('div'); wrap.id='__modals';
    wrap.innerHTML = postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal();
    document.body.appendChild(wrap);
  }

  /* ---------- Idle auto logout ---------- */
  let __lastActivity = Date.now();
  let __idleTimer = null;
  function markActivity(){ __lastActivity=Date.now(); }
  function wireSessionIdleListeners(){
    ['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt, markActivity, {passive:true}));
  }
  function setupIdleLogout(){
    if (__idleTimer) clearInterval(__idleTimer);
    __idleTimer = setInterval(()=>{
      if (!state.session) return;
      if (Date.now() - __lastActivity > IDLE_MS){ doLogout(); }
    }, 30000);
  }

  /* ---------- Rescue screen ---------- */
  function showRescue(err){
    const root=$('#root'); if(!root) return;
    const msg=(err&&(err.stack||err.message))?String(err.stack||err.message):'Unknown error';
    root.innerHTML=`
      <div class="rescue">
        <h2>Something crashed</h2>
        <p class="muted">You can recover or sign out below.</p>
        <div class="btns">
          <button id="rz-signout" class="btn danger">Sign out</button>
          <button id="rz-clearls" class="btn">Clear LocalStorage</button>
          <button id="rz-retry"   class="btn secondary">Retry render</button>
        </div>
        <pre class="log">${msg}</pre>
      </div>`;
    $('#rz-signout')?.addEventListener('click', async ()=>{ try{ await auth.signOut(); }catch{} location.reload(); });
    $('#rz-clearls')?.addEventListener('click', ()=>{ try{ localStorage.clear(); }catch{} location.reload(); });
    $('#rz-retry')?.addEventListener('click', ()=>{ try{ renderApp(); }catch(e){ console.error(e); notify(e?.message||'Retry failed','danger'); } });
  }

  /* ---------- Boot ---------- */
  (function boot(){
    try{
      applyTheme();
      if (state.session) seedTenantOnce();
      if (state.session) renderApp(); else renderLogin();
    }catch(e){ notify(e.message||'Startup error','danger'); renderLogin(); }
  })();
})();