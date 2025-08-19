/* =========================
   Inventory — Single-file SPA (Cloud-first, no images, no videos)
   ========================= */

/* ---------- Tiny utils ---------- */
function USD(x){ return `$${Number(x || 0).toFixed(2)}`; }
function parseYMD(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

/* ---------- Notifications ---------- */
function notify(msg,type='ok'){
  const n=$('#notification'); if(!n) return;
  n.textContent=msg; n.className=`notification show ${type}`;
  setTimeout(()=>{ n.className='notification'; },2200);
}

/* =========================
   Firebase bootstrap
   ========================= */
if (!window.__FIREBASE_CONFIG) {
  console.error('Missing window.__FIREBASE_CONFIG in index.html');
}
firebase.initializeApp(window.__FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.database();

/* ---------- Simple global state (always synced from RTDB) ---------- */
const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
const state = {
  inventory: [],
  products:  [],
  posts:     [],
  tasks:     [],
  cogs:      [],
  users:     [],
  _theme2:   { mode:'aqua', size:'medium' }
};
let session = null;         // current user profile (from "users" collection)
let currentRoute = 'home';
let searchQuery  = '';

/* ---------- DB helpers ---------- */
function uid(){ return auth.currentUser ? auth.currentUser.uid : null; }
function pathFor(key){ return `tenants/${uid()}/${key}`; }
async function save(key, val){
  if (!uid()) { notify('Sign in first','warn'); return; }
  state[key] = val;
  try{ await db.ref(pathFor(key)).set(val); }
  catch(e){ console.warn('[save]', key, e); notify(e?.message || 'Save failed','danger'); }
}
function subscribeAll(){
  if(!uid()) return;
  CLOUD_KEYS.forEach(key=>{
    db.ref(pathFor(key)).on('value', (snap)=>{
      const v = snap.val();
      if (v === null || v === undefined) {
        // initialize empty arrays / defaults the first time
        if (Array.isArray(state[key])) db.ref(pathFor(key)).set([]);
        else if (key==='_theme2') db.ref(pathFor(key)).set(state._theme2);
        return;
      }
      state[key] = v;
      if (key === '_theme2') applyTheme();
      renderApp();
    });
  });
}
function unsubscribeAll(){
  if(!uid()) return;
  CLOUD_KEYS.forEach(key=> db.ref(pathFor(key)).off());
}

/* ---------- Theme ---------- */
const THEME_MODES = [{key:'light',name:'Light'},{key:'dark',name:'Dark'},{key:'aqua',name:'Aqua'}];
const THEME_SIZES = [{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}];

function applyTheme(){
  const t = state._theme2 || { mode:'aqua', size:'medium' };
  const sizePct = (THEME_SIZES.find(s => s.key === t.size)?.pct) ?? 100;
  const mode = THEME_MODES.some(m => m.key === t.mode) ? t.mode : 'aqua';
  document.documentElement.setAttribute('data-theme', mode==='light' ? 'light' : (mode==='dark' ? 'dark' : ''));
  document.documentElement.style.setProperty('--font-scale', sizePct + '%');
}

/* =========================
   Roles / permissions
   ========================= */
const ROLES = ['user','associate','manager','admin'];
const SUPER_ADMINS = ['admin@inventory.com','minmaung0307@gmail.com'];
function role(){ return (session?.role)||'user'; }
function canAdd(){ return ['admin','manager','associate'].includes(role()); }
function canEdit(){ return ['admin','manager'].includes(role()); }
function canDelete(){ return ['admin'].includes(role()); }

/* =========================
   Auth + first-load defaults
   ========================= */
auth.onAuthStateChanged(async (user)=>{
  if (!user){
    session = null;
    renderLogin();
    return;
  }
  // ensure persistence (avoid IndexedDB issues by falling back to SESSION if unavailable)
  try{
    const test = indexedDB.open('__inv_test__');
    await new Promise(res=>{
      test.onsuccess=()=>{ try{ test.result.close(); indexedDB.deleteDatabase('__inv_test__'); }catch{}; res(); };
      test.onerror=()=> res();
    });
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  }catch{}

  // make sure we have a profile row for this user
  const email = (user.email||'').toLowerCase();
  const usersOnce = await db.ref(pathFor('users')).get();
  let users = usersOnce.val() || [];
  let me = users.find(u => (u.email||'').toLowerCase() === email);
  if (!me){
    me = {
      name: user.displayName || email.split('@')[0],
      username: email.split('@')[0],
      email, role: SUPER_ADMINS.includes(email) ? 'admin' : 'user',
      contact:''
    };
    users.push(me);
    await save('users', users);
  }
  session = me;

  // seed sample data if missing
  const invOnce = await db.ref(pathFor('inventory')).get();
  if (!invOnce.exists()){
    const now = Date.now();
    const uname = email.split('@')[0];
    await save('inventory', [
      { id:'inv_'+now,     name:`${uname} Rice`,  code:'RIC-001', type:'Dry', price:1.20, stock:25, threshold:8 },
      { id:'inv_'+(now+1), name:`${uname} Salmon`, code:'SAL-201', type:'Raw', price:8.50, stock:12, threshold:6 }
    ]);
  }
  const prodOnce = await db.ref(pathFor('products')).get();
  if (!prodOnce.exists()){
    const now = Date.now();
    await save('products', [
      { id:'p_'+now, name:'Sample Roll', barcode:'1001001', price:7.99, type:'Roll', ingredients:'Rice,Nori,Salmon', instructions:'8 pcs' }
    ]);
  }
  const postsOnce = await db.ref(pathFor('posts')).get();
  if (!postsOnce.exists()){
    await save('posts', [{ id:'post_'+Date.now(), title:'Welcome!', body:'This is your workspace. Start adding inventory, products and tasks.', createdAt: Date.now() }]);
  }
  const tasksOnce = await db.ref(pathFor('tasks')).get();
  if (!tasksOnce.exists()){
    await save('tasks', [{ id:'t_'+Date.now(), title:'Sample task', status:'todo' }]);
  }
  const cogsOnce = await db.ref(pathFor('cogs')).get();
  if (!cogsOnce.exists()){
    await save('cogs',  [ { id:'c_'+Date.now(), date: new Date().toISOString().slice(0,10), grossIncome:900, produceCost:220, itemCost:130, freight:20, delivery:15, other:8 } ]);
  }
  const themeOnce = await db.ref(pathFor('_theme2')).get();
  if (!themeOnce.exists()){
    await save('_theme2', { mode:'aqua', size:'medium' });
  }

  subscribeAll();
  currentRoute = 'home';
  renderApp();
});

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
    { route:'guide',   icon:'ri-book-2-line',             label:'User Guide' },
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

      <h6 class="menu-caption">MENU</h6>
      <div class="nav">
        ${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}
      </div>

      <h6 class="links-caption">PAGES</h6>
      <div class="links">
        ${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}
      </div>

      <h6 class="social-caption">SOCIAL</h6>
      <div class="socials-row">
        <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left" style="display:flex;align-items:center;gap:10px">
        <div><strong>${(currentRoute||'home').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      </div>
      <div class="right">
        <button class="btn ghost" id="btnHome"><i class="ri-home-5-line"></i> Home</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>`;
}

/* delegated nav */
document.addEventListener('click', (e)=>{
  const item = e.target.closest('.sidebar .item[data-route]');
  if (!item) return; go(item.getAttribute('data-route'));
});
function go(route){ currentRoute=route; renderApp(); }

/* ===================== Pages ===================== */
function viewHome(){
  return `
    <div class="grid cols-4">
      <div class="card tile" data-route="inventory"><div class="card-body" style="text-align:center"><i class="ri-archive-2-line" style="font-size:28px"></i><div>Inventory</div></div></div>
      <div class="card tile" data-route="products"><div class="card-body" style="text-align:center"><i class="ri-store-2-line" style="font-size:28px"></i><div>Products</div></div></div>
      <div class="card tile" data-route="cogs"><div class="card-body" style="text-align:center"><i class="ri-money-dollar-circle-line" style="font-size:28px"></i><div>COGS</div></div></div>
      <div class="card tile" data-route="tasks"><div class="card-body" style="text-align:center"><i class="ri-list-check-2" style="font-size:28px"></i><div>Tasks</div></div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <h3 style="margin:6px 0 12px">Quick stats</h3>
        <div class="grid cols-4">
          <div class="card tile"><div class="card-body"><div>Total Items</div><h2 style="margin:6px 0">${(state.inventory||[]).length}</h2></div></div>
          <div class="card tile"><div class="card-body"><div>Products</div><h2 style="margin:6px 0">${(state.products||[]).length}</h2></div></div>
          <div class="card tile"><div class="card-body"><div>Users</div><h2 style="margin:6px 0">${(state.users||[]).length}</h2></div></div>
          <div class="card tile"><div class="card-body"><div>Tasks</div><h2 style="margin:6px 0">${(state.tasks||[]).length}</h2></div></div>
        </div>
      </div>
    </div>`;
}

function viewSearch(){
  const q=(searchQuery||'').trim().toLowerCase();
  const ix = buildSearchIndex();
  const out = q ? searchAll(ix, q) : [];
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

function viewDashboard(){
  const inv=state.inventory||[], prods=state.products||[], users=state.users||[], tasks=state.tasks||[], cogs=state.cogs||[];
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  const totals=cogs.reduce((a,r)=>({grossIncome:a.grossIncome+(+r.grossIncome||0),produceCost:a.produceCost+(+r.produceCost||0),itemCost:a.itemCost+(+r.itemCost||0),freight:a.freight+(+r.freight||0),delivery:a.delivery+(+r.delivery||0),other:a.other+(+r.other||0)}),{grossIncome:0,produceCost:0,itemCost:0,freight:0,delivery:0,other:0});
  const totalProfit=gp(totals);

  return `
    <div class="grid cols-4">
      <div class="card tile" data-route="inventory"><div>Total Items</div><h2>${inv.length}</h2></div>
      <div class="card tile" data-route="products"><div>Products</div><h2>${prods.length}</h2></div>
      <div class="card tile" data-route="settings"><div>Users</div><h2>${users.length}</h2></div>
      <div class="card tile" data-route="tasks"><div>Tasks</div><h2>${tasks.length}</h2></div>
    </div>

    <div class="grid cols-4" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn); background:rgba(245,158,11,.08)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger); background:rgba(239,68,68,.10)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>
      <div class="card" style="grid-column: span 2"><div class="card-body">
        <strong>COGS Summary</strong>
        <div style="margin-top:6px"><span style="color:var(--muted)">Gross Income:</span> <strong>${USD(totals.grossIncome)}</strong></div>
        <div><span style="color:var(--muted)">Total Costs:</span> ${USD(totals.produceCost+totals.itemCost+totals.freight+totals.delivery+totals.other)}</div>
        <div><span style="color:var(--muted)">Gross Profit:</span> <strong>${USD(totalProfit)}</strong></div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
          ${(state.posts||[]).map(p=>`
            <div class="card" id="${p.id}">
              <div class="card-body">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div></div>
                  <div>
                    ${canEdit()?`<button class="btn ghost" data-edit="${p.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()?`<button class="btn danger" data-del="${p.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
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
  $('#addPost')?.addEventListener('click', ()=> openModal('m-post'));
}
function wirePosts(){
  const sec=document.querySelector('[data-section="posts"]'); if(!sec) return;
  $('#save-post')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const posts=[...(state.posts||[])];
    const id=$('#post-id').value || ('post_'+Date.now());
    const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), createdAt: Date.now() };
    if(!obj.title){ notify('Title required','warn'); return; }
    const i=posts.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); posts[i]=obj; } else posts.unshift(obj);
    await save('posts', posts); closeModal('m-post'); notify('Saved'); renderApp();
  });
  sec.addEventListener('click', async (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
    if (b.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const p=(state.posts||[]).find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    } else {
      if(!canDelete()) return notify('No permission','warn');
      await save('posts', (state.posts||[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
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
function viewInventory(){
  const items=state.inventory||[];
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
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Price</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>{
              const isLow = it.stock <= it.threshold;
              const isCrit= it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
              const trClass = isCrit ? 'tr-crit' : (isLow ? 'tr-warn' : '');
              return `<tr id="${it.id}" class="${trClass}">
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
  $('#export-inventory')?.addEventListener('click',()=> downloadCSV('inventory.csv', (state.inventory||[]), ['id','name','code','type','price','stock','threshold']));
  $('#addInv')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });
  $('#save-inv')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const items=[...(state.inventory||[])];
    const id=$('#inv-id').value || ('inv_'+Date.now());
    const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0') };
    if(!obj.name){ notify('Name required','warn'); return; }
    const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    await save('inventory', items); closeModal('m-inv'); notify('Saved'); renderApp();
  });
  sec.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const items=[...(state.inventory||[])];
    const get=id=>items.find(x=>x.id===id);

    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const id=btn.getAttribute('data-edit'); const it=get(id); if(!it) return;
      openModal('m-inv');
      $('#inv-id').value=id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold;
      return;
    }
    if(btn.hasAttribute('data-del')){
      if(!canDelete()) return notify('No permission','warn');
      const id=btn.getAttribute('data-del');
      await save('inventory', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp(); return;
    }
    const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
    if(!id) return; if(!canAdd()) return notify('No permission','warn');
    const it=get(id); if(!it) return;
    if(btn.hasAttribute('data-inc')) it.stock++;
    if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
    if(btn.hasAttribute('data-inc-th')) it.threshold++;
    if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
    await save('inventory', items); renderApp();
  });
}

/* ===================== Products ===================== */
function viewProducts(){
  const items=state.products||[];
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
          <thead><tr><th>Name</th><th>Barcode</th><th>Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
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
  $('#export-products')?.addEventListener('click',()=> downloadCSV('products.csv', (state.products||[]), ['id','name','barcode','price','type','ingredients','instructions']));
  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });

  $('#save-prod')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const items=[...(state.products||[])];
    const id=$('#prod-id').value || ('p_'+Date.now());
    const obj={
      id,
      name:$('#prod-name').value.trim(),
      barcode:$('#prod-barcode').value.trim(),
      price:parseFloat($('#prod-price').value||'0'),
      type:$('#prod-type').value.trim(),
      ingredients:$('#prod-ingredients').value.trim(),
      instructions:$('#prod-instructions').value.trim()
    };
    if(!obj.name){ notify('Name required','warn'); return; }
    const i=items.findIndex(x=>x.id===id);
    if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    await save('products', items);
    closeModal('m-prod'); notify('Saved'); renderApp();
  });

  sec.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items=[...(state.products||[])];
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const it=items.find(x=>x.id===id); if(!it) return;
      openModal('m-prod');
      $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
      $('#prod-instructions').value=it.instructions||'';
    }else{
      if(!canDelete()) return notify('No permission','warn');
      await save('products', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
}

/* ===================== COGS ===================== */
function viewCOGS(){
  const rows=state.cogs||[];
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
  $('#export-cogs')?.addEventListener('click',()=> downloadCSV('cogs.csv', (state.cogs||[]), ['id','date','grossIncome','produceCost','itemCost','freight','delivery','other']));
  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-delivery').value=''; $('#cogs-other').value='';
  });
  $('#save-cogs')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const rows=[...(state.cogs||[])];
    const id=$('#cogs-id').value || ('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
      itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0),
      delivery:+($('#cogs-delivery').value||0), other:+($('#cogs-other').value||0) };
    const i=rows.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); rows[i]=row; } else rows.push(row);
    await save('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp();
  });
  sec.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const r=(state.cogs||[]).find(x=>x.id===id); if(!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
      $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight;
      $('#cogs-delivery').value=r.delivery; $('#cogs-other').value=r.other;
    }else{
      if(!canDelete()) return notify('No permission','warn');
      await save('cogs', (state.cogs||[]).filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });
}

/* ===================== Tasks (DnD; tap-to-advance on mobile) ===================== */
function viewTasks(){
  const items=state.tasks||[];
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

  $('#save-task')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const items=[...(state.tasks||[])];
    const id=$('#task-id').value || ('t_'+Date.now());
    const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
    if(!obj.title){ notify('Title required','warn'); return; }
    const i=items.findIndex(x=>x.id===id); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
    await save('tasks', items); closeModal('m-task'); notify('Saved'); renderApp();
  });

  root.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items=[...(state.tasks||[])];
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const t=items.find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      if(!canDelete()) return notify('No permission','warn');
      await save('tasks', items.filter(x=>x.id!==id)); notify('Deleted'); renderApp();
    }
  });

  setupDnD();
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click', async (e)=>{
        if (e.target.closest('button')) return;
        if (!canAdd()) return notify('No permission','warn');
        const id=card.getAttribute('data-task'); const items=[...(state.tasks||[])]; const t=items.find(x=>x.id===id); if(!t) return;
        const next=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        t.status=next; await save('tasks',items); renderApp();
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
    grid.addEventListener('drop', async (e)=>{
      e.preventDefault(); hide(); if(!lane) return;
      if (!canAdd()) return notify('No permission','warn');
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const items=[...(state.tasks||[])]; const t=items.find(x=>x.id===id); if(!t) return;
      t.status=lane; await save('tasks',items); renderApp();
    });
  });
}

/* ===================== Settings / Users ===================== */
function viewSettings(){
  const users=state.users||[]; const theme=state._theme2 || {mode:'aqua', size:'medium'};
  return `
    <div class="grid">
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
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr id="${u.email}">
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
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=async ()=>{
    const t = { mode:mode.value, size:size.value };
    await save('_theme2', t); applyTheme(); renderApp();
  };
  mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

  // Users
  const addBtn=$('#addUser'); const table=document.querySelector('[data-section="users"]');
  addBtn?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-user');
    $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value='';
    const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts[0];
  });
  $('#save-user')?.addEventListener('click', async ()=>{
    if(!canAdd()) return notify('No permission','warn');
    const users=[...(state.users||[])];
    const email=($('#user-email')?.value||'').trim().toLowerCase();
    if(!email){ notify('Email required','warn'); return; }
    const allowed=allowedRoleOptions(); const chosen=($('#user-role')?.value||'user'); if(!allowed.includes(chosen)){ notify('Role not allowed','warn'); return; }
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:chosen, contact:'' };
    const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
    if(i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);
    await save('users', users); closeModal('m-user'); notify('Saved'); renderApp();
  });

  table?.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const u=(state.users||[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username;
      const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value= opts.includes(u.role) ? u.role : 'user';
    }else{
      if(!canDelete()) return notify('No permission','warn');
      await save('users', (state.users||[]).filter(x=>x.email!==email)); notify('Deleted'); renderApp();
    }
  });
}

/* ===================== Static pages / Search ===================== */
const pageContent = {
  about:  `<h3>About Inventory</h3><p style="color:var(--muted)">A fast, cloud-only, offline-friendly app to manage stock, products, costs and tasks.</p>`,
  policy: `<h3>Policy (MIT)</h3><p style="color:var(--muted)">Use freely under the MIT license.</p>`,
  license:`<h3>License</h3><p style="color:var(--muted)">MIT License — see repository for details.</p>`,
  setup:  `<h3>Setup Guide</h3><p style="color:var(--muted)">Fill your Firebase config in <code>index.html</code>, then deploy or open locally.</p>`,
  guide:  `<h3>User Guide</h3><ul><li>Add inventory, products, tasks from their pages.</li><li>All data saves directly to Firebase.</li></ul>`,
  contact:`<h3>Contact</h3><p style="color:var(--muted)">Email: <a href="mailto:minmaung0307@gmail.com">minmaung0307@gmail.com</a></p>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key]||'<p>Page</p>'}</div></div>`; }

function buildSearchIndex(){
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
  cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.delivery} ${r.other}`}));
  users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
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

/* ===================== Login + Modals + Render ===================== */
function renderLogin(){
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login" style="max-width:420px;margin:48px auto">
      <div class="card login-card">
        <div class="card-body">
          <div class="login-logo" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div>
          </div>
          <p class="login-note" style="color:var(--muted);margin-top:0">Sign in to continue</p>
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
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset</button></div>
      </div>
    </div>`;

  const openAuth = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
  const closeAuth = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

  async function doSignIn(){
    const email = ($('#li-email')?.value || '').trim().toLowerCase();
    const pass  = $('#li-pass')?.value || '';
    if (!email || !pass) return notify('Enter email & password','warn');
    try{
      await auth.signInWithEmailAndPassword(email, pass);
      notify('Welcome!');
    }catch(e){ notify(e?.message || 'Login failed','danger'); }
  }
  async function doSignup(){
    const name  = ($('#su-name')?.value || '').trim();
    const email = ($('#su-email')?.value || '').trim().toLowerCase();
    const pass  = $('#su-pass')?.value  || '';
    const pass2 = ($('#su-pass2')?.value || '');
    if (!email || !pass) return notify('Email and password are required','warn');
    if (pass !== pass2)  return notify('Passwords do not match','warn');
    try{
      await auth.createUserWithEmailAndPassword(email, pass);
      try { await auth.currentUser.updateProfile({ displayName: name || email.split('@')[0] }); } catch {}
      notify('Account created — you are signed in'); closeAuth();
    }catch(e){ notify(e?.message || 'Sign up failed','danger'); }
  }
  async function doReset(){
    const email = ($('#fp-email')?.value || '').trim().toLowerCase();
    if (!email) return notify('Enter your email','warn');
    try{
      await auth.sendPasswordResetEmail(email);
      notify('Reset email sent — check your inbox','ok'); closeAuth();
    }catch(e){ notify(e?.message || 'Reset failed','danger'); }
  }

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSignIn(); });
  $('#link-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  $('#link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  $('#cl-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#cl-reset')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

function renderApp(){
  const root = document.getElementById('root'); if (!root) return;
  if (!auth.currentUser){ renderLogin(); return; }
  const route = currentRoute || 'home';
  root.innerHTML = `
    <div class="app">
      ${renderSidebar(route)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">${safeView(route)}</div>
      </div>
    </div>

    ${modalsHTML()}
  `;
  wireRoute(route);
}

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
  $('#btnLogout')?.addEventListener('click', async ()=>{ try{ unsubscribeAll(); await auth.signOut(); }catch{} renderLogin(); });
  $('#btnHome')?.addEventListener('click', ()=>go('home'));

  // search
  const input=$('#globalSearch'), results=$('#searchResults');
  if (input && results){
    const openResultsPage = (q)=>{ searchQuery=q; if (currentRoute !== 'search') go('search'); else renderApp(); };
    let t;
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); results.classList.remove('active'); input.blur(); } }});
    input.addEventListener('input', ()=>{
      clearTimeout(t);
      const q = input.value.trim().toLowerCase();
      if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
      t=setTimeout(()=>{
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
            openResultsPage(label); results.classList.remove('active'); input.value='';
            if (id) setTimeout(()=> scrollToRow(id),80);
          };
        });
      },120);
    });
    document.addEventListener('click', (e)=>{ if (!results.contains(e.target) && e.target !== input){ results.classList.remove('active'); } });
  }

  document.querySelectorAll('[data-route]').forEach(el=>{
    el.addEventListener('click', ()=> go(el.getAttribute('data-route')));
  });

  // page-specific wiring
  switch(route||'home'){
    case 'dashboard': wireDashboard(); wirePosts(); break;
    case 'inventory': wireInventory(); break;
    case 'products': wireProducts(); break;
    case 'cogs': wireCOGS(); break;
    case 'tasks': wireTasks(); break;
    case 'settings': wireSettings(); break;
  }
}

/* ---------- Modals (no image fields anywhere) ---------- */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }
function modalsHTML(){ return `
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
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv" onclick="closeModal('m-inv')">Close</button></div>
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
      <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod" onclick="closeModal('m-prod')">Close</button></div>
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

  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs">
    <div class="dialog">
      <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs" onclick="closeModal('m-cogs')">Close</button></div>
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
  </div>

  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task" onclick="closeModal('m-task')">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden"/>
        <input id="task-title" class="input" placeholder="Title"/>
        <select id="task-status"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
      </div>
      <div class="foot"><button class="btn" id="save-task">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user">
    <div class="dialog">
      <div class="head"><strong>User</strong><button class="btn ghost" data-close="m-user" onclick="closeModal('m-user')">Close</button></div>
      <div class="body grid">
        <input id="user-name" class="input" placeholder="Name"/>
        <input id="user-email" class="input" type="email" placeholder="Email"/>
        <input id="user-username" class="input" placeholder="Username"/>
        <select id="user-role"></select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>
`; }

function scrollToRow(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

/* ---------- Initial render ---------- */
renderLogin();