/* =========================
   Inventory — No-Image SPA
   ========================= */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const USD = (x)=> `$${Number(x||0).toFixed(2)}`;
function notify(msg){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className='notification show'; setTimeout(()=> n.className='notification', 2000); }

/* ---------- Firebase bootstrap ---------- */
const firebaseConfig = window.__FIREBASE_CONFIG || null;
if (!firebase || !firebase.initializeApp) { alert('Firebase SDK missing.'); }
if (firebase && firebase.apps && firebase.apps.length === 0 && firebaseConfig) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

/* ---------- Cloud KV per-user ---------- */
const CLOUD_KEYS = ['inventory','products','posts','tasks','cogs','users','theme'];
const pathFor = (uid, k)=> db.ref(`tenants/${uid}/kv/${k}`);

async function cloudSave(k, val){
  const uid = auth.currentUser?.uid; if(!uid) return;
  try{ await pathFor(uid,k).set({ key:k, val, updatedAt: firebase.database.ServerValue.TIMESTAMP }); }
  catch(e){ console.warn('[save]', k, e); notify(e?.message || 'Cloud save failed'); }
}
async function cloudLoadAll(){
  const uid = auth.currentUser?.uid; if(!uid) return {};
  const snap = await db.ref(`tenants/${uid}/kv`).get();
  const out = {}; if (!snap.exists()) return out;
  Object.values(snap.val()).forEach(row=>{ if(row && row.key) out[row.key]=row.val; });
  return out;
}
function cloudSubscribeAll(onUpdate){
  const uid = auth.currentUser?.uid; if(!uid) return [];
  const subs = [];
  CLOUD_KEYS.forEach(k=>{
    const ref = pathFor(uid,k);
    ref.on('value', s=>{
      const d=s.val(); if (!d) return;
      onUpdate(k, d.val);
    });
    subs.push(ref);
  });
  return subs;
}
function cloudUnsubAll(subs){ (subs||[]).forEach(r=>{ try{ r.off(); }catch{} }); }

/* ---------- Theme ---------- */
const THEMES = [
  {key:'sky', name:'Sky Blue'},
  {key:'sunrise', name:'Soft Orange'},
  {key:'mint', name:'Soft Green'},
  {key:'graphite', name:'Graphite Dark'}
];
const SIZES = [
  {key:'small', pct:90, label:'Small'},
  {key:'medium', pct:100, label:'Medium'},
  {key:'large', pct:112, label:'Large'}
];
function applyTheme(theme){
  const t = theme || { mode:'sky', size:'medium' };
  const validMode = THEMES.find(x=>x.key===t.mode)?.key || 'sky';
  const pct = SIZES.find(x=>x.key===t.size)?.pct || 100;
  document.documentElement.setAttribute('data-theme', validMode);
  document.documentElement.style.setProperty('--font-scale', pct + '%');
}
function themeControls(){
  const theme = state.theme || { mode:'sky', size:'medium' };
  return `
    <div class="grid cols-2">
      <div>
        <label style="font-size:12px;color:var(--muted)">Color theme</label>
        <select id="theme-mode" class="input">
          ${THEMES.map(t=>`<option value="${t.key}" ${theme.mode===t.key?'selected':''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:12px;color:var(--muted)">Font size</label>
        <select id="theme-size" class="input">
          ${SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>`;
}
function wireThemeControls(){
  const mode=$('#theme-mode'), size=$('#theme-size');
  const apply=async ()=>{
    state.theme = { mode: mode.value, size: size.value };
    applyTheme(state.theme);                   // Instant change (no reload)
    await cloudSave('theme', state.theme);
    notify('Theme updated');
  };
  mode?.addEventListener('change', apply);
  size?.addEventListener('change', apply);
}

/* ---------- Global state ---------- */
let state = {
  route: 'dashboard',
  searchQ: '',
  theme: { mode:'sky', size:'medium' },
  inventory: [],
  products: [],
  posts: [],
  tasks: [],
  cogs: [],
  users: []
};
let subs = [];

/* ---------- Navigation & Shell ---------- */
function renderSidebar(active='dashboard'){
  const links = [
    { route:'dashboard', icon:'ri-dashboard-line', label:'Dashboard' },
    { route:'inventory', icon:'ri-archive-2-line', label:'Inventory' },
    { route:'products',  icon:'ri-store-2-line',   label:'Products' },
    { route:'cogs',      icon:'ri-money-dollar-circle-line', label:'COGS' },
    { route:'tasks',     icon:'ri-list-check-2',   label:'Tasks' },
    { route:'settings',  icon:'ri-settings-3-line',label:'Settings' },
  ];
  const pages = [
    { route:'about',   icon:'ri-information-line',        label:'About' },
    { route:'policy',  icon:'ri-shield-check-line',       label:'Policy' },
    { route:'license', icon:'ri-copyright-line',          label:'License' },
    { route:'setup',   icon:'ri-guide-line',              label:'Setup' },
    { route:'contact', icon:'ri-customer-service-2-line', label:'Contact' },
    { route:'guide',   icon:'ri-book-2-line',             label:'User Guide' },
  ];
  return `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="logo">📦</div><div class="title">Inventory</div>
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

      <h6 class="links-caption">Links</h6>
      <div class="links">
        ${pages.map(p=>`<div class="item" data-route="${p.route}">
          <i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}
      </div>

      <h6 class="social-caption">Social</h6>
      <div class="socials-row">
        <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://tiktok.com"   target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com"  target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left"><strong>${state.route.replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      <div class="right">
        <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}
function renderApp(){
  const root = $('#root'); if(!root) return;
  root.innerHTML = `
    <div class="app">
      ${renderSidebar(state.route)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">${viewFor(state.route)}</div>
      </div>
    </div>`;
  wireShell();
  wireRoute(state.route);
  applyTheme(state.theme);
}
function wireShell(){
  $('#btnLogout')?.addEventListener('click', doLogout);
  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=>{
    el.addEventListener('click', ()=> go(el.getAttribute('data-route')));
  });
  hookSearch();
}
function go(route){ state.route = route; renderApp(); }

/* ---------- Search ---------- */
function buildSearchIndex(){
  const pages=[
    { id:'about',label:'About',section:'Pages',route:'about' },
    { id:'policy',label:'Policy',section:'Pages',route:'policy' },
    { id:'license',label:'License',section:'Pages',route:'license' },
    { id:'setup',label:'Setup',section:'Pages',route:'setup' },
    { id:'contact',label:'Contact',section:'Pages',route:'contact' },
    { id:'guide',label:'User Guide',section:'Pages',route:'guide' },
  ];
  const ix=[];
  state.posts.forEach(p=> ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`}));
  state.inventory.forEach(i=> ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`}));
  state.products.forEach(p=> ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`}));
  state.cogs.forEach(r=> ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.other}`}));
  state.users.forEach(u=> ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p));
  return ix;
}
function searchAll(index, q){
  const norm=s=>(s||'').toLowerCase();
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  return index.map(item=>{
      const L=norm(item.label), T=norm(item.text||''); let hits=0;
      const ok=tokens.every(t=>{ const h=L.includes(t)||T.includes(t); if(h) hits++; return h; });
      return ok ? {item,score:hits*3 + (L.includes(tokens[0]||'')?2:0)} : null;
    })
    .filter(Boolean)
    .sort((a,b)=>b.score-a.score)
    .map(x=>x.item);
}
function hookSearch(){
  const input = $('#globalSearch'), results = $('#searchResults'); if(!input||!results) return;
  let timer;
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      const q=input.value.trim(); results.classList.remove('active');
      if(q){
        const ix = buildSearchIndex();
        const out = searchAll(ix,q).slice(0,24);
        if(out.length){ const r=out[0]; state.route=r.route; renderApp(); setTimeout(()=>{ const el=document.getElementById(r.id); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); },120); }
      }
    }
  });
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q=input.value.trim().toLowerCase();
    if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer = setTimeout(()=>{
      const ix = buildSearchIndex();
      const out = searchAll(ix, q).slice(0,12);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML = out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section||''}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=>{
          results.classList.remove('active'); input.value='';
          const route=row.getAttribute('data-route'), id=row.getAttribute('data-id');
          go(route); setTimeout(()=>{ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); },100);
        };
      });
    },120);
  });
  document.addEventListener('click', (e)=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
}

/* ---------- Dashboard + Posts ---------- */
function viewDashboard(){
  const posts=state.posts, inv=state.inventory, prods=state.products, users=state.users, tasks=state.tasks, cogs=state.cogs;
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  return `
    <div class="grid cols-4">
      <div class="card tile" data-route="inventory"><div class="card-body"><div>Total Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-route="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-route="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-route="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
    </div>

    <div class="grid cols-3" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn); background:rgba(245,158,11,.08)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger); background:rgba(239,68,68,.10)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>COGS quick export</strong>
          <button class="btn ghost" id="export-cogs-quick"><i class="ri-download-2-line"></i> CSV</button>
        </div>
      </div></div>
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
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <div>
                  <strong>${p.title}</strong>
                  <div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div>
                  <p style="margin-top:6px">${p.body}</p>
                </div>
                <div>
                  <button class="btn ghost" data-edit="${p.id}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${p.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>

    ${postModal()}
  `;
}
function wireDashboard(){
  $('#export-cogs-quick')?.addEventListener('click', ()=> exportCSV('cogs.csv', state.cogs, ['id','date','grossIncome','produceCost','itemCost','other']));
  $('#addPost')?.addEventListener('click', ()=> openModal('m-post'));
  const sec = document.querySelector('[data-section="posts"]');
  sec?.addEventListener('click', async (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
    if (b.hasAttribute('data-edit')){
      const p=state.posts.find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    }else{
      state.posts = state.posts.filter(x=>x.id!==id);
      await cloudSave('posts', state.posts); notify('Deleted'); renderApp();
    }
  });
  $('#save-post')?.addEventListener('click', async ()=>{
    const id=$('#post-id').value || ('post_'+Date.now());
    const obj={ id, title:($('#post-title').value||'').trim(), body:($('#post-body').value||'').trim(), createdAt: Date.now() };
    if(!obj.title){ notify('Title required'); return; }
    const i = state.posts.findIndex(x=>x.id===id);
    if(i>=0) state.posts[i]=obj; else state.posts.unshift(obj);
    await cloudSave('posts', state.posts);
    closeModal('m-post'); notify('Saved'); renderApp();
  });
}

/* ---------- Inventory ---------- */
function viewInventory(){
  const items = state.inventory;
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
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th class="num">Price</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td><td class="num">${USD(it.price)}</td>
                <td><button class="btn ghost" data-dec="${it.id}" title="Decrease">–</button><span style="padding:0 10px">${it.stock}</span><button class="btn ghost" data-inc="${it.id}" title="Increase">+</button></td>
                <td><button class="btn ghost" data-dec-th="${it.id}" title="Decrease">–</button><span style="padding:0 10px">${it.threshold}</span><button class="btn ghost" data-inc-th="${it.id}" title="Increase">+</button></td>
                <td>
                  <button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>

    ${invModal()}
  `;
}
function wireInventory(){
  $('#export-inventory')?.addEventListener('click', ()=> exportCSV('inventory.csv', state.inventory, ['id','name','code','type','price','stock','threshold']));
  $('#addInv')?.addEventListener('click', ()=>{
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });
  const sec = document.querySelector('[data-section="inventory"]');
  sec?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del')||btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
    if(!id) return;
    const it = state.inventory.find(x=>x.id===id);
    if(btn.hasAttribute('data-edit')){
      if(!it) return; openModal('m-inv');
      $('#inv-id').value=it.id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold;
    }else if(btn.hasAttribute('data-del')){
      state.inventory = state.inventory.filter(x=>x.id!==id); await cloudSave('inventory', state.inventory); notify('Deleted'); renderApp();
    }else{
      if(!it) return;
      if(btn.hasAttribute('data-inc')) it.stock++;
      if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
      if(btn.hasAttribute('data-inc-th')) it.threshold++;
      if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
      await cloudSave('inventory', state.inventory); renderApp();
    }
  });
  $('#save-inv')?.addEventListener('click', async ()=>{
    const id=$('#inv-id').value || ('inv_'+Date.now());
    const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0') };
    if(!obj.name){ notify('Name required'); return; }
    const i = state.inventory.findIndex(x=>x.id===id);
    if(i>=0) state.inventory[i]=obj; else state.inventory.push(obj);
    await cloudSave('inventory', state.inventory);
    closeModal('m-inv'); notify('Saved'); renderApp();
  });
}

/* ---------- Products (with stylish card preview) ---------- */
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
          <thead><tr><th>Item</th><th>Barcode</th><th class="num">Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><a href="#" class="prod-card-link" data-card="${it.id}">${it.name}</a></td>
                <td>${it.barcode||''}</td><td class="num">${USD(it.price)}</td><td>${it.type||'-'}</td>
                <td>
                  <button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
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
  $('#export-products')?.addEventListener('click',()=> exportCSV('products.csv', state.products, ['id','name','barcode','price','type','ingredients','instructions']));
  $('#addProd')?.addEventListener('click', ()=>{
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });
  const sec=document.querySelector('[data-section="products"]');
  sec?.addEventListener('click', async (e)=>{
    const link = e.target.closest('.prod-card-link');
    if (link){
      e.preventDefault();
      const id = link.getAttribute('data-card'); const it = state.products.find(x=>x.id===id);
      if(it){
        $('#pc-name').textContent=it.name; $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price);
        $('#pc-type').textContent=it.type||''; $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||'';
        openModal('m-card');
      }
      return;
    }
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const it=state.products.find(x=>x.id===id); if(!it) return;
      openModal('m-prod');
      $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
      $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
      $('#prod-instructions').value=it.instructions||'';
    }else{
      state.products = state.products.filter(x=>x.id!==id);
      await cloudSave('products', state.products);
      notify('Deleted'); renderApp();
    }
  });
  $('#save-prod')?.addEventListener('click', async ()=>{
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
    if(!obj.name){ notify('Name required'); return; }
    const i=state.products.findIndex(x=>x.id===id);
    if(i>=0) state.products[i]=obj; else state.products.push(obj);
    await cloudSave('products', state.products);
    closeModal('m-prod'); notify('Saved'); renderApp();
  });
}

/* ---------- COGS with month/year tracking & right-aligned numbers ---------- */
function viewCOGS(){
  const rows = state.cogs.slice().sort((a,b)=> (a.date>b.date?1:-1));
  const now = new Date(); const y=now.getFullYear(); const m=now.getMonth()+1;
  const currentYM = `${y}-${String(m).padStart(2,'0')}`;
  const selectedYM = $('#cogs-filter')?.value || currentYM;
  const allMonths = [...new Set(rows.map(r=> r.date?.slice(0,7)).filter(Boolean))].sort();
  const filtered = rows.filter(r=> !selectedYM || r.date?.startsWith(selectedYM));

  const gp = r => (+r.grossIncome||0) - ((+r.produceCost||0)+(+r.itemCost||0)+(+r.other||0));
  const totals = filtered.reduce((a,r)=>({
    grossIncome:a.grossIncome+(+r.grossIncome||0),
    produceCost:a.produceCost+(+r.produceCost||0),
    itemCost:a.itemCost+(+r.itemCost||0),
    other:a.other+(+r.other||0)
  }), {grossIncome:0,produceCost:0,itemCost:0,other:0});
  const totalProfit = gp(totals);

  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px">
        <h3 style="margin:0">COGS</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="cogs-filter" class="input" style="min-width:160px">
            ${allMonths.map(mm=>`<option value="${mm}" ${mm===selectedYM?'selected':''}>${mm}</option>`).join('')}
            ${!allMonths.includes(currentYM) ? `<option value="${currentYM}">${currentYM}</option>` : '' }
          </select>
          <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
          <button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>
        </div>
      </div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead><tr>
            <th>Date</th><th class="num">G-Income</th><th class="num">Produce Cost</th><th class="num">Item Cost</th><th class="num">Other</th><th class="num">G-Profit</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${filtered.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td><td class="num">${USD(r.grossIncome)}</td><td class="num">${USD(r.produceCost)}</td><td class="num">${USD(r.itemCost)}</td>
                <td class="num">${USD(r.other)}</td><td class="num">${USD(gp(r))}</td>
                <td>
                  <button class="btn ghost" data-edit="${r.id}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${r.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
            <tr class="tr-total">
              <th>Total</th><th class="num">${USD(totals.grossIncome)}</th><th class="num">${USD(totals.produceCost)}</th><th class="num">${USD(totals.itemCost)}</th>
              <th class="num">${USD(totals.other)}</th><th class="num">${USD(totalProfit)}</th><th></th>
            </tr>
          </tbody>
        </table>
      </div>
    </div></div>

    ${cogsModal()}
  `;
}
function wireCOGS(){
  $('#cogs-filter')?.addEventListener('change', ()=> renderApp());
  $('#export-cogs')?.addEventListener('click', ()=>{
    const ym = $('#cogs-filter')?.value || '';
    const rows = ym ? state.cogs.filter(r=>r.date?.startsWith(ym)) : state.cogs;
    exportCSV(`cogs${ym?'-'+ym:''}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','other']);
  });
  $('#addCOGS')?.addEventListener('click', ()=>{
    openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-other').value='';
  });
  const sec=document.querySelector('[data-section="cogs"]');
  sec?.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const r=state.cogs.find(x=>x.id===id); if(!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
      $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-other').value=r.other;
    }else{
      state.cogs=state.cogs.filter(x=>x.id!==id); await cloudSave('cogs', state.cogs); notify('Deleted'); renderApp();
    }
  });
  $('#save-cogs')?.addEventListener('click', async ()=>{
    const id=$('#cogs-id').value || ('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
      itemCost:+($('#cogs-itemCost').value||0), other:+($('#cogs-other').value||0) };
    const i=state.cogs.findIndex(x=>x.id===id); if(i>=0) state.cogs[i]=row; else state.cogs.push(row);
    await cloudSave('cogs', state.cogs); closeModal('m-cogs'); notify('Saved'); renderApp();
  });
}

/* ---------- Tasks (DnD; works with empty lanes) ---------- */
function viewTasks(){
  const items=state.tasks;
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo'? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>${t.title}</div>
                <div>
                  <button class="btn ghost" data-edit="${t.id}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${t.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
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
  const sec=document.querySelector('[data-section="tasks"]');
  sec?.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const t=state.tasks.find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      state.tasks=state.tasks.filter(x=>x.id!==id); await cloudSave('tasks', state.tasks); notify('Deleted'); renderApp();
    }
  });
  $('#save-task')?.addEventListener('click', async ()=>{
    const id=$('#task-id').value || ('t_'+Date.now());
    const obj={ id, title:($('#task-title').value||'').trim(), status:$('#task-status')?.value || 'todo' };
    if(!obj.title){ notify('Title required'); return; }
    const i=state.tasks.findIndex(x=>x.id===id); if(i>=0) state.tasks[i]=obj; else state.tasks.push(obj);
    await cloudSave('tasks', state.tasks); closeModal('m-task'); notify('Saved'); renderApp();
  });

  // DnD
  $$('.task-card').forEach(card=>{
    card.setAttribute('draggable','true'); card.style.cursor='grab';
    card.addEventListener('dragstart',(e)=>{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  $$('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=(e)=>{ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch{} row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    ['dragenter','dragover'].forEach(evt=> grid.addEventListener(evt, show));
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop', async (e)=>{
      e.preventDefault(); hide(); if(!lane) return;
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const t=state.tasks.find(x=>x.id===id); if(!t) return; t.status=lane;
      await cloudSave('tasks', state.tasks); renderApp();
    });
  });

  // Tap-to-advance (mobile)
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click', async (e)=>{
        if (e.target.closest('button')) return;
        const id=card.getAttribute('data-task'); const t=state.tasks.find(x=>x.id===id); if(!t) return;
        t.status = t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        await cloudSave('tasks', state.tasks); renderApp();
      });
    });
  }
}

/* ---------- Settings / Users ---------- */
function viewSettings(){
  const users=state.users;
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px">Theme</h3>
        ${themeControls()}
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
                  <button class="btn ghost" data-edit="${u.email}" title="Edit"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del="${u.email}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
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
  wireThemeControls();
  const addBtn=$('#addUser'); const table=document.querySelector('[data-section="users"]');
  addBtn?.addEventListener('click', ()=>{ openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-role').value='user'; });
  table?.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      const u=state.users.find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username||''; $('#user-role').value=u.role;
    }else{
      state.users=state.users.filter(x=>x.email!==email); await cloudSave('users', state.users); notify('Deleted'); renderApp();
    }
  });
  $('#save-user')?.addEventListener('click', async ()=>{
    const email=($('#user-email')?.value||'').trim().toLowerCase();
    if(!email){ notify('Email required'); return; }
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:($('#user-role')?.value||'user') };
    const i=state.users.findIndex(x=> (x.email||'').toLowerCase()===email);
    if(i>=0) state.users[i]=obj; else state.users.push(obj);
    await cloudSave('users', state.users); closeModal('m-user'); notify('Saved'); renderApp();
  });
}

/* ---------- Static pages (fuller content & readable) ---------- */
const pageContent = {
  about:  `<div class="prose">
    <h3>About</h3>
    <p><strong>Inventory</strong> is a fast, mobile-first app for tracking stock, products, COGS, and tasks.</p>
    <p>It stores your data securely in <em>Firebase Realtime Database</em> under your own account (per-user namespace). You can export CSVs anytime.</p>
    <ul>
      <li>Lightning-fast search across items, products, posts, and users.</li>
      <li>Clean, distraction-free UI, designed to be usable on phones.</li>
      <li>Theme & font scaling to keep it readable for everyone.</li>
    </ul>
  </div>`,
  policy: `<div class="prose">
    <h3>Policy</h3>
    <p>Your data is written to <code>tenants/{uid}/kv/*</code> and only authenticated users can read/write their own path (configure rules accordingly).</p>
    <ul>
      <li>No third-party analytics or cookies beyond Firebase.</li>
      <li>Export your data at any time via CSV from each section.</li>
      <li>We recommend enabling 2FA on your Google account.</li>
    </ul>
  </div>`,
  license:`<div class="prose">
    <h3>License</h3>
    <p>MIT — do anything you want, just don’t hold the authors liable.</p>
    <p>Attribution is appreciated if you share a derivative.</p>
  </div>`,
  setup:  `<div class="prose">
    <h3>Setup</h3>
    <ol>
      <li>Create a Firebase project and enable <strong>Email/Password</strong> auth.</li>
      <li>Copy your Firebase config into <code>public/index.html</code>.</li>
      <li>Set <strong>Realtime Database rules</strong> to restrict to <code>tenants/{uid}</code>:</li>
    </ol>
    <pre style="white-space:pre-wrap;background:#0c1117;border:1px solid #1f2937;border-radius:10px;padding:10px;overflow:auto">
{
  "rules": {
    "tenants": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
    </pre>
    <ol start="4">
      <li>Deploy with Firebase Hosting.</li>
      <li>Sign in and start adding items, products, and tasks.</li>
    </ol>
  </div>`,
  guide:  `<div class="prose">
    <h3>User Guide</h3>
    <ul>
      <li>Use the left search to jump straight to anything.</li>
      <li>Drag tasks between lanes; on mobile, tap a task to advance.</li>
      <li>In COGS, pick any month to filter and export that period.</li>
      <li>Change theme & font size in <em>Settings</em> instantly.</li>
    </ul>
  </div>`,
  contact:`<div class="prose">
    <h3>Contact</h3>
    <p>We’d love to hear from you.</p>
    <p><a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Inventory%20Support"><i class="ri-mail-send-line"></i> Email us</a></p>
  </div>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key]||'<p>Page</p>'}</div></div>`; }

/* ---------- Modals ---------- */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }

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
function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv">
    <div class="dialog">
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" onclick="closeModal('m-inv')">Close</button></div>
      <div class="body grid cols-2">
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
      <div class="body grid cols-2">
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
        <select id="user-role"><option value="user">User</option><option value="associate">Associate</option><option value="manager">Manager</option><option value="admin">Admin</option></select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>`; }

/* ---------- CSV export ---------- */
function exportCSV(filename, rows, headers){
  try{
    const csvRows=[]; if(headers?.length) csvRows.push(headers.join(','));
    for(const r of rows){
      const vals=headers.map(h=>{ const v=r[h]; const s=(v===undefined||v===null)?'':String(v); const needs=/[",\n]/.test(s); const esc=s.replace(/"/g,'""'); return needs?`"${esc}"`:esc;});
      csvRows.push(vals.join(','));
    }
    const blob=new Blob([csvRows.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.style.display='none'; a.href=url; a.download=filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
    notify('Exported CSV');
  }catch(e){ notify('Export failed'); }
}

/* ---------- Auth & session ---------- */
async function doLogout(){
  try{ cloudUnsubAll(subs); }catch{}
  try{ await auth.signOut(); }catch{}
  location.reload();
}
function renderLogin(){
  const root=$('#root');
  root.innerHTML=`
    <div class="login" style="display:grid; place-items:center; min-height:100vh; padding:16px">
      <div class="card" style="width:min(420px, 94vw)">
        <div class="card-body">
          <div class="brand" style="margin-bottom:6px"><div class="logo">📦</div><div style="font-weight:800;font-size:20px">Inventory</div></div>
          <p style="color:var(--muted); margin-top:0">Sign in</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          </div>
        </div>
      </div>
    </div>`;
  const doSignIn = async ()=>{
    const email = ($('#li-email')?.value || '').trim().toLowerCase();
    const pass  = $('#li-pass')?.value || '';
    if (!email || !pass) return notify('Enter email & password');
    try{
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await auth.signInWithEmailAndPassword(email, pass);
    }catch(e){ notify(e?.message || 'Login failed'); }
  };
  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSignIn(); });
}

/* ---------- Idle auto-logout (20 mins) ---------- */
const IDLE_MS = 20*60*1000;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt, ()=>{ __lastActivity=Date.now(); }, {passive:true}));
setInterval(()=>{ if(auth.currentUser && Date.now()-__lastActivity > IDLE_MS){ doLogout(); } }, 30000);

/* ---------- Router ---------- */
function viewFor(route){
  switch(route){
    case 'dashboard': return viewDashboard();
    case 'inventory': return viewInventory();
    case 'products':  return viewProducts();
    case 'cogs':      return viewCOGS();
    case 'tasks':     return viewTasks();
    case 'settings':  return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide':
      return viewPage(route);
    default: return viewDashboard();
  }
}
function wireRoute(route){
  switch(route){
    case 'dashboard': wireDashboard(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts(); break;
    case 'cogs':      wireCOGS(); break;
    case 'tasks':     wireTasks(); break;
    case 'settings':  wireSettings(); break;
  }
}

/* ---------- Live sync & boot ---------- */
async function boot(){
  auth.onAuthStateChanged(async (user)=>{
    if(!user){ renderLogin(); return; }

    // Pull once
    const all = await cloudLoadAll();
    CLOUD_KEYS.forEach(k=>{
      if (k in all) state[k] = all[k];
    });
    // Ensure defaults
    state.theme = state.theme || { mode:'sky', size:'medium' };
    state.users = state.users?.length ? state.users : [{name:user.displayName||user.email.split('@')[0], email:user.email, username:user.email.split('@')[0], role:'admin'}];

    renderApp();

    // Subscribe live
    subs = cloudSubscribeAll((k,val)=>{
      state[k] = val;
      if (k==='theme') applyTheme(state.theme);
      if (k!=='theme') renderApp();
    });

    // Seed if first time
    if (!Array.isArray(state.inventory) || !state.inventory.length){
      const now=Date.now();
      state.inventory = [
        { id:'inv_'+now, name:'Rice',  code:'RIC-001', type:'Dry', price:1.20, stock:25, threshold:8 },
        { id:'inv_'+(now+1), name:'Salmon', code:'SAL-201', type:'Raw', price:8.50, stock:12, threshold:6 }
      ];
      state.products = [
        { id:'p_'+now, name:'Salmon Roll', barcode:'1001001', price:7.99, type:'Roll', ingredients:'Rice,Nori,Salmon', instructions:'8 pcs' }
      ];
      state.posts = [
        { id:'post_'+now, title:'Welcome', body:'This is your private workspace. Add inventory, products and tasks.', createdAt: now }
      ];
      state.tasks = [ { id:'t_'+now, title:'Sample task', status:'todo' } ];
      state.cogs  = [ { id:'c_'+now, date: new Date().toISOString().slice(0,10), grossIncome:900, produceCost:220, itemCost:130, other:8 } ];
      await Promise.all(CLOUD_KEYS.map(k=> cloudSave(k, state[k])));
      renderApp();
    }
  });
}
boot();