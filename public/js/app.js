/* ==========================================================
   Inventory — Single-file SPA (Firebase RTDB; no images/video)
   ========================================================== */

/* ---------- Tiny utils ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const USD = x => `$${Number(x||0).toFixed(2)}`;
const parseYMD = s => { const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; };
function notify(msg,type='ok'){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>{ n.className='notification'; },2200); }

/* ---------- Firebase bootstrap ---------- */
const firebaseConfig = window.__FIREBASE_CONFIG || null;
if (!firebaseConfig) alert('Missing Firebase config in index.html');
if (firebase.apps && firebase.apps.length===0) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.database();

/* ---------- Global state (RTDB-driven) ---------- */
const KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
let state = {
  inventory: [], products: [], posts: [], tasks: [], cogs: [], users: [],
  _theme2: { mode:'sunset', size:'medium' }
};
let session = null; // { uid, email, role }

/* ---------- Role helpers ---------- */
const ROLES = ['user','associate','manager','admin'];
function canAdd()    { return ['associate','manager','admin'].includes(session?.role||'user'); }
function canEdit()   { return ['manager','admin'].includes(session?.role||'user'); }
function canDelete() { return ['admin'].includes(session?.role||'user'); }

/* Ensure user has a role record (default 'user') */
async function ensureRoleRecord(){
  try{
    const uid = auth.currentUser?.uid; if (!uid) return;
    const ref = db.ref(`userRoles/${uid}`);
    const snap = await ref.get();
    if (!snap.exists()) await ref.set('user');
  }catch(e){ console.warn('[role] ensureRoleRecord failed', e); }
}

/* Pull role to session.role */
async function fetchRole(){
  const uid = auth.currentUser?.uid; if (!uid) return;
  const snap = await db.ref(`userRoles/${uid}`).get();
  session.role = (snap.exists() ? snap.val() : 'user');
}

/* ---------- RTDB kv helpers (direct save) ---------- */
function tenantPath(key){ const uid=auth.currentUser?.uid; return db.ref(`tenants/${uid}/kv/${key}`); }
async function saveKV(key, val){
  if (!auth.currentUser) return notify('Sign in first','warn');
  try{
    await tenantPath(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP });
  }catch(e){ console.warn('[save] '+key, e); notify(e?.message||'Save failed', 'danger'); }
}
function subscribeKV(key){
  tenantPath(key).on('value', snap=>{
    const d = snap.val();
    const incoming = d && 'val' in d ? d.val : (Array.isArray(d)||typeof d==='object' ? d : null);
    if (incoming===null || incoming===undefined) return;

    state[key] = incoming;

    if (key === '_theme2') applyTheme(incoming);
    if (document.getElementById('root')) renderApp();
  });
}

/* ---------- Theme ---------- */
const THEME_MODES = [
  { key:'sunset', name:'Sunset (Soft Orange)' },
  { key:'sky',    name:'Sky (Blue)' },
  { key:'mint',   name:'Mint (Green)' },
  { key:'light',  name:'Light' },
  { key:'dark',   name:'Dark' }
];
const THEME_SIZES = [
  { key:'small',  pct:90,  label:'Small' },
  { key:'medium', pct:100, label:'Medium' },
  { key:'large',  pct:112, label:'Large' }
];

function applyTheme(t){
  const mode = (t && THEME_MODES.find(m=>m.key===t.mode)?.key) || 'sunset';
  const size = (t && THEME_SIZES.find(s=>s.key===t.size)?.pct) || 100;
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.setProperty('--font-scale', size+'%');
}

/* ---------- Auth ---------- */
auth.onAuthStateChanged(async (user)=>{
  if (!user){
    session = null;
    renderLogin();
    return;
  }
  session = { uid: user.uid, email: (user.email||'').toLowerCase(), role:'user' };
  await ensureRoleRecord();
  await fetchRole();

  // Subscribe to data keys
  KEYS.forEach(subscribeKV);

  // If any key has no data yet, initialize minimal arrays (needs role create permission)
  if (canAdd()){
    const initIfEmpty = async (key, fallback)=> {
      const snap = await tenantPath(key).get();
      if (!snap.exists() || !snap.val() || !('val' in snap.val())) {
        await saveKV(key, fallback);
      }
    };
    await initIfEmpty('posts',     []);
    await initIfEmpty('inventory', []);
    await initIfEmpty('products',  []);
    await initIfEmpty('tasks',     []);
    await initIfEmpty('cogs',      []);
    await initIfEmpty('users',     [{ name: user.displayName || session.email.split('@')[0], email: session.email, role:'admin' }]);
    await initIfEmpty('_theme2',   { mode:'sunset', size:'medium' });
  }

  renderApp();
});

/* ---------- Idle auto-logout (20 min) ---------- */
const AUTO_LOGOUT_MS = 20*60*1000;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart','visibilitychange'].forEach(evt=>{
  document.addEventListener(evt, ()=>{ __lastActivity = Date.now(); }, {passive:true});
});
setInterval(()=>{ if (auth.currentUser && (Date.now()-__lastActivity)>=AUTO_LOGOUT_MS) doLogout(); }, 30*1000);

/* ---------- Router ---------- */
let currentRoute = 'dashboard';
function go(route){ currentRoute = route; renderApp(); }

/* ---------- Sidebar / Topbar ---------- */
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

      <h6 class="social-caption">Social</h6>
      <div class="socials-row">
        <a href="https://tiktok.com"  target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
        <a href="https://twitter.com" target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
        <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar">
      <div class="left">
        <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${(currentRoute||'dashboard').replace(/^\w/, c=>c.toUpperCase())}</strong></div>
      </div>
      <div class="right">
        <span style="color:var(--muted);font-size:.85rem">${session?.email||''} &nbsp;•&nbsp; <b>${(session?.role||'user').toUpperCase()}</b></span>
        <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}

/* ---------- Search (no images anywhere) ---------- */
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
function hookSidebarInteractions(){
  const input = $('#globalSearch'), results = $('#searchResults'); if(!input||!results) return;

  const openResultsPage = (q)=>{
    window.__searchQ = q;
    if (currentRoute !== 'search') go('search'); else renderApp();
  };

  let timer;
  input.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); } } });
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q=input.value.trim().toLowerCase();
    if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer=setTimeout(()=>{
      const out=searchAll(buildSearchIndex(),q).slice(0,12);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML = out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section||''}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id')||''; const label=row.textContent.trim();
          openResultsPage(label); results.classList.remove('active'); input.value=''; closeSidebar();
          if (id) setTimeout(()=> scrollToRow(id), 80);
        };
      });
    },120);
  });
  document.addEventListener('click',(e)=>{ if (!results.contains(e.target) && e.target!==input){ results.classList.remove('active'); }});
}
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }

/* ---------- Pages ---------- */
function viewSearch(){
  const q=(window.__searchQ||'').trim();
  const out=q? searchAll(buildSearchIndex(),q):[];
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Search</h3>
        <div style="color:var(--muted)">Query: <strong>${q||'(empty)'}</strong></div>
      </div>
      ${out.length? `<div class="grid">${out.map(r=>`
        <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:700">${r.label}</div><div style="color:var(--muted);font-size:.85rem">${r.section||''}</div></div>
          <button class="btn" data-go="${r.route}" data-id="${r.id||''}"><i class="ri-arrow-right-line"></i> Open</button>
        </div></div>`).join('')}</div>` : `<p style="color:var(--muted)">No results.</p>`}
    </div></div>`;
}

function viewDashboard(){
  const inv=state.inventory||[], prods=state.products||[], users=state.users||[], tasks=state.tasks||[], cogs=state.cogs||[];
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  const totalIncome = cogs.reduce((s,r)=> s+(+r.grossIncome||0), 0);

  return `
    <div class="grid cols-4">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Total Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-go="cogs"><div class="card-body"><div>G-Income (All)</div><h2>${USD(totalIncome)}</h2></div></div>
    </div>

    <div class="grid cols-4" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>

      <div class="card" style="grid-column: span 2 / auto">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>Posts</strong>
            ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
          </div>
          <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
            ${(state.posts||[]).map(p=>`
              <div class="card" id="${p.id}">
                <div class="card-body">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:.8rem">${new Date(p.createdAt).toLocaleString()}</div></div>
                    <div>
                      ${canEdit()?`<button class="btn ghost" data-edit="${p.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                      ${canDelete()?`<button class="btn danger" data-del="${p.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
                    </div>
                  </div>
                  <p style="margin-top:8px">${p.body}</p>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}
function wireDashboard(){
  $('#addPost')?.addEventListener('click', ()=> openModal('m-post'));
  const sec=document.querySelector('[data-section="posts"]'); if(!sec) return;
  sec.addEventListener('click', async (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.getAttribute('data-edit')||b.getAttribute('data-del'); if(!id) return;
    if (b.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const p=(state.posts||[]).find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    } else {
      if(!canDelete()) return notify('No permission','warn');
      const posts=(state.posts||[]).filter(x=>x.id!==id);
      await saveKV('posts', posts); notify('Deleted'); renderApp();
    }
  });
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
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>{
              const isLow = it.stock <= it.threshold;
              const isCrit= it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
              const trStyle = isCrit ? 'style="background:rgba(239,68,68,.06)"' : (isLow ? 'style="background:rgba(245,158,11,.05)"' : '');
              return `<tr id="${it.id}" ${trStyle}>
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td>
                <td class="num">${USD(it.price)}</td>
                <td class="num">${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button> <span style="padding:0 6px">${it.stock}</span> <button class="btn ghost" data-inc="${it.id}">+</button>`:`${it.stock}`}</td>
                <td class="num">${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button> <span style="padding:0 6px">${it.threshold}</span> <button class="btn ghost" data-inc-th="${it.id}">+</button>`:`${it.threshold}`}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
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
  $('#export-inventory')?.addEventListener('click',()=>{
    const rows=state.inventory||[]; const headers=['id','name','code','type','price','stock','threshold']; downloadCSV('inventory.csv', rows, headers);
  });
  $('#addInv')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-inv');
    $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });
  const saveBtn=$('#save-inv');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=[...(state.inventory||[])];
      const id=$('#inv-id').value || ('inv_'+Date.now());
      const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
        price:+($('#inv-price').value||0), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0') };
      if(!obj.name){ notify('Name required','warn'); return; }
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      await saveKV('inventory', items); closeModal('m-inv'); notify('Saved'); renderApp();
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
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
        const id=btn.getAttribute('data-del'); const next=items.filter(x=>x.id!==id);
        await saveKV('inventory', next); notify('Deleted'); return;
      }
      const id = btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
      if(!id) return; if(!canAdd()) return notify('No permission','warn');
      const it=get(id); if(!it) return;
      if(btn.hasAttribute('data-inc')) it.stock++;
      if(btn.hasAttribute('data-dec')) it.stock=Math.max(0,it.stock-1);
      if(btn.hasAttribute('data-inc-th')) it.threshold++;
      if(btn.hasAttribute('data-dec-th')) it.threshold=Math.max(0,it.threshold-1);
      await saveKV('inventory', items); renderApp();
    });
  }
}

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
          <thead><tr><th>Name</th><th>Barcode</th><th class="num">Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><button class="btn ghost prod-open" data-card="${it.id}" style="padding:0 .4rem; font-weight:800; color:var(--text)">${it.name}</button></td>
                <td>${it.barcode||''}</td><td class="num">${USD(it.price)}</td><td>${it.type||'-'}</td>
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
  const sec=document.querySelector('[data-section="products"]'); if(!sec) return;
  $('#export-products')?.addEventListener('click',()=>{
    const rows=state.products||[]; const headers=['id','name','barcode','price','type','ingredients','instructions']; downloadCSV('products.csv', rows, headers);
  });
  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-prod');
    $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });

  const saveBtn=$('#save-prod');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=[...(state.products||[])];
      const id=$('#prod-id').value || ('p_'+Date.now());
      const obj={ id, name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(), price:+($('#prod-price').value||0),
        type:$('#prod-type').value.trim(), ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim() };
      if(!obj.name){ notify('Name required','warn'); return; }
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      await saveKV('products', items); closeModal('m-prod'); notify('Saved'); renderApp();
    });
  }

  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const cardBtn=e.target.closest('.prod-open');
      if (cardBtn){
        const id=cardBtn.getAttribute('data-card'); const it=(state.products||[]).find(x=>x.id===id); if(!it) return;
        $('#pc-name').textContent=it.name; $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price);
        $('#pc-type').textContent=it.type||''; $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||'';
        openModal('m-card'); return;
      }
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const it=(state.products||[]).find(x=>x.id===id); if(!it) return;
        openModal('m-prod');
        $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||'';
        $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||'';
        $('#prod-instructions').value=it.instructions||'';
      }else{
        if(!canDelete()) return notify('No permission','warn');
        const next=(state.products||[]).filter(x=>x.id!==id);
        await saveKV('products', next); notify('Deleted'); renderApp();
      }
    });
  }
}

function viewCOGS(){
  const rows=state.cogs||[];
  const totals=rows.reduce((a,r)=>({
    grossIncome:a.grossIncome+(+r.grossIncome||0),
    produceCost:a.produceCost+(+r.produceCost||0),
    itemCost:a.itemCost+(+r.itemCost||0),
    freight:a.freight+(+r.freight||0),
    other:a.other+(+r.other||0)
  }),{grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
  const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0));
  const totalProfit=gp(totals);

  const years=[...new Set(rows.map(r=> (parseYMD(r.date)||{}).y ).filter(Boolean))].sort((a,b)=>b-a);
  const yearSel=(years.length? years[0] : new Date().getFullYear());

  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">COGS</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="color:var(--muted);font-size:.85rem">Year</label>
          <select id="cogs-year" class="input" style="width:auto;min-width:120px">${[yearSel,...years.filter(y=>y!==yearSel)].map(y=>`<option>${y}</option>`).join('')}</select>
          <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export All CSV</button>
          <button class="btn" id="export-year"><i class="ri-download-2-line"></i> Export Year CSV</button>
          ${canAdd()? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
        </div>
      </div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="num">G-Income</th>
              <th class="num">Produce Cost</th>
              <th class="num">Item Cost</th>
              <th class="num">Freight</th>
              <th class="num">Other</th>
              <th class="num">G-Profit</th>
              <th>Actions</th>
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
                  ${canEdit()? `<button class="btn ghost" data-edit="${r.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${r.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
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
    </div></div>`;
}
function wireCOGS(){
  const sec=document.querySelector('[data-section="cogs"]'); if(!sec) return;
  $('#export-cogs')?.addEventListener('click',()=> downloadCSV('cogs-all.csv', state.cogs||[], ['id','date','grossIncome','produceCost','itemCost','freight','other']));
  $('#export-year')?.addEventListener('click',()=>{
    const y=+($('#cogs-year')?.value||new Date().getFullYear());
    const rows=(state.cogs||[]).filter(r=> (parseYMD(r.date)||{}).y===y);
    downloadCSV(`cogs-${y}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','freight','other']);
  });
  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-cogs');
    $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value='';
    $('#cogs-freight').value=''; $('#cogs-other').value='';
  });
  const saveBtn=$('#save-cogs');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const rows=[...(state.cogs||[])];
      const id=$('#cogs-id').value || ('c_'+Date.now());
      const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10),
        grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0),
        itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0), other:+($('#cogs-other').value||0) };
      const i=rows.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); rows[i]=row; } else rows.push(row);
      await saveKV('cogs', rows); closeModal('m-cogs'); notify('Saved'); renderApp();
    });
  }
  if (!sec.__wired){
    sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const r=(state.cogs||[]).find(x=>x.id===id); if(!r) return;
        openModal('m-cogs');
        $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
        $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost;
        $('#cogs-freight').value=r.freight; $('#cogs-other').value=r.other;
      }else{
        if(!canDelete()) return notify('No permission','warn');
        const next=(state.cogs||[]).filter(x=>x.id!==id);
        await saveKV('cogs', next); notify('Deleted'); renderApp();
      }
    });
  }
}

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
                  ${canEdit()? `<button class="btn ghost" data-edit="${t.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${t.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
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
    saveBtn.addEventListener('click', async ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const items=[...(state.tasks||[])];
      const id=$('#task-id').value || ('t_'+Date.now());
      const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
      if(!obj.title){ notify('Title required','warn'); return; }
      const i=items.findIndex(x=>x.id===id);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); items[i]=obj; } else items.push(obj);
      await saveKV('tasks', items); closeModal('m-task'); notify('Saved'); renderApp();
    });
  }

  root.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const t=(state.tasks||[]).find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      if(!canDelete()) return notify('No permission','warn');
      const next=(state.tasks||[]).filter(x=>x.id!==id);
      saveKV('tasks', next); notify('Deleted'); renderApp();
    }
  });

  // Drag & Drop to empty lanes supported
  setupDnD();
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
    const show=(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    grid.addEventListener('dragenter', show);
    grid.addEventListener('dragover',  show);
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop',async (e)=>{
      e.preventDefault(); hide(); if(!lane) return;
      if (!canAdd()) return notify('No permission','warn');
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const items=[...(state.tasks||[])]; const t=items.find(x=>x.id===id); if(!t) return;
      t.status=lane; await saveKV('tasks',items); renderApp();
    });
  });

  // Tap-to-advance on touch
  const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
  if (isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click',async (e)=>{
        if (e.target.closest('button')) return;
        if (!canAdd()) return notify('No permission','warn');
        const id=card.getAttribute('data-task'); const items=[...(state.tasks||[])]; const t=items.find(x=>x.id===id); if(!t) return;
        const next=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        t.status=next; await saveKV('tasks',items); renderApp();
      });
    });
  }
}

/* ---------- Settings ---------- */
function viewSettings(){
  const theme=state._theme2 || {mode:'sunset', size:'medium'};
  const users=state.users||[];
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
          <div><label style="font-size:.85rem;color:var(--muted)">Mode</label>
            <select id="theme-mode" class="input">
              ${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}
            </select>
          </div>
          <div><label style="font-size:.85rem;color:var(--muted)">Font Size</label>
            <select id="theme-size" class="input">
              ${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <p style="color:var(--muted);font-size:.85rem;margin-top:8px">Changes apply instantly and are saved to your account.</p>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Users</h3>
          ${canAdd()? `<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
        </div>
        <table class="table" data-section="users">
          <thead><tr><th>Name</th><th>Email</th><th>App Role (display)</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr id="${u.email}">
                <td>${u.name}</td><td>${u.email}</td><td>${u.role||'user'}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${u.email}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${u.email}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p style="color:var(--muted);font-size:.85rem;margin-top:6px">Note: Permission enforcement uses your authenticated role at <code>/userRoles/{uid}</code>.</p>
      </div></div>
    </div>`;
}
function wireSettings(){
  // Theme
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=async ()=>{
    const t={ mode:mode.value, size:size.value };
    applyTheme(t);
    await saveKV('_theme2', t);
    notify('Theme saved');
  };
  mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

  // Users
  wireUsers();
}
function wireUsers(){
  const addBtn=$('#addUser'); const table=document.querySelector('[data-section="users"]');
  addBtn?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission','warn');
    openModal('m-user');
    $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value='';
    const sel=$('#user-role'); sel.innerHTML=ROLES.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value='user';
  });
  const saveBtn=$('#save-user');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{
      if(!canAdd()) return notify('No permission','warn');
      const users=[...(state.users||[])];
      const email=($('#user-email')?.value||'').trim().toLowerCase();
      if(!email){ notify('Email required','warn'); return; }
      const roleSel=($('#user-role')?.value||'user');
      const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:roleSel };
      const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
      if(i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);
      await saveKV('users', users); closeModal('m-user'); notify('Saved'); renderApp();
    });
  }
  table?.addEventListener('click', async (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission','warn');
      const u=(state.users||[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username;
      const sel=$('#user-role'); sel.innerHTML=ROLES.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value= u.role||'user';
    }else{
      if(!canDelete()) return notify('No permission','warn');
      const next=(state.users||[]).filter(x=>x.email!==email); await saveKV('users', next); notify('Deleted'); renderApp();
    }
  });
}

/* ---------- Static pages ---------- */
const Page = {
  about: `
    <h3>About Inventory</h3>
    <p style="color:var(--muted);max-width:70ch">A fast, mobile-first inventory & POS companion that saves directly to your own Firebase. No images, no videos — just the essentials, lightning fast.</p>
    <ul>
      <li>Inventory & Products with instant search</li>
      <li>COGS tracking with G-Income/G-Profit, yearly exports</li>
      <li>Kanban Tasks with drag & drop (including empty lanes)</li>
      <li>Four account levels: Admin / Manager / Associate / User</li>
      <li>Soft modern themes (Sunset, Sky, Mint, Light, Dark)</li>
    </ul>
  `,
  policy: `
    <h3>Policy</h3>
    <p style="color:var(--muted);max-width:70ch">Your data lives in your Firebase project. We never proxy or store your data elsewhere. Access is governed by your Realtime Database Rules. Keep your API keys private and assign roles carefully.</p>
    <ol>
      <li>Use read/write rules from the setup guide (role-based)</li>
      <li>Turn on Email/Password sign-in</li>
      <li>Assign roles at <code>/userRoles/{uid}</code></li>
    </ol>
  `,
  license: `
    <h3>License</h3>
    <p style="color:var(--muted)">MIT License — use, modify, distribute freely. Attribution appreciated.</p>
    <pre style="white-space:pre-wrap;background:var(--panel-2);padding:12px;border-radius:12px">MIT © You</pre>
  `,
  setup: `
    <h3>Setup Guide</h3>
    <ol>
      <li>Create a Firebase project & enable Realtime Database (Production)</li>
      <li>Enable Authentication → Email/Password</li>
      <li>Paste DB Rules (role-aware) in Realtime Database → Rules</li>
      <li>Fill <code>window.__FIREBASE_CONFIG</code> in <code>index.html</code></li>
      <li>Deploy to Firebase Hosting</li>
    </ol>
  `,
  guide: `
    <h3>User Guide</h3>
    <p>Start at Dashboard → add Items/Products/COGS/Tasks. Use the left search box to find anything in a few keystrokes. Change themes in Settings.</p>
    <p><b>Shortcuts:</b> <code>/</code> focuses search, <code>Esc</code> closes menus.</p>
  `,
  contact: `
    <h3>Contact</h3>
    <p style="color:var(--muted)">Click to email us or open your email client pre-filled:</p>
    <a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Hello%20from%20Inventory&body=Hi%2C%0A" rel="noopener"><i class="ri-mail-send-line"></i> Email: minmaung0307@gmail.com</a>
  `
};
function viewPage(key){ return `<div class="card"><div class="card-body">${Page[key]||'<p>Page</p>'}</div></div>`; }

/* ---------- CSV ---------- */
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
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
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
      <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
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
      <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden"/>
        <input id="task-title" class="input" placeholder="Title"/>
        <select id="task-status" class="input"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
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
        <select id="user-role" class="input"></select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>`; }
function ensureGlobalModals(){
  if ($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals';
  wrap.innerHTML = postModal()+invModal()+prodModal()+prodCardModal()+cogsModal()+taskModal()+userModal()+`<div class="notification" id="notification"></div>`;
  document.body.appendChild(wrap);
}
document.addEventListener('click', (e)=>{ const btn=e.target.closest('[data-close]'); if(btn) closeModal(btn.getAttribute('data-close')); });

/* ---------- Login ---------- */
function renderLogin(){
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login">
      <div class="card" style="max-width:440px;margin:40px auto">
        <div class="card-body">
          <div class="brand" style="justify-content:center"><div class="logo">📦</div><div class="title">Inventory</div></div>
          <p class="login-note" style="text-align:center;color:var(--muted)">Sign in to continue</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div style="display:flex;justify-content:space-between;gap:8px">
              <a id="link-forgot"   href="#" class="btn ghost"    style="padding:6px 10px;font-size:.9rem"><i class="ri-key-2-line"></i> Forgot</a>
              <a id="link-register" href="#" class="btn secondary"style="padding:6px 10px;font-size:.9rem"><i class="ri-user-add-line"></i> Sign up</a>
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
    const pass  = ($('#su-pass')?.value  || '');
    const pass2 = ($('#su-pass2')?.value || '');
    if (!email || !pass) return notify('Email and password required','warn');
    if (pass !== pass2)  return notify('Passwords do not match','warn');
    try{
      await auth.createUserWithEmailAndPassword(email, pass);
      try { await auth.currentUser.updateProfile({ displayName: name || email.split('@')[0] }); } catch {}
      await ensureRoleRecord();
      notify('Account created — you are signed in'); closeAuth();
    }catch(e){ notify(e?.message||'Signup failed','danger'); }
  }
  async function doReset(){
    const email = ($('#fp-email')?.value || '').trim().toLowerCase();
    if (!email) return notify('Enter your email','warn');
    try{
      await auth.sendPasswordResetEmail(email);
      notify('Reset email sent'); closeAuth();
    }catch(e){ notify(e?.message||'Reset failed','danger'); }
  }

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSignIn(); });
  $('#link-register')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  $('#link-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  $('#cl-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#cl-reset')?.addEventListener('click', (e)=>{ e.preventDefault(); closeAuth(); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

/* ---------- Shell ---------- */
function renderApp(){
  const root = document.getElementById('root'); if (!root) return;
  if (!auth.currentUser){ renderLogin(); return; }
  ensureGlobalModals();

  root.innerHTML = `
    <div class="app">
      ${renderSidebar(currentRoute)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">${safeView(currentRoute)}</div>
      </div>
    </div>`;

  // Wiring
  $('#btnLogout')?.addEventListener('click', doLogout);
  $('#burger')?.addEventListener('click', ()=>{ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); });
  $('#backdrop')?.addEventListener('click', closeSidebar);

  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=>{
    el.addEventListener('click', ()=>{ const r=el.getAttribute('data-route'); go(r); closeSidebar(); });
  });
  document.querySelectorAll('[data-go]').forEach(el=>{
    el.addEventListener('click', ()=>{ const r=el.getAttribute('data-go'); const id=el.getAttribute('data-id'); if (r){ go(r); if (id) setTimeout(()=> scrollToRow(id),80); }});
  });

  hookSidebarInteractions();

  switch(currentRoute){
    case 'dashboard': wireDashboard(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts();  break;
    case 'cogs':      wireCOGS();      break;
    case 'tasks':     wireTasks();     break;
    case 'settings':  wireSettings();  break;
  }
}
function safeView(route){
  switch(route){
    case 'dashboard': return viewDashboard();
    case 'search':    return viewSearch();
    case 'inventory': return viewInventory();
    case 'products':  return viewProducts();
    case 'cogs':      return viewCOGS();
    case 'tasks':     return viewTasks();
    case 'settings':  return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide': return viewPage(route);
    default: return viewDashboard();
  }
}
async function doLogout(){ try{ await auth.signOut(); }catch{} session=null; notify('Signed out'); renderLogin(); }
function scrollToRow(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

/* ---------- Boot ---------- */
(function boot(){
  applyTheme(state._theme2);
  renderLogin();
})();