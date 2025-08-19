/* =========================
   Inventory — Direct-Firebase SPA (images removed)
   ========================= */

/* ---------- Tiny utils ---------- */
function USD(x){ return `$${Number(x || 0).toFixed(2)}`; }
function parseYMD(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
function notify(msg,type='ok'){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>{ n.className='notification'; },2400); }

/* ---------- Theme ---------- */
const THEME_MODES = [
  {key:'sky',    name:'Sky (soft blue)'},
  {key:'sunset', name:'Sunset (soft orange)'},
  {key:'mint',   name:'Mint (soft green)'},
  {key:'dark',   name:'Dark'}
];
const THEME_SIZES = [
  {key:'small',  label:'Small'},
  {key:'medium', label:'Medium'},
  {key:'large',  label:'Large'}
];
function applyTheme(t){
  const theme = t || window.state.settings.theme || { mode:'sky', size:'medium' };
  document.documentElement.setAttribute('data-theme', theme.mode || 'sky');
  document.documentElement.setAttribute('data-font',  theme.size || 'medium');
}

/* =========================
   Firebase bootstrap
   ========================= */
if (!firebase || !firebase.initializeApp) {
  console.error("Firebase SDK missing. Check script tags in index.html");
}
if (firebase && firebase.apps && firebase.apps.length === 0 && window.__FIREBASE_CONFIG) {
  firebase.initializeApp(window.__FIREBASE_CONFIG);
}
const auth = firebase.auth();
const db   = firebase.database();

/* =========================
   State (no LocalStorage for data)
   ========================= */
const state = {
  session: null,
  route: localStorage.getItem('_route') || 'dashboard',
  searchQ: localStorage.getItem('_searchQ') || '',
  settings: { theme:{mode:'sky', size:'medium'} },
  inventory: [],
  products: [],
  posts: [],
  tasks: [],
  cogs: [],
  users: []
};
window.state = state;

/* =========================
   DB helpers (per-user paths)
   ========================= */
function uid(){ return auth.currentUser?.uid || null; }
function path(col){ return `tenants/${uid()}/${col}`; }
function ensureAuth(){ if(!uid()){ notify('Please sign in','warn'); return false; } return true; }
function addOrUpdate(col, obj){
  if(!ensureAuth()) return;
  const id = obj.id || `${col.substring(0,1)}_${Date.now()}`;
  obj.id = id;
  return db.ref(`${path(col)}/${id}`).set(obj).catch(e => notify(e.message || 'Save failed','danger'));
}
function remove(col, id){
  if(!ensureAuth()) return;
  return db.ref(`${path(col)}/${id}`).remove().catch(e => notify(e.message || 'Delete failed','danger'));
}
function replaceAll(col, arr){
  if(!ensureAuth()) return;
  const byId = {};
  arr.forEach(x=>{ const id = x.id || `${col.substring(0,1)}_${Date.now()}`; byId[id] = {...x, id}; });
  return db.ref(path(col)).set(byId).catch(e => notify(e.message || 'Sync failed','danger'));
}
function listen(col, onChange){
  if(!ensureAuth()) return;
  const ref = db.ref(path(col));
  ref.off();
  ref.on('value', snap=>{
    const val = snap.val() || {};
    const list = Object.values(val);
    // Sort predictable
    let out = list;
    if (col==='inventory') out = list.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    if (col==='products')  out = list.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    if (col==='posts')     out = list.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
    if (col==='users')     out = list.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    if (col==='cogs')      out = list.sort((a,b)=> (a.date||'').localeCompare(b.date||''));
    if (col==='tasks')     out = list; // keep lanes order
    onChange(out);
    renderApp();
  });
}
function saveTheme(theme){
  if(!ensureAuth()) return;
  return db.ref(`tenants/${uid()}/settings/theme`).set(theme).catch(e=> notify(e.message || 'Theme save failed','danger'));
}
function listenSettings(){
  if(!ensureAuth()) return;
  db.ref(`tenants/${uid()}/settings/theme`).off();
  db.ref(`tenants/${uid()}/settings/theme`).on('value', snap=>{
    const theme = snap.val() || {mode:'sky', size:'medium'};
    state.settings.theme = theme;
    applyTheme(theme);
    renderApp();
  });
}

/* =========================
   Auth
   ========================= */
auth.onAuthStateChanged(async user=>{
  if (!user){
    state.session = null;
    renderLogin();
    return;
  }
  state.session = { email:user.email, displayName:user.displayName||'', uid:user.uid };
  // attach listeners
  listenSettings();
  listen('inventory', x=> state.inventory = x);
  listen('products',  x=> state.products  = x);
  listen('posts',     x=> state.posts     = x);
  listen('tasks',     x=> state.tasks     = x);
  listen('cogs',      x=> state.cogs      = x);
  listen('users',     x=> state.users     = x);
  renderApp();
});

/* =========================
   Idle auto-logout (20 minutes, no prompt)
   ========================= */
const IDLE_MAX_MS = 20 * 60 * 1000;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt, ()=>{ __lastActivity = Date.now(); }, {passive:true}));
setInterval(()=>{ if (state.session && Date.now() - __lastActivity > IDLE_MAX_MS){ doLogout(); } }, 60*1000);

/* =========================
   Navigation + shell
   ========================= */
function go(route){ state.route = route; localStorage.setItem('_route', route); renderApp(); }
function renderSidebar(active='dashboard'){
  const links = [
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
        <input id="globalSearch" class="input" placeholder="Search everything…" autocomplete="off" />
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
        <a href="https://tiktok.com"   target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com"  target="_blank" rel="noopener" title="Twitter"><i class="ri-twitter-x-line"></i></a>
        <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left">
        <div class="burger btn ghost" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${(state.route||'dashboard').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      </div>
      <div class="right">
        <button class="btn secondary" id="btnDashboard"><i class="ri-dashboard-line"></i> Dashboard</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}
function safeView(route){
  switch(route||'dashboard'){
    case 'dashboard': return viewDashboard();
    case 'inventory': return viewInventory();
    case 'products':  return viewProducts();
    case 'cogs':      return viewCOGS();
    case 'tasks':     return viewTasks();
    case 'settings':  return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide': return viewPage(route);
    default: return viewDashboard();
  }
}
function renderApp(){
  try{
    const root = document.getElementById('root'); if (!root) return;
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
    `;
    wireRoute(route);
  }catch(e){ console.error('[renderApp] crash:', e); notify(e?.message||'Render failed','danger'); }
}
function wireRoute(route){
  $('#btnLogout')?.addEventListener('click', doLogout);
  $('#btnDashboard')?.addEventListener('click', ()=>go('dashboard'));
  $('#burger')?.addEventListener('click', openSidebar);
  $('#backdrop')?.addEventListener('click', closeSidebar);
  document.addEventListener('click', (e)=>{
    const item = e.target.closest('.sidebar .item[data-route]');
    if (!item) return; go(item.getAttribute('data-route')); closeSidebar();
  });

  hookSidebarSearch();

  switch(route||'dashboard'){
    case 'dashboard': wireDashboard(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts(); break;
    case 'cogs':      wireCOGS(); break;
    case 'tasks':     wireTasks(); break;
    case 'settings':  wireSettings(); break;
    case 'contact':   wireContact(); break;
  }
}
function openSidebar(){ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); }
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); }

/* ---------- Login ---------- */
function renderLogin(){
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login" style="max-width:420px;margin:10vh auto;padding:16px">
      <div class="card">
        <div class="card-body">
          <div class="brand" style="margin-bottom:10px"><div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div></div>
          <p style="color:var(--muted)">Sign in to continue.</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <button id="btnSignup" class="btn secondary"><i class="ri-user-add-line"></i> Create account</button>
          </div>
        </div>
      </div>
    </div>`;
  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSignIn(); });
  $('#btnSignup')?.addEventListener('click', doSignup);
}
async function doSignIn(){
  const email = ($('#li-email')?.value || '').trim().toLowerCase();
  const pass  = $('#li-pass')?.value || '';
  if (!email || !pass) return notify('Enter email & password','warn');
  try{
    await auth.signInWithEmailAndPassword(email, pass);
    notify('Welcome!');
  }catch(e){
    notify(e?.message || 'Login failed','danger');
  }
}
async function doSignup(){
  const email = prompt('Email?'); const pass = prompt('Password? (min 6 chars)');
  if (!email || !pass) return;
  try{
    await auth.createUserWithEmailAndPassword(email, pass);
    notify('Account created — you are signed in');
  }catch(e){ notify(e?.message||'Signup failed','danger'); }
}
async function doLogout(){
  try{ await auth.signOut(); }catch{}
  state.session=null; renderLogin();
}

/* ===================== Search ===================== */
function buildSearchIndex(){
  const ix=[];
  const pages=[
    { id:'about',label:'About',section:'Pages',route:'about' },
    { id:'policy',label:'Policy',section:'Pages',route:'policy' },
    { id:'license',label:'License',section:'Pages',route:'license' },
    { id:'setup',label:'Setup Guide',section:'Pages',route:'setup' },
    { id:'contact',label:'Contact',section:'Pages',route:'contact' },
    { id:'guide',label:'User Guide',section:'Pages',route:'guide' },
  ];
  state.posts.forEach(p=> ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`}));
  state.inventory.forEach(i=> ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`}));
  state.products.forEach(p=> ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`}));
  state.cogs.forEach(r=> ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.other}`}));
  state.users.forEach(u=> ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p));
  return ix;
}
function searchAll(index,q){
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
}
function hookSidebarSearch(){
  const input = $('#globalSearch'), results = $('#searchResults');
  if (!input || !results) return;

  const openResultsPage = (q)=>{
    state.searchQ = q; localStorage.setItem('_searchQ', q);
    if (state.route !== 'search'){ state.route='search'; } renderApp();
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
function viewSearch(){
  const q=(state.searchQ||'').trim();
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
function scrollToRow(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

/* ===================== Dashboard + Posts ===================== */
function viewDashboard(){
  const posts=state.posts, inv=state.inventory, prods=state.products, users=state.users, tasks=state.tasks, cogs=state.cogs;

  // Quick metrics (this month vs prev / YoY)
  const parse = r => parseYMD(r.date);
  const today=new Date(); const cy=today.getFullYear(), cm=today.getMonth()+1;
  const sumFor=(y,m)=> cogs.filter(r=>{ const p=parse(r)||{}; return p.y===y && p.m===m; }).reduce((s,r)=> s + (+r.grossIncome||0), 0);
  const py=cm===1?(cy-1):cy, pm=cm===1?12:(cm-1), ly=cy-1, lm=cm;
  const thisMonth = sumFor(cy,cm), prevMonth=sumFor(py,pm), lastYearSame=sumFor(ly,lm);
  const pct=(a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0?100:0));

  return `
    <div class="grid cols-4">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
    </div>

    <div class="grid cols-3" style="margin-top:12px">
      <div class="card"><div class="card-body"><strong>G-Income (This Month)</strong><div style="font-size:20px;margin-top:6px">${USD(thisMonth)}</div></div></div>
      <div class="card"><div class="card-body"><strong>MoM</strong><div style="font-size:20px;margin-top:6px;color:${pct(thisMonth,prevMonth)>=0?'var(--ok)':'var(--danger)'}">${pct(thisMonth,prevMonth).toFixed(1)}%</div></div></div>
      <div class="card"><div class="card-body"><strong>YoY</strong><div style="font-size:20px;margin-top:6px;color:${pct(thisMonth,lastYearSame)>=0?'var(--ok)':'var(--danger)'}">${pct(thisMonth,lastYearSame).toFixed(1)}%</div></div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          <button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
          ${posts.map(p=>`
            <div class="card" id="${p.id}">
              <div class="card-body">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div></div>
                  <div>
                    <button class="btn ghost" data-edit="${p.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${p.id}"><i class="ri-delete-bin-6-line"></i></button>
                  </div>
                </div>
                <p style="margin-top:8px">${p.body}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}
function wireDashboard(){
  document.querySelectorAll('[data-go]').forEach(el=>{
    el.addEventListener('click', ()=>{ const r=el.getAttribute('data-go'); if(r) go(r); });
  });
  $('#addPost')?.addEventListener('click', ()=> openModal('m-post'));
  const sec=document.querySelector('[data-section="posts"]'); if(!sec) return;
  $('#save-post')?.addEventListener('click', ()=>{
    const id=$('#post-id').value || ('post_'+Date.now());
    const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), createdAt: Date.now() };
    if(!obj.title) return notify('Title required','warn');
    addOrUpdate('posts', obj).then(()=>{ closeModal('m-post'); notify('Saved'); });
  });
  sec.addEventListener('click',(e)=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
    if (b.hasAttribute('data-edit')){
      const p=state.posts.find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    }else{
      remove('posts', id).then(()=> notify('Deleted'));
    }
  });
}

/* ===================== Inventory (no images) ===================== */
function viewInventory(){
  const items=state.inventory;
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Inventory</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button>
          <button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>
        </div>
      </div>
      <div class="table-wrap" data-section="inventory">
        <table class="table">
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>{
              const isLow = it.stock <= it.threshold;
              const isCrit= it.stock <= Math.max(1, Math.floor((it.threshold||0)*0.6));
              const trClass = isCrit ? 'tr-crit' : (isLow ? 'tr-warn' : '');
              return `<tr id="${it.id}" class="${trClass}">
                <td>${it.name||''}</td><td>${it.code||''}</td><td>${it.type||'-'}</td><td>${USD(it.price)}</td>
                <td><button class="btn ghost" data-dec="${it.id}">–</button><span style="padding:0 10px">${it.stock||0}</span><button class="btn ghost" data-inc="${it.id}">+</button></td>
                <td><button class="btn ghost" data-dec-th="${it.id}">–</button><span style="padding:0 10px">${it.threshold||0}</span><button class="btn ghost" data-inc-th="${it.id}">+</button></td>
                <td>
                  <button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div></div>

    ${invModal()}
  `;
}
function wireInventory(){
  $('#export-inventory')?.addEventListener('click',()=>{
    const rows=state.inventory;
    const headers=['id','name','code','type','price','stock','threshold'];
    downloadCSV('inventory.csv', rows, headers);
  });
  $('#addInv')?.addEventListener('click', ()=>{
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });
  $('#save-inv')?.addEventListener('click', ()=>{
    const id=$('#inv-id').value || ('inv_'+Date.now());
    const obj={ id,
      name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0')
    };
    if(!obj.name) return notify('Name required','warn');
    addOrUpdate('inventory', obj).then(()=>{ closeModal('m-inv'); notify('Saved'); });
  });

  const sec=document.querySelector('[data-section="inventory"]'); if(!sec) return;
  sec.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const items=state.inventory;
    const get=id=>items.find(x=>x.id===id);

    if(btn.hasAttribute('data-edit')){
      const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
      openModal('m-inv');
      $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price||0; $('#inv-stock').value=it.stock||0; $('#inv-threshold').value=it.threshold||0;
      return;
    }
    if(btn.hasAttribute('data-del')){
      const id=btn.getAttribute('data-del'); remove('inventory', id).then(()=> notify('Deleted')); return;
    }
    const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
    if(!id) return;
    const it=get(id); if(!it) return;
    if(btn.hasAttribute('data-inc')) it.stock=(it.stock||0)+1;
    if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,(it.stock||0)-1);
    if(btn.hasAttribute('data-inc-th')) it.threshold=(it.threshold||0)+1;
    if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,(it.threshold||0)-1);
    addOrUpdate('inventory', it);
  });
}

/* ===================== Products (no images, card on click) ===================== */
function viewProducts(){
  const items=state.products;
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Products</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button>
          <button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>
        </div>
      </div>
      <div class="table-wrap" data-section="products">
        <table class="table">
          <thead><tr><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><button class="btn ghost prod-open" data-card="${it.id}" title="Open card">${it.name}</button></td>
                <td>${it.barcode||''}</td><td>${USD(it.price)}</td><td>${it.type||'-'}</td>
                <td>
                  <button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>

    ${prodModal()}
    ${prodCardModal()}
  `;
}
function wireProducts(){
  $('#export-products')?.addEventListener('click',()=>{
    const rows=state.products;
    downloadCSV('products.csv', rows, ['id','name','barcode','price','type','ingredients','instructions']);
  });
  $('#addProd')?.addEventListener('click', ()=>{
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });

  $('#save-prod')?.addEventListener('click', ()=>{
    const id=$('#prod-id').value || ('p_'+Date.now());
    const obj={
      id, name:$('#prod-name').value.trim(),
      barcode:$('#prod-barcode').value.trim(),
      price:parseFloat($('#prod-price').value||'0'),
      type:$('#prod-type').value.trim(),
      ingredients:$('#prod-ingredients').value.trim(),
      instructions:$('#prod-instructions').value.trim()
    };
    if(!obj.name) return notify('Name required','warn');
    addOrUpdate('products', obj).then(()=>{ closeModal('m-prod'); notify('Saved'); });
  });

  const sec=document.querySelector('[data-section="products"]'); if(!sec) return;
  sec.addEventListener('click',(e)=>{
    const prodBtn = e.target.closest('.prod-open');
    if (prodBtn){
      const id=prodBtn.getAttribute('data-card'); const items=state.products; const it=items.find(x=>x.id===id); if(!it) return;
      $('#pc-name').textContent=it.name;
      $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price); $('#pc-type').textContent=it.type||'';
      $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||''; openModal('m-card'); return;
    }
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const it=state.products.find(x=>x.id===id); if(!it) return;
      openModal('m-prod');
      $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price||0; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
      $('#prod-instructions').value=it.instructions||'';
    }else{
      remove('products', id).then(()=> notify('Deleted'));
    }
  });
}

/* ===================== COGS (G-Income, G-Profit; no Delivery col; month/year filter & export) ===================== */
function profitOf(r){ return (+r.grossIncome||0) - ((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0)); }
function viewCOGS(){
  const rows=state.cogs;

  // filter controls
  const selectedMonth = (localStorage.getItem('_cogsMonth') || new Date().toISOString().slice(0,7));
  const [fy, fm] = selectedMonth.split('-').map(Number);
  const filtered = rows.filter(r=>{
    const p=parseYMD(r.date); return p && p.y===fy && p.m===fm;
  });

  const totals=filtered.reduce((a,r)=>({
    grossIncome:a.grossIncome+(+r.grossIncome||0),
    produceCost:a.produceCost+(+r.produceCost||0),
    itemCost:a.itemCost+(+r.itemCost||0),
    freight:a.freight+(+r.freight||0),
    other:a.other+(+r.other||0)
  }),{grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
  const totalProfit=profitOf(totals);

  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">COGS</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="cogs-month" class="input" type="month" value="${selectedMonth}" />
          <button class="btn ok" id="export-cogs-month"><i class="ri-download-2-line"></i> Export Month</button>
          <button class="btn secondary" id="export-cogs-year"><i class="ri-download-2-line"></i> Export Year</button>
          <button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>
        </div>
      </div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead><tr>
            <th>Date</th><th>G-Income</th><th>Produce</th><th>Item</th><th>Freight</th><th>Other</th><th>G-Profit</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${filtered.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td><td>${USD(r.grossIncome)}</td><td>${USD(r.produceCost)}</td><td>${USD(r.itemCost)}</td>
                <td>${USD(r.freight)}</td><td>${USD(r.other)}</td><td>${USD(profitOf(r))}</td>
                <td>
                  <button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
            <tr class="tr-total">
              <th>Total</th><th>${USD(totals.grossIncome)}</th><th>${USD(totals.produceCost)}</th><th>${USD(totals.itemCost)}</th>
              <th>${USD(totals.freight)}</th><th>${USD(totals.other)}</th><th>${USD(totalProfit)}</th><th></th>
            </tr>
          </tbody>
        </table>
      </div>
    </div></div>

    ${cogsModal()}
  `;
}
function wireCOGS(){
  const monthInp = $('#cgs-month') || $('#cogs-month'); // typo-safe
  monthInp?.addEventListener('change', (e)=>{ localStorage.setItem('_cogsMonth', e.target.value); renderApp(); });

  $('#export-cogs-month')?.addEventListener('click', ()=>{
    const ym = ($('#cogs-month')?.value || new Date().toISOString().slice(0,7));
    const [y,m] = ym.split('-').map(Number);
    const rows=state.cogs.filter(r=>{ const p=parseYMD(r.date); return p && p.y===y && p.m===m; });
    downloadCSV(`cogs-${ym}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','freight','other']);
  });
  $('#export-cogs-year')?.addEventListener('click', ()=>{
    const ym = ($('#cogs-month')?.value || new Date().toISOString().slice(0,7));
    const [y] = ym.split('-').map(Number);
    const rows=state.cogs.filter(r=>{ const p=parseYMD(r.date); return p && p.y===y; });
    downloadCSV(`cogs-${y}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','freight','other']);
  });

  $('#addCOGS')?.addEventListener('click', ()=>{
    openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-other').value='';
  });
  $('#save-cogs')?.addEventListener('click', ()=>{
    const id=$('#cogs-id').value || ('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
      itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0), other:+($('#cogs-other').value||0) };
    addOrUpdate('cogs', row).then(()=>{ closeModal('m-cogs'); notify('Saved'); });
  });

  const sec=document.querySelector('[data-section="cogs"]'); if(!sec) return;
  sec.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const r=state.cogs.find(x=>x.id===id); if(!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome||0;
      $('#cogs-produceCost').value=r.produceCost||0; $('#cogs-itemCost').value=r.itemCost||0; $('#cogs-freight').value=r.freight||0; $('#cogs-other').value=r.other||0;
    }else{
      remove('cogs', id).then(()=> notify('Deleted'));
    }
  });
}

/* ===================== Tasks (DnD empty lanes supported) ===================== */
function viewTasks(){
  const items=state.tasks;
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo' ? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>${t.title}</div>
                <div>
                  <button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>
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
    ${taskModal()}
  </div>`;
}
function wireTasks(){
  $('#addTask')?.addEventListener('click', ()=>{
    openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo';
  });
  $('#save-task')?.addEventListener('click', ()=>{
    const id=$('#task-id').value || ('t_'+Date.now());
    const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
    if(!obj.title) return notify('Title required','warn');
    addOrUpdate('tasks', obj).then(()=>{ closeModal('m-task'); notify('Saved'); });
  });

  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;
  root.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const t=state.tasks.find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      remove('tasks', id).then(()=> notify('Deleted'));
    }
  });

  setupDnD();
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click',(e)=>{
        if (e.target.closest('button')) return;
        const id=card.getAttribute('data-task'); const t=state.tasks.find(x=>x.id===id); if(!t) return;
        t.status=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        addOrUpdate('tasks', t);
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
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const t=state.tasks.find(x=>x.id===id); if(!t) return;
      t.status=lane; addOrUpdate('tasks', t);
    });
  });
}

/* ===================== Settings / Users (no avatars) ===================== */
function viewSettings(){
  const theme=state.settings.theme || {mode:'sky', size:'medium'};
  const users=state.users;
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-3">
          <div>
            <label style="font-size:12px;color:var(--muted)">Mode</label>
            <select id="theme-mode" class="input">
              ${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--muted)">Font Size</label>
            <select id="theme-size" class="input">
              ${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--muted)">Contact</label><br/>
            <a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Hello%20from%20Inventory&body=Hi%2C%0A" target="_blank" rel="noopener"><i class="ri-mail-send-line"></i> Email Us</a>
          </div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Users</h3>
          <button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>
        </div>
        <table class="table" data-section="users">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr id="${u.email}">
                <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
                <td>
                  <button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>

    ${userModal()}
  `;
}
function wireSettings(){
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=()=>{
    const theme = { mode:mode.value, size:size.value };
    applyTheme(theme);               // immediate visual change
    saveTheme(theme);                // persist per-user
    notify('Theme updated');
  };
  mode?.addEventListener('change', applyNow);
  size?.addEventListener('change', applyNow);

  wireUsers();
}
function wireUsers(){
  $('#addUser')?.addEventListener('click', ()=>{
    openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-role').value='user';
  });
  $('#save-user')?.addEventListener('click', ()=>{
    const email=($('#user-email')?.value||'').trim().toLowerCase();
    if(!email) return notify('Email required','warn');
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:($('#user-role')?.value||'user'), contact:'' };
    addOrUpdate('users', obj).then(()=>{ closeModal('m-user'); notify('Saved'); });
  });
  const table=document.querySelector('[data-section="users"]');
  table?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      const u=state.users.find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-role').value=u.role||'user';
    }else{
      remove('users', email).then(()=> notify('Deleted'));
    }
  });
}

/* ===================== Static pages (more meaningful content) ===================== */
const pageContent = {
  about: `
    <h3>About Inventory</h3>
    <p>Inventory is a lightweight, mobile-first back-office app built on Firebase Realtime Database. It works great for small teams that need fast stock, product, cost, and task tracking without complex setup.</p>
    <ul>
      <li>Direct per-user cloud storage (no manual sync)</li>
      <li>Instant search across posts, items, products, COGS, and users</li>
      <li>Soft, modern themes with one-click font scaling</li>
    </ul>
  `,
  policy: `
    <h3>Policy</h3>
    <p>All data is scoped by your Firebase user ID. Only you (and accounts you authorize via Firebase rules) can read/write your tenant paths. Keep your API keys and rules secure.</p>
    <p>We store only what you enter. No images, videos, or file uploads are collected in this build.</p>
  `,
  license: `
    <h3>License</h3>
    <p>MIT License — You’re free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of this software.</p>
  `,
  setup: `
    <h3>Setup Guide</h3>
    <ol>
      <li>Create a Firebase project and enable Email/Password Auth.</li>
      <li>Copy your config into <code>public-index.html</code>.</li>
      <li>Deploy <code>public/</code> to Firebase Hosting.</li>
      <li>Set database rules (see sample below).</li>
    </ol>
  `,
  guide: `
    <h3>User Guide</h3>
    <ul>
      <li><strong>Dashboard</strong> shows quick KPIs and your posts.</li>
      <li><strong>Inventory</strong> contains raw items; stock/threshold can be nudged inline.</li>
      <li><strong>Products</strong> are sellable items. Click a product name to open its details card.</li>
      <li><strong>COGS</strong> tracks costs and G-Income/G-Profit. Filter by month and export.</li>
      <li><strong>Tasks</strong> supports drag-and-drop across lanes (even empty ones).</li>
      <li><strong>Settings</strong> changes theme mode and font size instantly.</li>
    </ul>
  `,
  contact: `
    <h3>Contact</h3>
    <p>Questions or feedback? Click to email us:</p>
    <p><a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Hello%20from%20Inventory&body=Hi%2C%0A"><i class="ri-mail-send-line"></i> Email Us</a></p>
  `
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key] || '<p>Page</p>'}</div></div>`; }
function wireContact(){}

/* ===================== Modals ===================== */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }

function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv">
    <div class="dialog">
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" onclick="closeModal('m-inv')">Close</button></div>
      <div class="body grid">
        <input id="inv-id" type="hidden"/>
        <input id="inv-name" class="input" placeholder="Name"/>
        <input id="inv-code" class="input" placeholder="Code"/>
        <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
        <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <input id="inv-stock" class="input" type="number" placeholder="Stock"/>
        <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/>
      </div>
      <div class="foot"><button class="btn" id="save-inv">Save</button></div>
    </div>
  </div>`; }

function prodModal(){ return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod">
    <div class="dialog">
      <div class="head"><strong>Product</strong><button class="btn ghost" onclick="closeModal('m-prod')">Close</button></div>
      <div class="body grid">
        <input id="prod-id" type="hidden"/>
        <input id="prod-name" class="input" placeholder="Name"/>
        <input id="prod-barcode" class="input" placeholder="Barcode"/>
        <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <input id="prod-type" class="input" placeholder="Type"/>
        <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
        <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
      </div>
      <div class="foot"><button class="btn" id="save-prod">Save</button></div>
    </div>
  </div>`; }

function prodCardModal(){ return `
  <div class="modal-backdrop" id="mb-card"></div>
  <div class="modal" id="m-card">
    <div class="dialog">
      <div class="head"><strong id="pc-name">Product</strong><button class="btn ghost" onclick="closeModal('m-card')">Close</button></div>
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
      <div class="head"><strong>COGS Row</strong><button class="btn ghost" onclick="closeModal('m-cogs')">Close</button></div>
      <div class="body grid cols-2">
        <input id="cogs-id" type="hidden"/>
        <input id="cogs-date" class="input" type="date"/>
        <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="G-Income"/>
        <input id="cogs-produceCost"  class="input" type="number" step="0.01" placeholder="Produce Cost"/>
        <input id="cogs-itemCost"     class="input" type="number" step="0.01" placeholder="Item Cost"/>
        <input id="cogs-freight"      class="input" type="number" step="0.01" placeholder="Freight"/>
        <input id="cogs-other"        class="input" type="number" step="0.01" placeholder="Other"/>
      </div>
      <div class="foot"><button class="btn" id="save-cogs">Save</button></div>
    </div>
  </div>`; }

function taskModal(){ return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" onclick="closeModal('m-task')">Close</button></div>
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
      <div class="head"><strong>User</strong><button class="btn ghost" onclick="closeModal('m-user')">Close</button></div>
      <div class="body grid">
        <input id="user-name" class="input" placeholder="Name"/>
        <input id="user-email" class="input" type="email" placeholder="Email"/>
        <input id="user-username" class="input" placeholder="Username"/>
        <select id="user-role" class="input">
          <option value="user">User</option>
          <option value="associate">Associate</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>`; }

function postModal(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post">
    <div class="dialog">
      <div class="head"><strong>Post</strong><button class="btn ghost" onclick="closeModal('m-post')">Close</button></div>
      <div class="body grid">
        <input id="post-id" type="hidden"/>
        <input id="post-title" class="input" placeholder="Title"/>
        <textarea id="post-body" class="input" placeholder="Body"></textarea>
      </div>
      <div class="foot"><button class="btn" id="save-post">Save</button></div>
    </div>
  </div>`; }

/* ===================== CSV util ===================== */
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

/* ===================== App Frame ===================== */
function ensureGlobalModals(){
  if ($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals';
  wrap.innerHTML = postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal();
  document.body.appendChild(wrap);
}

/* ---------- Boot ---------- */
(function boot(){
  ensureGlobalModals();
  applyTheme();
  if (state.session) renderApp(); else renderLogin();
})();