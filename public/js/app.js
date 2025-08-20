/* =========================
   Inventory — Firebase-first SPA
   (Admins allowlisted + modern login + deduped listeners)
   ========================= */

/* ---------- Global error guard to avoid "hidden error" spam ---------- */
window.addEventListener('unhandledrejection', e => { console.warn('[Unhandled]', e.reason); });
window.addEventListener('error', e => { /* swallow noisy third-party errors but keep console clean */ });

/* ---------- Modal safety shims ---------- */
(function () {
  if (typeof window.ensureGlobalModals !== 'function') {
    window.ensureGlobalModals = function () {
      if (document.getElementById('__modals')) return;
      const wrap = document.createElement('div');
      wrap.id = '__modals';
      wrap.style.display = 'contents';
      document.body.appendChild(wrap);
    };
  }
  if (typeof window.openModal !== 'function') {
    window.openModal = function (id) {
      const m = document.getElementById(id); if (!m) return;
      m.classList.add('active');
      const bd = document.getElementById('mb-' + (id.split('-')[1] || ''));
      if (bd) bd.classList.add('active');
      document.body.classList.add('modal-open');
    };
  }
  if (typeof window.closeModal !== 'function') {
    window.closeModal = function (id) {
      const m = document.getElementById(id); if (m) m.classList.remove('active');
      const bd = document.getElementById('mb-' + (id.split('-')[1] || ''));
      if (bd) bd.classList.remove('active');
      document.body.classList.remove('modal-open');
    };
  }
})();

/* ---------- Tiny utils ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const USD = (x)=> `$${Number(x||0).toFixed(2)}`;
const ADMIN_EMAILS = ['admin@inventory.com','minmaung0307@gmail.com']; // <- allowlist
function notify(msg){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show`; setTimeout(()=>{ n.className='notification'; },2200); }

/* ---------- Theme ---------- */
const THEME_MODES = [
  { key:'sky',   name:'Sky (Blue)' },
  { key:'peach', name:'Peach (Soft Orange)' },
  { key:'mint',  name:'Mint (Soft Green)' },
  { key:'dark',  name:'Dark' },
];
const THEME_SIZES = [
  { key:'small',  pct: 90,  label:'Small' },
  { key:'medium', pct: 100, label:'Medium' },
  { key:'large',  pct: 112, label:'Large' },
];
function applyTheme(t){
  const theme = t || loadKV('_theme', { mode:'sky', size:'medium' });
  const sizePct = (THEME_SIZES.find(s=>s.key===theme.size)?.pct) ?? 100;
  document.documentElement.setAttribute('data-theme', THEME_MODES.find(m=>m.key===theme.mode)?.key || 'sky');
  document.documentElement.style.setProperty('--font-scale', sizePct + '%');
  saveKV('_theme', { mode: theme.mode, size: theme.size });
}

/* ---------- Firebase ---------- */
const firebaseConfig = window.__FIREBASE_CONFIG || null;
if (!firebaseConfig) alert('Missing Firebase config in index.html');
if (firebase && firebase.apps && firebase.apps.length === 0 && firebaseConfig) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

/* ---------- In-memory state ---------- */
let state = {
  session: null,
  route: 'dashboard',
  searchQ: '',
  posts: [], inventory: [], products: [], tasks: [], cogs: [], users: [],
  registry: {},
  theme: { mode:'sky', size:'medium' }
};

/* ---------- DB helpers ---------- */
function uid(){ return auth.currentUser?.uid || null; }
function pathKV(k){ return db.ref(`tenants/${uid()}/kv/${k}`); }
function loadKVLocal(k, fallback){ try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } }
function saveKVLocal(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function saveKV(k, v){ saveKVLocal(k, v); if (!uid()) return; return pathKV(k).set({ key:k, val:v, updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(e=> console.warn('[saveKV]', k, e)); }
function loadKV(k, fallback){ return (state?.[k]) ?? loadKVLocal(k, fallback); }

/* ---------- Live sync attach/detach to prevent duplicates ---------- */
const CLOUD_KEYS = ['posts','inventory','products','tasks','cogs','users','_theme'];
let liveRefs = [];
function stopLiveSync(){
  liveRefs.forEach(ref => ref.off('value'));
  db.ref('registry/users').off('value');
  liveRefs = [];
}
function startLiveSync(){
  if (!uid()) return;
  stopLiveSync();

  CLOUD_KEYS.forEach(k=>{
    const ref = pathKV(k);
    ref.on('value', snap=>{
      const row = snap.val(); if (!row) return;
      const incoming = row.val;
      if (k === '_theme'){ state.theme = incoming || state.theme; applyTheme(state.theme); }
      else { state[k.replace(/^_/, '')] = incoming || state[k]; }
      saveKVLocal(k, incoming);
      renderApp();
    });
    liveRefs.push(ref);
  });

  const regRef = db.ref(`registry/users`);
  regRef.on('value', snap=>{ state.registry = snap.val() || {}; renderApp(); });
}

/* ---------- Roles ---------- */
async function seedRoleIfFirstLogin(){
  if (!uid()) return;
  const roleRef = db.ref(`userRoles/${uid()}`);
  const snap = await roleRef.get();
  if (!snap.exists()){
    const email = (auth.currentUser?.email || '').toLowerCase();
    const target = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    await roleRef.set(target).catch(()=>{ /* rules may block; rules patch above enables it */ });
  }
}
async function fetchRole(){
  if (!uid()) return 'user';
  const r = await db.ref(`userRoles/${uid()}`).get().catch(()=>null);
  return (r && r.val()) || 'user';
}
function canAdd(){ return ['admin','manager','associate'].includes(state.session?.role || 'user'); }
function canEdit(){ return ['admin','manager'].includes(state.session?.role || 'user'); }
function canDelete(){ return ['admin'].includes(state.session?.role || 'user'); }

/* ---------- Auto logout (20 min) ---------- */
const AUTO_LOGOUT_MIN = 20;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt, ()=>{ __lastActivity=Date.now(); }, {passive:true}));
setInterval(()=> { if (!auth.currentUser) return; if (Date.now() - __lastActivity > AUTO_LOGOUT_MIN*60*1000) doLogout(); }, 30*1000);

/* ---------- Sidebar + pages (unchanged features) ---------- */
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
    { route:'guide',   icon:'ri-book-2-line',             label:'User Guide' },
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

      <h6>Menu</h6>
      <div class="nav">
        ${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}
      </div>

      <h6>Links</h6>
      <div class="links">
        ${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}
      </div>

      <h6>SOCIAL</h6>
      <div class="socials-compact">
        <a href="https://youtube.com" target="_blank" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://tiktok.com" target="_blank" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com" target="_blank" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
        <a href="https://facebook.com" target="_blank" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" title="Instagram"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left"><strong>${(state.route||'dashboard').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      <div class="right">
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>`;
}
function safeView(route){
  switch(route || 'dashboard'){
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
function go(route){ state.route = route; renderApp(); }

/* ---------- Pages ---------- */
function viewDashboard(){
  const posts = state.posts || [];
  const inv   = state.inventory || [];
  const prods = state.products || [];
  const users = state.users || [];
  const tasks = state.tasks || [];
  const cogs  = state.cogs || [];

  return `
    <div class="grid cols-4">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Inventory Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="card-body">
        <div class="space-between">
          <h3 style="margin:0">Posts</h3>
          ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
        </div>
        ${posts.length ? posts.map(p=>`
          <div class="card" id="${p.id}" style="margin-top:10px">
            <div class="card-body space-between">
              <div>
                <div style="font-weight:800">${p.title}</div>
                <div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div>
                <div style="margin-top:6px">${p.body}</div>
              </div>
              <div>
                ${canEdit()? `<button class="btn ghost" data-edit="${p.id}"><i class="ri-edit-line"></i></button>`:''}
                ${canDelete()? `<button class="btn danger" data-del="${p.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
              </div>
            </div>
          </div>
        `).join('') : `<p style="color:var(--muted);margin:10px 0 0">No posts yet.</p>`}
      </div>
    </div>`;
}
function wireDashboard(){
  $('#addPost')?.addEventListener('click', ()=>{
    openModal('m-post');
    $('#post-id').value=''; $('#post-title').value=''; $('#post-body').value='';
  });
  const sec = $('#main');
  sec?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if(!id) return;
    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const p = state.posts.find(x=>x.id===id); if(!p) return;
      openModal('m-post');
      $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    } else {
      if(!canDelete()) return notify('No permission');
      const posts = (state.posts||[]).filter(x=>x.id!==id);
      state.posts = posts; saveKV('posts', posts); notify('Deleted');
    }
  });
}

/* Inventory */
function viewInventory(){
  const items = state.inventory || [];
  return `
    <div class="card"><div class="card-body">
      <div class="space-between">
        <h3 style="margin:0">Inventory</h3>
        ${canAdd()? `<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''}
      </div>
      <div class="table-wrap" data-section="inventory" style="margin-top:8px">
        <table class="table">
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td>
                <td class="num">${USD(it.price)}</td>
                <td class="num">
                  ${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button> <span class="num">${it.stock}</span> <button class="btn ghost" data-inc="${it.id}">+</button>`:`<span class="num">${it.stock}</span>`}
                </td>
                <td class="num">
                  ${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button> <span class="num">${it.threshold}</span> <button class="btn ghost" data-inc-th="${it.id}">+</button>`:`<span class="num">${it.threshold}</span>`}
                </td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>`;
}
function wireInventory(){
  $('#addInv')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value=''; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });

  const sec = $('[data-section="inventory"]'); if(!sec) return;
  sec.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const items = state.inventory || [];
    const get = id => items.find(x=>x.id===id);

    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
      openModal('m-inv');
      $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold;
      return;
    }
    if (btn.hasAttribute('data-del')){
      if(!canDelete()) return notify('No permission');
      const id=btn.getAttribute('data-del'); state.inventory = items.filter(x=>x.id!==id); saveKV('inventory', state.inventory); renderApp(); return;
    }

    const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
    if(!id) return; if(!canAdd()) return notify('No permission');
    const it=get(id); if(!it) return;
    if(btn.hasAttribute('data-inc')) it.stock++;
    if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
    if(btn.hasAttribute('data-inc-th')) it.threshold++;
    if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
    saveKV('inventory', items); renderApp();
  });
}

/* Products */
function viewProducts(){
  const items = state.products || [];
  return `
    <div class="card"><div class="card-body">
      <div class="space-between">
        <h3 style="margin:0">Products</h3>
        ${canAdd()? `<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''}
      </div>
      <div class="table-wrap" data-section="products" style="margin-top:8px">
        <table class="table">
          <thead><tr><th>Name</th><th>Barcode</th><th class="num">Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><span class="clicky" data-card="${it.id}">${it.name}</span></td>
                <td>${it.barcode||''}</td>
                <td class="num">${USD(it.price)}</td>
                <td>${it.type||'-'}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>`;
}
function wireProducts(){
  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value='';
    $('#prod-price').value=''; $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });

  const sec = $('[data-section="products"]'); if(!sec) return;

  sec.addEventListener('click', (e)=>{
    const link = e.target.closest('[data-card]'); // product details
    if (link){
      const id = link.getAttribute('data-card');
      const it = (state.products||[]).find(x=>x.id===id); if(!it) return;
      $('#pc-name').textContent=it.name;
      $('#pc-barcode').textContent=it.barcode||'-';
      $('#pc-price').textContent=USD(it.price);
      $('#pc-type').textContent=it.type||'-';
      $('#pc-ingredients').textContent=it.ingredients||'-';
      $('#pc-instructions').textContent=it.instructions||'-';
      openModal('m-card');
      return;
    }

    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if(!id) return;

    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const it = (state.products||[]).find(x=>x.id===id); if(!it) return;
      openModal('m-prod');
      $('#prod-id').value=it.id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price; $('#prod-type').value=it.type||'';
      $('#prod-ingredients').value=it.ingredients||''; $('#prod-instructions').value=it.instructions||'';
    } else {
      if(!canDelete()) return notify('No permission');
      state.products = (state.products||[]).filter(x=>x.id!==id);
      saveKV('products', state.products); renderApp();
    }
  });
}

/* COGS */
function viewCOGS(){
  const rows = state.cogs || [];
  const gp = (r)=> (+r.grossIncome||0) - ((+r.produceCost||0) + (+r.itemCost||0) + (+r.freight||0) + (+r.other||0)); // delivery removed
  const totals = rows.reduce((a,r)=>({
    grossIncome:a.grossIncome+(+r.grossIncome||0), produceCost:a.produceCost+(+r.produceCost||0),
    itemCost:a.itemCost+(+r.itemCost||0), freight:a.freight+(+r.freight||0), other:a.other+(+r.other||0)
  }), {grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});

  const totalProfit = gp(totals);

  return `
    <div class="card"><div class="card-body">
      <div class="space-between">
        <h3 style="margin:0">COGS</h3>
        <div class="flex">
          <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
          ${canAdd()? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
        </div>
      </div>
      <div class="table-wrap" data-section="cogs" style="margin-top:8px">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th><th class="num">G-Income</th><th class="num">Produce</th><th class="num">Item</th><th class="num">Freight</th><th class="num">Other</th><th class="num">G-Profit</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td>
                <td class="num">${USD(r.grossIncome)}</td>
                <td class="num">${USD(r.produceCost)}</td>
                <td class="num">${USD(r.itemCost)}</td>
                <td class="num">${USD(r.freight)}</td>
                <td class="num">${USD(r.other)}</td>
                <td class="num">${USD(gp(r))}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
            <tr class="tr-total">
              <th>Total</th>
              <th class="num">${USD(totals.grossIncome)}</th>
              <th class="num">${USD(totals.produceCost)}</th>
              <th class="num">${USD(totals.itemCost)}</th>
              <th class="num">${USD(totals.freight)}</th>
              <th class="num">${USD(totals.other)}</th>
              <th class="num">${USD(totalProfit)}</th>
              <th></th>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Quick month/year navigator -->
      <div class="card" style="margin-top:12px"><div class="card-body grid cols-3">
        <div>
          <label style="font-size:12px;color:var(--muted)">Jump to month</label>
          <input id="cogs-month" type="month" class="input"/>
        </div>
        <div class="flex" style="align-items:flex-end">
          <button class="btn" id="filter-cogs">Filter</button>
          <button class="btn secondary" id="reset-cogs">Reset</button>
        </div>
        <div style="align-self:end;color:var(--muted);font-size:12px">Filter applies to export too.</div>
      </div></div>

    </div></div>`;
}
function wireCOGS(){
  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-cogs');
    $('#cogs-id').value='';
    $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-other').value='';
  });

  $('#export-cogs')?.addEventListener('click', ()=>{
    const headers = ['id','date','grossIncome','produceCost','itemCost','freight','other'];
    const rows = state.cogs || [];
    const csv = [headers.join(',')].concat(rows.map(r=> headers.map(h=>{
      const v = (r[h]===undefined||r[h]===null)?'':String(r[h]); const needs = /[",\n]/.test(v); const esc=v.replace(/"/g,'""'); return needs?`"${esc}"`:esc;
    }).join(','))).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='cogs.csv'; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV');
  });

  $('#filter-cogs')?.addEventListener('click', ()=>{
    const ym = ($('#cogs-month')?.value || ''); if(!ym) return notify('Pick a month');
    const [y,m] = ym.split('-').map(x=>+x);
    const rows = (state.cogs||[]).filter(r=>{
      const d = r.date || ''; const yy=+d.slice(0,4), mm=+d.slice(5,7); return (yy===y && mm===m);
    });
    state.__cogsFilter = rows;
    renderApp();
    notify('Filtered COGS');
  });
  $('#reset-cogs')?.addEventListener('click', ()=>{
    delete state.__cogsFilter; renderApp(); notify('Filter cleared');
  });

  const sec = $('[data-section="cogs"]'); if(!sec) return;
  sec.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if(!id) return;
    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const r=(state.cogs||[]).find(x=>x.id===id); if(!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=r.id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
      $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-other').value=r.other;
    } else {
      if(!canDelete()) return notify('No permission');
      state.cogs = (state.cogs||[]).filter(x=>x.id!==id);
      saveKV('cogs', state.cogs); renderApp();
    }
  });
}

/* Tasks (DnD to empty lanes supported) */
function viewTasks(){
  const items = state.tasks || [];
  const lane = (key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div class="space-between" style="margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="grid lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
              <div class="card-body space-between">
                <div>${t.title}</div>
                <div>
                  ${canEdit()? `<button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  const rows = [
    lane('todo','To do','#f59e0b'),
    lane('inprogress','In progress','#60a5fa'),
    lane('done','Done','#34d399')
  ].join('');
  return `<div data-section="tasks">${rows}</div>`;
}
function wireTasks(){
  $('#addTask')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo';
  });

  const saveBtn=$('#save-task');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', ()=>{
      const items=state.tasks||[];
      const id=$('#task-id').value || ('t_'+Date.now());
      const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
      if(!obj.title) return notify('Title required');
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else { if(!canAdd()) return notify('No permission'); items.push(obj); }
      state.tasks=items; saveKV('tasks', items); closeModal('m-task'); notify('Saved'); renderApp();
    });
  }

  const root=$('[data-section="tasks"]'); if(!root) return;
  root.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const t=(state.tasks||[]).find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      if(!canDelete()) return notify('No permission');
      state.tasks=(state.tasks||[]).filter(x=>x.id!==id); saveKV('tasks', state.tasks); notify('Deleted'); renderApp();
    }
  });

  // DnD
  setupDnD();
}
function setupDnD(){
  const root=$('[data-section="tasks"]'); if(!root) return;
  root.querySelectorAll('.task-card').forEach(card=>{
    card.setAttribute('draggable','true');
    card.addEventListener('dragstart',(e)=>{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.dataset.task); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  root.querySelectorAll('.lane-grid').forEach(grid=>{
    const row = grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    grid.addEventListener('dragenter', show);
    grid.addEventListener('dragover',  show);
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop',(e)=>{
      e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return; if(!canAdd()) return notify('No permission');
      const items=state.tasks||[]; const t=items.find(x=>x.id===id); if(!t) return; t.status=lane; saveKV('tasks', items); renderApp();
    });
  });
}

/* Settings + Users (with roles) */
function viewSettings(){
  const theme = state.theme || {mode:'sky', size:'medium'};
  const role  = state.session?.role || 'user';
  const meUid = state.session?.uid || '';
  const registryList = Object.entries(state.registry||{});
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
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
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <div class="space-between" style="margin-bottom:10px">
          <h3 style="margin:0">Users</h3>
          ${canAdd()? `<button class="btn" id="addUser"><i class="ri-user-add-line"></i> Add User</button>`:''}
        </div>
        <table class="table" data-section="users">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>
            ${(state.users||[]).map(u=>`
              <tr id="${u.email}">
                <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p style="color:var(--muted);font-size:12px;margin-top:8px">This list is your tenant’s address book.</p>
      </div></div>

      <div class="card"><div class="card-body">
        <div class="space-between">
          <h3 style="margin:0">Account</h3>
          <div class="badge">Your role: ${role}</div>
        </div>
        <div class="grid cols-2" style="margin-top:8px">
          <div>
            <label style="font-size:12px;color:var(--muted)">Your UID</label>
            <input class="input" value="${meUid}" readonly/>
          </div>
          <div>
            <label style="font-size:12px;color:var(--muted)">Your Email</label>
            <input class="input" value="${state.session?.email||''}" readonly/>
          </div>
        </div>

        ${role==='admin' ? `
        <div class="card" style="margin-top:12px"><div class="card-body">
          <strong>Admin · Set Roles</strong>
          <div class="grid cols-3" style="margin-top:8px">
            <div>
              <label style="font-size:12px;color:var(--muted)">Target UID</label>
              <input id="role-uid" class="input" placeholder="Paste UID from Registry table"/>
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted)">Role</label>
              <select id="role-value" class="input"><option>user</option><option>associate</option><option>manager</option><option>admin</option></select>
            </div>
            <div style="align-self:end"><button class="btn" id="role-apply">Apply</button></div>
          </div>

          <div style="margin-top:12px">
            <div style="font-weight:700;margin-bottom:6px">Registry (UID ↔ Email)</div>
            <div class="table-wrap">
              <table class="table"><thead><tr><th>UID</th><th>Email</th><th>Name</th></tr></thead>
              <tbody>
                ${registryList.map(([id,info])=> `<tr><td>${id}</td><td>${info.email||''}</td><td>${info.name||''}</td></tr>`).join('')}
              </tbody></table>
            </div>
          </div>
        </div></div>`:''}
      </div></div>
    </div>`;
}
function wireSettings(){
  $('#theme-mode')?.addEventListener('change', (e)=>{ state.theme.mode=e.target.value; applyTheme(state.theme); });
  $('#theme-size')?.addEventListener('change', (e)=>{ state.theme.size=e.target.value; applyTheme(state.theme); });

  // Users CRUD (tenant-local)
  $('#addUser')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-user');
    $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value='';
    const sel=$('#user-role'); sel.innerHTML=['user','associate','manager','admin'].map(r=>`<option value="${r}">${r}</option>`).join(''); sel.value='user';
  });
  $('#save-user')?.addEventListener('click', ()=>{
    const users=state.users||[];
    const email=($('#user-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Email required');
    const chosen=$('#user-role')?.value||'user';
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:chosen };
    const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
    if(i>=0){ if(!canEdit()) return notify('No permission'); users[i]=obj; } else { if(!canAdd()) return notify('No permission'); users.push(obj); }
    state.users=users; saveKV('users', users); closeModal('m-user'); notify('Saved'); renderApp();
  });
  $('[data-section="users"]')?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const u=(state.users||[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-role').value=u.role;
    }else{
      if(!canDelete()) return notify('No permission');
      state.users=(state.users||[]).filter(x=>x.email!==email); saveKV('users', state.users); notify('Deleted'); renderApp();
    }
  });

  // Admin set roles
  $('#role-apply')?.addEventListener('click', async ()=>{
    const tgt = ($('#role-uid')?.value||'').trim(); const val = ($('#role-value')?.value||'user');
    if(!tgt) return notify('Target UID required');
    try{
      await db.ref(`userRoles/${tgt}`).set(val);
      notify('Role updated'); 
    }catch(e){ notify(e?.message||'Failed'); }
  });
}

/* Static pages */
const pageContent = {
  about: `
    <h3>About Inventory</h3>
    <p style="color:var(--muted)">A minimalist, mobile-first inventory & simple POS helper. Realtime sync via Firebase, offline-friendly, and built for speed.</p>
    <ul>
      <li>Manage inventory & products</li>
      <li>Track monthly COGS and export CSV</li>
      <li>Kanban-style tasks with drag & drop</li>
      <li>Per-user tenants, role-based access</li>
    </ul>
  `,
  policy: `
    <h3>Policy</h3>
    <p style="color:var(--muted)">Use this app responsibly. Your data belongs to you. We store only what you enter and your account metadata.</p>
    <ul>
      <li>Passwords are handled by Firebase Auth</li>
      <li>Data isolation per user (tenant)</li>
      <li>Export any time; delete by removing your tenant</li>
    </ul>
  `,
  license: `
    <h3>License</h3>
    <p style="color:var(--muted)">MIT License — free to use, modify, and distribute. No warranty provided.</p>
  `,
  setup: `
    <h3>Setup Guide</h3>
    <ol>
      <li>Create a Firebase project (enable <strong>Email/Password</strong> Auth)</li>
      <li>Paste your config into <code>index.html</code></li>
      <li>Deploy to Firebase Hosting</li>
      <li>Optional: set the database rules (provided in our earlier message)</li>
    </ol>
  `,
  contact: `
    <h3>Contact</h3>
    <p>Questions? Email <a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Inventory%20Support">minmaung0307@gmail.com</a>.</p>
  `,
  guide: `
    <h3>User Guide</h3>
    <p style="color:var(--muted)">Quick tips:</p>
    <ul>
      <li>Use the sidebar Search to jump anywhere</li>
      <li>Click a <strong>Product</strong> name to open details</li>
      <li>In <strong>Tasks</strong>, drag cards into any lane</li>
      <li>In <strong>COGS</strong>, use Month filter then Export</li>
      <li>Change theme & size in <strong>Settings</strong> — applies instantly</li>
    </ul>
  `
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key] || '<p>Page</p>'}</div></div>`; }

/* ---------- Search ---------- */
/* ---------- Search (deduped listeners to stop "increasing numbers") ---------- */
let __wiredSearchClose = false;
function buildSearchIndex(){ /* same as previous message */ 
  const posts=state.posts||[], inv=state.inventory||[], prods=state.products||[], cogs=state.cogs||[], users=state.users||[];
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
  cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.other}`}));
  users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p));
  return ix;
}
function searchAll(index,q){
  const norm=s=>(s||'').toLowerCase();
  const tokens=norm(q).split(/\s+/).filter(Boolean);
  return index.map(item=>{
    const label=norm(item.label), text=norm(item.text||''); let hits=0;
    const ok = tokens.every(t=>{ const hit = label.includes(t)||text.includes(t); if(hit) hits++; return hit; });
    const score = ok ? (hits*3 + (label.includes(tokens[0]||'')?2:0)) : 0;
    return { item, score };
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
}
function hookSidebarInteractions(){
  const input = $('#globalSearch'), results = $('#searchResults');
  if (!input || !results) return;

  const openResultsPage = (r)=>{
    go(r.route);
    setTimeout(()=>{ try{ const el=document.getElementById(r.id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});}catch{} }, 80);
    results.classList.remove('active');
    input.value='';
  };

  let timer;
  input.onkeydown = (e)=>{ if (e.key === 'Enter'){ const q=input.value.trim(); if(!q) return; const ix=buildSearchIndex(); const out=searchAll(ix,q); if(out[0]) openResultsPage(out[0]); } };
  input.oninput = ()=>{
    clearTimeout(timer);
    const q=input.value.trim(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer=setTimeout(()=>{
      const ix=buildSearchIndex(); const out=searchAll(ix,q).slice(0,10);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=> openResultsPage({route:row.getAttribute('data-route'), id: row.getAttribute('data-id')});
      });
    }, 150);
  };

  // Only wire this once; it always grabs the current elements by id
  if (!__wiredSearchClose){
    __wiredSearchClose = true;
    document.addEventListener('click', (e)=>{
      const rEl=document.getElementById('searchResults');
      const iEl=document.getElementById('globalSearch');
      if (!rEl || !iEl) return;
      if(!rEl.contains(e.target) && e.target !== iEl) rEl.classList.remove('active');
    });
  }
}

/* ---------- Login screen (centered + proper spacing) ---------- */
function renderLogin(){
  const root = $('#root');
  root.innerHTML = `
    <div class="login">
      <div class="card login-card">
        <div class="card-body">
          <div class="login-logo"><div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div></div>
          <p class="login-note" style="color:var(--muted)">Sign in to continue</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div class="link-row">
              <a id="link-forgot" href="#" class="btn secondary" style="padding:10px 12px"><i class="ri-key-2-line"></i> Forgot password</a>
              <a id="link-register" href="#" class="btn ghost" style="padding:10px 12px"><i class="ri-user-add-line"></i> Sign up</a>
            </div>
          </div>
        </div>
      </div>
    </div>

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
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset email</button></div>
      </div>
    </div>`;

  const openAuth = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
  const closeAuth = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

  async function doSignIn(){
    const email = ($('#li-email')?.value||'').trim().toLowerCase();
    const pass  = $('#li-pass')?.value||'';
    if(!email || !pass) return notify('Enter email & password');
    try{
      await auth.signInWithEmailAndPassword(email, pass);
      notify('Welcome');
    }catch(e){ notify(e?.message||'Login failed'); }
  }
  async function doSignup(){
    const name  = ($('#su-name')?.value||'').trim();
    const email = ($('#su-email')?.value||'').trim().toLowerCase();
    const pass  = $('#su-pass')?.value||'';
    const pass2 = ($('#su-pass2')?.value||'');
    if(!email || !pass) return notify('Email and password required');
    if(pass !== pass2) return notify('Passwords do not match');
    try{
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name || email.split('@')[0] });
      notify('Account created — signed in');
      closeAuth();
    }catch(e){ notify(e?.message||'Signup failed'); }
  }
  async function doReset(){
    const email = ($('#fp-email')?.value||'').trim().toLowerCase();
    if(!email) return notify('Enter your email');
    try{
      await auth.sendPasswordResetEmail(email);
      notify('Reset email sent'); closeAuth();
    }catch(e){ notify(e?.message||'Failed to send'); }
  }

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSignIn(); });
  $('#link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  $('#link-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  $('#cl-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#cl-reset')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

/* ---------- App render ---------- */
function renderApp(){
  const root = $('#root'); if (!root) return;
  if (!auth.currentUser){ renderLogin(); return; }

  // Shell
  root.innerHTML = `
    <div class="app">
      ${renderSidebar(state.route)}
      <div style="flex:1;display:flex;flex-direction:column">
        ${renderTopbar()}
        <div class="main" id="main">${safeView(state.route)}</div>
      </div>
    </div>`;

  // Wiring
  $('#btnLogout')?.addEventListener('click', doLogout);
  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=>{
    el.addEventListener('click', ()=> go(el.getAttribute('data-route')));
  });

  hookSidebarInteractions();
  ensureGlobalModals();

  switch(state.route){
    case 'dashboard': wireDashboard(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts(); break;
    case 'cogs':      wireCOGS(); break;
    case 'tasks':     wireTasks(); break;
    case 'settings':  wireSettings(); break;
  }
}

/* ---------- Modals markup (no images anywhere) ---------- */
(function addModals(){
  ensureGlobalModals();
  const host = document.getElementById('__modals');
  host.innerHTML = `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post">
    <div class="dialog">
      <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post" onclick="closeModal('m-post')">Close</button></div>
      <div class="body grid">
        <input id="post-id" type="hidden"/>
        <input id="post-title" class="input" placeholder="Title"/>
        <textarea id="post-body" class="input" placeholder="Body"></textarea>
      </div>
      <div class="foot"><button class="btn" id="save-post">Save</button></div>
    </div>
  </div>

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
  </div>

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
  </div>

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
  </div>

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
  </div>

  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" onclick="closeModal('m-task')">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden"/>
        <input id="task-title" class="input" placeholder="Title"/>
        <select id="task-status" class="input"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
      </div>
      <div class="foot"><button class="btn" id="save-task">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user">
    <div class="dialog">
      <div class="head"><strong>User</strong><button class="btn ghost" onclick="closeModal('m-user')">Close</button></div>
      <div class="body grid">
        <input id="user-name" class="input" placeholder="Name"/>
        <input id="user-email" class="input" type="email" placeholder="Email"/>
        <input id="user-username" class="input" placeholder="Username"/>
        <select id="user-role" class="input"></select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>
  `;
})();

/* ---------- Save handlers for modals ---------- */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#save-post,#save-inv,#save-prod,#save-cogs'); if(!btn) return;

  if (btn.id === 'save-post'){
    if(!canAdd()) return notify('No permission');
    const posts = state.posts || [];
    const id = $('#post-id').value || ('post_'+Date.now());
    const obj = { id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), createdAt: Date.now() };
    if(!obj.title) return notify('Title required');
    const i = posts.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission'); posts[i]=obj; } else posts.unshift(obj);
    state.posts = posts; saveKV('posts', posts); closeModal('m-post'); notify('Saved'); renderApp(); return;
  }

  if (btn.id === 'save-inv'){
    if(!canAdd()) return notify('No permission');
    const items = state.inventory || [];
    const id = $('#inv-id').value || ('inv_'+Date.now());
    const obj = {
      id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price:+($('#inv-price').value||0), stock:+($('#inv-stock').value||0), threshold:+($('#inv-threshold').value||0)
    };
    if(!obj.name) return notify('Name required');
    const i = items.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else items.push(obj);
    state.inventory = items; saveKV('inventory', items); closeModal('m-inv'); notify('Saved'); renderApp(); return;
  }

  if (btn.id === 'save-prod'){
    if(!canAdd()) return notify('No permission');
    const items = state.products || [];
    const id = $('#prod-id').value || ('p_'+Date.now());
    const obj = {
      id, name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(),
      price:+($('#prod-price').value||0), type:$('#prod-type').value.trim(),
      ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim()
    };
    if(!obj.name) return notify('Name required');
    const i = items.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else items.push(obj);
    state.products = items; saveKV('products', items); closeModal('m-prod'); notify('Saved'); renderApp(); return;
  }

  if (btn.id === 'save-cogs'){
    if(!canAdd()) return notify('No permission');
    const rows = state.cogs || [];
    const id = $('#cogs-id').value || ('c_'+Date.now());
    const row = {
      id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
      itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0),
      other:+($('#cogs-other').value||0)
    };
    const i = rows.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission'); rows[i]=row; } else rows.push(row);
    state.cogs = rows; saveKV('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp(); return;
  }
});

/* ---------- Auth lifecycle ---------- */
auth.onAuthStateChanged(async (user)=>{
  if (!user){
    stopLiveSync();
    state.session = null;
    renderApp();
    return;
  }
  // registry card
  try{
    await db.ref(`registry/users/${user.uid}`).set({ email: (user.email||'').toLowerCase(), name: user.displayName||user.email?.split('@')[0]||'User' });
  }catch{}

  await seedRoleIfFirstLogin();              // <-- this promotes allowlisted emails to admin on first login
  const role = await fetchRole();
  state.session = { uid: user.uid, email: (user.email||'').toLowerCase(), displayName: user.displayName||'', role };

  // hydrate from local first
  ['posts','inventory','products','tasks','cogs','users','_theme'].forEach(k=>{ const v = loadKVLocal(k, null); if (v!==null) (k==='_theme' ? state.theme=v : state[k]=v); });
  applyTheme(state.theme);

  startLiveSync();
  renderApp();
});

async function doLogout(){
  try{ await auth.signOut(); }catch{}
  stopLiveSync();
  state.session = null;
  renderApp();
}

/* ---------- Initial render ---------- */
renderApp();