/* eslint-disable */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import {
  getDatabase, ref, get, set, onValue, off
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

/* ---------- Helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const USD = (x)=> `$${Number(x||0).toFixed(2)}`;
const ADMIN_EMAILS = ['admin@inventory.com','minmaung0307@gmail.com'];
const notify = (msg)=>{ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className='notification show'; setTimeout(()=>n.className='notification',2200); };
const deepEq = (a,b)=> JSON.stringify(a)===JSON.stringify(b);

/* ---------- Firebase bootstrap (modular; CSP-safe) ---------- */
const FIREBASE_CONFIG = window.__FIREBASE_CONFIG || {
  apiKey: "AIzaSyAlElNC22VZKTGu4QkF0rUl_vdbY4k5_pA",
        authDomain: "inventory-us.firebaseapp.com",
        databaseURL: "https://inventory-us-default-rtdb.firebaseio.com",
        projectId: "inventory-us",
        storageBucket: "inventory-us.firebasestorage.app",
        messagingSenderId: "685621968644",
        appId: "1:685621968644:web:a88ec978f1ab9b4f49da51",
        measurementId: "G-L6NRD0B1B6",
};
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ---------- State ---------- */
let state = {
  session: null,
  route: 'dashboard',
  posts: [], inventory: [], products: [], tasks: [], cogs: [], users: [],
  theme: { mode:'sky', size:'medium' },
  registry: {}
};
function uid(){ return state.session?.uid || auth.currentUser?.uid || null; }
function pathKV(k){ return ref(db, `tenants/${uid()}/kv/${k}`); }

/* ---------- Theme (pure apply + explicit persist on user change) ---------- */
const THEME_SIZES = [{key:'small',pct:90},{key:'medium',pct:100},{key:'large',pct:112}];
function applyTheme(theme){
  const t = theme || state.theme;
  const pct = (THEME_SIZES.find(s=>s.key===t.size)?.pct) ?? 100;
  document.documentElement.setAttribute('data-theme', t.mode || 'sky');
  document.documentElement.style.setProperty('--font-scale', pct + '%');
}
async function persistThemeIfChanged(next){
  if (deepEq(next, state.theme)) return;
  state.theme = next; applyTheme(next);
  try{ await set(pathKV('_theme'), { key:'_theme', val: next }); }catch(e){ console.warn('save theme', e); }
}

/* ---------- Live sync ---------- */
const CLOUD_KEYS = ['posts','inventory','products','tasks','cogs','users','_theme'];
let liveRefs = [];
function stopLiveSync(){
  liveRefs.forEach(r => off(r));
  liveRefs = [];
}
function startLiveSync(){
  if (!uid()) return;
  stopLiveSync();
  CLOUD_KEYS.forEach(k=>{
    const r = pathKV(k);
    onValue(r, snap=>{
      const row = snap.val();
      if (!row) return;
      if (k==='_theme'){ state.theme = row.val || state.theme; applyTheme(state.theme); }
      else { state[k.replace(/^_/, '')] = row.val || []; }
      renderApp();
    });
    liveRefs.push(r);
  });
  onValue(ref(db, `registry/users`), snap=>{ state.registry = snap.val()||{}; renderApp(); });
}

/* ---------- Roles ---------- */
async function ensureRoleOnFirstLogin(){
  if (!uid()) return;
  const roleRef = ref(db, `userRoles/${uid()}`);
  const snap = await get(roleRef);
  if (!snap.exists()){
    const email = (auth.currentUser?.email||'').toLowerCase();
    const firstRole = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    try{ await set(roleRef, firstRole); }catch(e){ console.warn('seed role failed', e); }
  }
}
async function fetchRole(){
  if (!uid()) return 'user';
  try{ const s = await get(ref(db, `userRoles/${uid()}`)); return s.exists()? s.val() : 'user'; }
  catch{ return 'user'; }
}
function canAdd(){ return ['admin','manager','associate'].includes(state.session?.role || 'user'); }
function canEdit(){ return ['admin','manager'].includes(state.session?.role || 'user'); }
function canDelete(){ return ['admin'].includes(state.session?.role || 'user'); }

/* ---------- Auto logout (20 min) ---------- */
const AUTO_LOGOUT_MIN = 20;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart'].forEach(evt=> document.addEventListener(evt, ()=>{ __lastActivity=Date.now(); }, {passive:true}));
setInterval(()=> { if (!auth.currentUser) return; if (Date.now() - __lastActivity > AUTO_LOGOUT_MIN*60*1000) doLogout(); }, 30000);

/* ---------- Sidebar / Topbar / Router ---------- */
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
        <label for="globalSearch">Search</label>
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
function go(route){ state.route = route; renderApp(); }
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

/* ---------- Search ---------- */
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
  return index.map(item=>{
    const label=norm(item.label), text=norm(item.text||''); let hits=0;
    const ok = tokens.every(t=>{ const hit = label.includes(t)||text.includes(t); if(hit) hits++; return hit; });
    const score = ok ? (hits*3 + (label.includes(tokens[0]||'')?2:0)) : 0;
    return { item, score };
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
}
let __wiredSearchClose=false;
function hookSidebarInteractions(){
  const input = $('#globalSearch'), results = $('#searchResults');
  if (!input || !results) return;
  const openResult = (r)=>{
    go(r.route);
    setTimeout(()=>{ try{ const el=document.getElementById(r.id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});}catch{} }, 80);
    results.classList.remove('active');
    input.value='';
  };
  let timer;
  input.onkeydown = (e)=>{ if (e.key === 'Enter'){ const q=input.value.trim(); if(!q)return; const out=searchAll(buildSearchIndex(), q); if(out[0]) openResult(out[0]); } };
  input.oninput = ()=>{
    clearTimeout(timer);
    const q=input.value.trim(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer=setTimeout(()=>{
      const out=searchAll(buildSearchIndex(), q).slice(0,10);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=> openResult({route:row.getAttribute('data-route'), id:row.getAttribute('data-id')});
      });
    }, 150);
  };
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

/* ---------- Pages ---------- */
function viewDashboard(){
  const posts=state.posts||[], inv=state.inventory||[], prods=state.products||[], users=state.users||[], tasks=state.tasks||[], cogs=state.cogs||[];
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
  return `
    <div class="grid cols-4 auto">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Total Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
    </div>

    <div class="grid cols-4 auto" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn); background:rgba(245,158,11,.08)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger); background:rgba(239,68,68,.10)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>

      <div class="card"><div class="card-body">
        <div class="space-between">
          <strong>Quick Actions</strong>
          <div class="flex">
            <button class="btn ghost" data-go="inventory"><i class="ri-add-line"></i> Add Inventory</button>
            <button class="btn ghost" data-go="products"><i class="ri-add-line"></i> Add Product</button>
            <button class="btn ghost" data-go="tasks"><i class="ri-add-line"></i> Add Task</button>
          </div>
        </div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="head"><strong>Posts</strong>${canAdd()?`<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}</div>
      <div class="card-body">
        ${(posts||[]).length? posts.map(p=>`
          <div class="card" id="${p.id}" style="margin-bottom:10px">
            <div class="card-body">
              <div class="space-between">
                <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:12px">${new Date(p.createdAt).toLocaleString()}</div></div>
                <div>
                  ${canEdit()?`<button class="btn ghost" data-edit="${p.id}" data-scope="post"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()?`<button class="btn danger" data-del="${p.id}" data-scope="post"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </div>
              </div>
              <p style="margin-top:8px">${p.body}</p>
            </div>
          </div>`).join('') : `<p style="color:var(--muted)">No posts yet.</p>`}
      </div>
    </div>`;
}
function wireDashboard(){
  $('#addPost')?.addEventListener('click', ()=>{ openModal('m-post'); $('#post-id').value=''; $('#post-title').value=''; $('#post-body').value=''; });
  document.querySelector('.card-body')?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    if (btn.dataset.scope!=='post') return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if(!id) return;
    const posts = state.posts.slice();
    if (btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const p = posts.find(x=>x.id===id); if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body;
    } else {
      if(!canDelete()) return notify('No permission');
      const next = posts.filter(x=>x.id!==id);
      state.posts = next;
      set(pathKV('posts'), {key:'posts', val: next});
      renderApp();
    }
  });
  $$('.tile[data-go]').forEach(el=> el.addEventListener('click', ()=> go(el.getAttribute('data-go')) ));
}

function viewInventory(){
  const items=state.inventory||[];
  return `
    <div class="card">
      <div class="head"><strong>Inventory</strong><div>${canAdd()?`<button class="btn" id="addInv"><i class="ri-add-line"></i> Add Item</button>`:''} <button class="btn ok" id="export-inventory"><i class="ri-download-2-line"></i> Export CSV</button></div></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Threshold</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td><td class="num">${USD(it.price)}</td>
                <td class="num">${canAdd()? `<button class="btn ghost" data-dec="${it.id}">–</button> <span style="padding:0 10px">${it.stock}</span> <button class="btn ghost" data-inc="${it.id}">+</button>`: it.stock}</td>
                <td class="num">${canAdd()? `<button class="btn ghost" data-dec-th="${it.id}">–</button> <span style="padding:0 10px">${it.threshold}</span> <button class="btn ghost" data-inc-th="${it.id}">+</button>`: it.threshold}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
function wireInventory(){
  $('#export-inventory')?.addEventListener('click', ()=>{
    const rows=state.inventory||[]; const headers=['id','name','code','type','price','stock','threshold'];
    const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='inventory.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
  });
  $('#addInv')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-inv'); $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other';
    $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';
  });
  document.querySelector('.table')?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id = btn.getAttribute('data-edit')||btn.getAttribute('data-del')||btn.getAttribute('data-inc')||btn.getAttribute('data-dec')||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th');
    if(!id) return;
    const items = state.inventory.slice(); const it = items.find(x=>x.id===id); if(!it && (btn.hasAttribute('data-edit')||btn.hasAttribute('data-del'))) return;

    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      openModal('m-inv'); $('#inv-id').value=it.id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other';
      $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold;
      return;
    }
    if(btn.hasAttribute('data-del')){
      if(!canDelete()) return notify('No permission');
      const next=items.filter(x=>x.id!==id); state.inventory=next; set(pathKV('inventory'), {key:'inventory', val: next}); renderApp(); return;
    }
    if(!canAdd()) return notify('No permission');
    const t=items.find(x=>x.id===id); if(!t) return;
    if(btn.hasAttribute('data-inc')) t.stock++;
    if(btn.hasAttribute('data-dec')) t.stock=Math.max(0,t.stock-1);
    if(btn.hasAttribute('data-inc-th')) t.threshold++;
    if(btn.hasAttribute('data-dec-th')) t.threshold=Math.max(0,t.threshold-1);
    state.inventory=items; set(pathKV('inventory'), {key:'inventory', val: items}); renderApp();
  });
}

function viewProducts(){
  const items=state.products||[];
  return `
    <div class="card">
      <div class="head"><strong>Products</strong><div>${canAdd()?`<button class="btn" id="addProd"><i class="ri-add-line"></i> Add Product</button>`:''} <button class="btn ok" id="export-products"><i class="ri-download-2-line"></i> Export CSV</button></div></div>
      <div class="table-wrap" data-section="products">
        <table class="table">
          <thead><tr><th>Name</th><th>Barcode</th><th class="num">Price</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.map(it=>`
              <tr id="${it.id}">
                <td><span class="clicky" data-card="${it.id}">${it.name}</span></td>
                <td>${it.barcode||''}</td><td class="num">${USD(it.price)}</td><td>${it.type||'-'}</td>
                <td>
                  ${canEdit()? `<button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Product card modal -->
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
    </div>`;
}
function wireProducts(){
  $('#export-products')?.addEventListener('click', ()=>{
    const rows=state.products||[]; const headers=['id','name','barcode','price','type','ingredients','instructions'];
    const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='products.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
  });
  $('#addProd')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-prod'); $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value='';
    $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';
  });
  document.querySelector('[data-section="products"]')?.addEventListener('click',(e)=>{
    const card = e.target.closest('.clicky');
    if (card){
      const id=card.getAttribute('data-card'); const it=(state.products||[]).find(x=>x.id===id); if(!it) return;
      $('#pc-name').textContent=it.name; $('#pc-barcode').textContent=it.barcode||''; $('#pc-price').textContent=USD(it.price); $('#pc-type').textContent=it.type||'';
      $('#pc-ingredients').textContent=it.ingredients||''; $('#pc-instructions').textContent=it.instructions||''; openModal('m-card'); return;
    }
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items = state.products.slice();
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const it=items.find(x=>x.id===id); if(!it) return;
      openModal('m-prod'); $('#prod-id').value=id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||''; $('#prod-price').value=it.price;
      $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||''; $('#prod-instructions').value=it.instructions||'';
    }else{
      if(!canDelete()) return notify('No permission');
      const next=items.filter(x=>x.id!==id); state.products=next; set(pathKV('products'), {key:'products', val: next}); renderApp();
    }
  });
}

function viewCOGS(){
  const rows=state.cogs||[];
  const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0));
  const totals=rows.reduce((a,r)=>({grossIncome:a.grossIncome+(+r.grossIncome||0),produceCost:a.produceCost+(+r.produceCost||0),itemCost:a.itemCost+(+r.itemCost||0),freight:a.freight+(+r.freight||0),other:a.other+(+r.other||0)}),{grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
  const totalProfit=gp(totals);
  return `
    <div class="card">
      <div class="head"><strong>COGS</strong><div>${canAdd()?`<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''} <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button></div></div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead><tr><th>Date</th><th class="num">G-Income</th><th class="num">Produce</th><th class="num">Item</th><th class="num">Freight</th><th class="num">Other</th><th class="num">G-Profit</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td><td class="num">${USD(r.grossIncome)}</td><td class="num">${USD(r.produceCost)}</td><td class="num">${USD(r.itemCost)}</td>
                <td class="num">${USD(r.freight)}</td><td class="num">${USD(r.other)}</td><td class="num">${USD(gp(r))}</td>
                <td>${canEdit()? `<button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}</td>
              </tr>`).join('')}
            <tr class="tr-total">
              <th>Total</th><th class="num">${USD(totals.grossIncome)}</th><th class="num">${USD(totals.produceCost)}</th><th class="num">${USD(totals.itemCost)}</th>
              <th class="num">${USD(totals.freight)}</th><th class="num">${USD(totals.other)}</th><th class="num">${USD(totalProfit)}</th><th></th>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="foot">
        <div class="grid cols-3">
          <div>
            <label for="cogs-year">Export by Year</label>
            <input id="cogs-year" class="input" type="number" placeholder="e.g. 2025"/>
          </div>
          <div>
            <label for="cogs-month">Export by Month (1-12)</label>
            <input id="cogs-month" class="input" type="number" min="1" max="12" placeholder="e.g. 8"/>
          </div>
          <div style="display:flex;align-items:flex-end"><button class="btn" id="export-cogs-range"><i class="ri-download-2-line"></i> Export Range</button></div>
        </div>
      </div>
    </div>`;
}
function wireCOGS(){
  // 1) Full COGS export
$('#export-cogs')?.addEventListener('click', ()=>{
  const rows = state.cogs || [];
  const headers = ['id','date','grossIncome','produceCost','itemCost','freight','other'];
  const csv = [headers.join(',')]
    .concat(
      rows.map(r =>
        headers
          .map(h => String(r[h] ?? '').replace(/"/g, '""'))  // <-- fixed here
          .map(s => /[",\n]/.test(s) ? `"${s}"` : s)
          .join(',')
      )
    )
    .join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cogs.csv'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
});

  // 2) Year/Month range export
$('#export-cogs-range')?.addEventListener('click', ()=>{
  const y = +($('#cogs-year')?.value || 0), m = +($('#cogs-month')?.value || 0);
  const rows = (state.cogs || []).filter(r=>{
    const d = r.date || ''; const Y = +d.slice(0,4), M = +d.slice(5,7);
    if (y && m) return Y===y && M===m;
    if (y && !m) return Y===y;
    return true;
  });
  const headers = ['id','date','grossIncome','produceCost','itemCost','freight','other'];
  const csv = [headers.join(',')]
    .concat(
      rows.map(r =>
        headers
          .map(h => String(r[h] ?? '').replace(/"/g, '""'))  // <-- fixed here too
          .map(s => /[",\n]/.test(s) ? `"${s}"` : s)
          .join(',')
      )
    )
    .join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = y ? (m ? `cogs_${y}-${String(m).padStart(2,'0')}.csv` : `cogs_${y}.csv`) : 'cogs_range.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
});

  $('#addCOGS')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-cogs'); $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10);
    $('#cogs-grossIncome').value=''; $('#cogs-produceCost').value=''; $('#cogs-itemCost').value=''; $('#cogs-freight').value=''; $('#cogs-other').value='';
  });
  document.querySelector('[data-section="cogs"]')?.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const rows = state.cogs.slice();
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const r=rows.find(x=>x.id===id); if(!r) return;
      openModal('m-cogs');
      $('#cogs-id').value=id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome;
      $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-other').value=r.other;
    }else{
      if(!canDelete()) return notify('No permission');
      const next=rows.filter(x=>x.id!==id); state.cogs=next; set(pathKV('cogs'), {key:'cogs', val: next}); renderApp();
    }
  });
}

function viewTasks(){
  const items=state.tasks||=[];
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="head"><h3 style="margin:0;color:${color};font-size:16px">${label}</h3></div>
      <div class="card-body">
        ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        <div class="grid lane-grid" id="lane-${key}">
          ${items.filter(t=>t.status===key).map(t=>`
            <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
              <div class="card-body space-between">
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
  return `<div data-section="tasks" class="grid cols-3">
    ${lane('todo','To do','#f59e0b')}
    ${lane('inprogress','In progress','#3b82f6')}
    ${lane('done','Done','#10b981')}
  </div>`;
}
function wireTasks(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;
  $('#addTask')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo';
  });
  root.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    const items=state.tasks.slice();
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const t=items.find(x=>x.id===id); if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      if(!canDelete()) return notify('No permission');
      const next=items.filter(x=>x.id!==id); state.tasks=next; set(pathKV('tasks'), {key:'tasks', val: next}); renderApp();
    }
  });

  // DnD, lanes can be empty
  $$('.task-card').forEach(card=>{
    card.setAttribute('draggable','true'); card.style.cursor='grab';
    card.addEventListener('dragstart',(e)=>{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  $$('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; row?.classList.add('drop'); };
    const hide=()=> row?.classList.remove('drop');
    grid.addEventListener('dragenter', show);
    grid.addEventListener('dragover',  show);
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop',(e)=>{
      e.preventDefault(); hide(); if(!lane) return;
      if (!canAdd()) return notify('No permission');
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const items=state.tasks.slice(); const t=items.find(x=>x.id===id); if(!t) return;
      t.status=lane; state.tasks=items; set(pathKV('tasks'), {key:'tasks', val: items}); renderApp();
    });
  });
}

function viewSettings(){
  const theme=state.theme||{mode:'sky', size:'medium'};
  const users=state.users||[];
  const isAdmin = state.session?.role === 'admin';
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
          <div>
            <label for="theme-mode">Mode</label>
            <select id="theme-mode" class="input">
              <option value="sky" ${theme.mode==='sky'?'selected':''}>Sky (Blue)</option>
              <option value="peach" ${theme.mode==='peach'?'selected':''}>Peach (Soft Orange)</option>
              <option value="mint" ${theme.mode==='mint'?'selected':''}>Mint (Soft Green)</option>
              <option value="dark" ${theme.mode==='dark'?'selected':''}>Dark</option>
            </select>
          </div>
          <div>
            <label for="theme-size">Font Size</label>
            <select id="theme-size" class="input">
              <option value="small" ${theme.size==='small'?'selected':''}>Small</option>
              <option value="medium" ${theme.size==='medium'?'selected':''}>Medium</option>
              <option value="large" ${theme.size==='large'?'selected':''}>Large</option>
            </select>
          </div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <div class="space-between">
          <h3 style="margin:0">Users</h3>
          ${canAdd()? `<button class="btn" id="addUser"><i class="ri-user-add-line"></i> Add User</button>`:''}
        </div>
        <div class="table-wrap" data-section="users">
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u=>`
                <tr id="${u.email}">
                  <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
                  <td>
                    ${canEdit()? `<button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                    ${isAdmin? `<button class="btn secondary" data-role="${u.email}"><i class="ri-shield-user-line"></i> Set Role</button>`:''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    </div>`;
}
function allowedRoleOptions(){
  const r=state.session?.role||'user'; if(r==='admin') return ['user','associate','manager','admin'];
  if(r==='manager') return ['user','associate','manager']; if(r==='associate') return ['user','associate']; return ['user'];
}
function wireSettings(){
  const mode=$('#theme-mode'), size=$('#theme-size');
  const onChange=async ()=>{ await persistThemeIfChanged({ mode:mode.value, size:size.value }); };
  mode?.addEventListener('change', onChange); size?.addEventListener('change', onChange);

  // Users CRUD + roles
  $('#addUser')?.addEventListener('click', ()=>{
    if(!canAdd()) return notify('No permission');
    openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value='';
    const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=opts[0];
  });
  document.querySelector('[data-section="users"]')?.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del')||btn.getAttribute('data-role'); if(!email) return;
    const users = state.users.slice();
    if(btn.hasAttribute('data-edit')){
      if(!canEdit()) return notify('No permission');
      const u=users.find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username;
      const sel=$('#user-role'); const opts=allowedRoleOptions(); sel.innerHTML=opts.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value= opts.includes(u.role) ? u.role : 'user';
    } else if (btn.hasAttribute('data-del')){
      if(!canDelete()) return notify('No permission');
      const next=users.filter(x=>x.email!==email); state.users=next; set(pathKV('users'), {key:'users', val: next}); renderApp();
    } else if (btn.hasAttribute('data-role')) {
      if (state.session?.role!=='admin') return notify('Admins only');
      const u=users.find(x=>x.email===email); if(!u) return;
      const newRole = prompt('Set role (user, associate, manager, admin):', u.role||'user'); if(!/^(user|associate|manager|admin)$/.test(newRole||'')) return;
      u.role = newRole; state.users = users; set(pathKV('users'), {key:'users', val: users});
      set(ref(db, `userRoles/${u.uid||''}`), newRole).catch(()=>{});
      renderApp();
    }
  });
}

/* ---------- Static pages ---------- */
const pageContent = {
  about: `<h3>About Inventory</h3>
  <p>Inventory is a mobile-first, offline-friendly app to manage stock, products, costs (COGS) and tasks.</p>
  <ul>
    <li>Realtime sync per user (your data is isolated under your account)</li>
    <li>CSV exports (Inventory, Products, COGS by month/year)</li>
    <li>Roles: user, associate, manager, admin</li>
    <li>Modern theming with Sky / Peach / Mint / Dark</li>
  </ul>`,

  policy: `<h3>Policy</h3>
  <p><strong>Data:</strong> Stored under your Firebase user. We do not sell your data.</p>
  <p><strong>Security:</strong> Uses Firebase Authentication and Realtime Database rules for row-level access.</p>
  <p><strong>Support:</strong> Email <a href="mailto:minmaung0307@gmail.com">minmaung0307@gmail.com</a>.</p>`,

  license: `<h3>License</h3>
  <p>MIT License — free to use, modify, and distribute. Attribution appreciated.</p>`,

  setup: `<h3>Setup Guide</h3>
  <ol>
    <li>Create a Firebase project, enable Email/Password auth.</li>
    <li>Paste the config into <code>index.html</code> (window.__FIREBASE_CONFIG).</li>
    <li>Deploy the <strong>Realtime Database Rules</strong>.</li>
    <li>Deploy this <code>public/</code> folder to Firebase Hosting.</li>
  </ol>`,

  guide: `<h3>User Guide</h3>
  <p>Use the sidebar to navigate. Click product names to open detail cards. Drag tasks between lanes. Export tables as CSV. Set theme + font size in Settings.</p>`,

  contact:`<h3>Contact</h3>
  <p>Questions? Email <a class="btn secondary" href="mailto:minmaung0307@gmail.com?subject=Hello%20from%20Inventory"><i class="ri-mail-send-line"></i> minmaung0307@gmail.com</a></p>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key]||'<p>Page</p>'}</div></div>`; }

/* ---------- Modals ---------- */
function modalsHTML(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post">
    <div class="dialog">
      <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post">Close</button></div>
      <div class="body grid">
        <input id="post-id" type="hidden"/>
        <label for="post-title">Title</label>
        <input id="post-title" class="input" placeholder="Title"/>
        <label for="post-body">Body</label>
        <textarea id="post-body" class="input" placeholder="Body"></textarea>
      </div>
      <div class="foot"><button class="btn" id="save-post">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv">
    <div class="dialog">
      <div class="head"><strong>Inventory Item</strong><button class="btn ghost" data-close="m-inv">Close</button></div>
      <div class="body grid">
        <input id="inv-id" type="hidden"/>
        <label for="inv-name">Name</label>
        <input id="inv-name" class="input" placeholder="Name"/>
        <label for="inv-code">Code</label>
        <input id="inv-code" class="input" placeholder="Code"/>
        <label for="inv-type">Type</label>
        <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dry</option><option>Other</option></select>
        <label for="inv-price">Price</label>
        <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <label for="inv-stock">Stock</label>
        <input id="inv-stock" class="input" type="number" placeholder="Stock"/>
        <label for="inv-threshold">Threshold</label>
        <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/>
      </div>
      <div class="foot"><button class="btn" id="save-inv">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod">
    <div class="dialog">
      <div class="head"><strong>Product</strong><button class="btn ghost" data-close="m-prod">Close</button></div>
      <div class="body grid">
        <input id="prod-id" type="hidden"/>
        <label for="prod-name">Name</label>
        <input id="prod-name" class="input" placeholder="Name"/>
        <label for="prod-barcode">Barcode</label>
        <input id="prod-barcode" class="input" placeholder="Barcode"/>
        <label for="prod-price">Price</label>
        <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/>
        <label for="prod-type">Type</label>
        <input id="prod-type" class="input" placeholder="Type"/>
        <label for="prod-ingredients">Ingredients</label>
        <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
        <label for="prod-instructions">Instructions</label>
        <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
      </div>
      <div class="foot"><button class="btn" id="save-prod">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs">
    <div class="dialog">
      <div class="head"><strong>COGS Row</strong><button class="btn ghost" data-close="m-cogs">Close</button></div>
      <div class="body grid cols-2">
        <input id="cogs-id" type="hidden"/>
        <div><label for="cogs-date">Date</label><input id="cogs-date" class="input" type="date"/></div>
        <div><label for="cogs-grossIncome">G-Income</label><input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="Gross Income"/></div>
        <div><label for="cogs-produceCost">Produce Cost</label><input id="cogs-produceCost"  class="input" type="number" step="0.01" placeholder="Produce Cost"/></div>
        <div><label for="cogs-itemCost">Item Cost</label><input id="cogs-itemCost"     class="input" type="number" step="0.01" placeholder="Item Cost"/></div>
        <div><label for="cogs-freight">Freight</label><input id="cogs-freight"      class="input" type="number" step="0.01" placeholder="Freight"/></div>
        <div><label for="cogs-other">Other</label><input id="cogs-other"        class="input" type="number" step="0.01" placeholder="Other"/></div>
      </div>
      <div class="foot"><button class="btn" id="save-cogs">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task">
    <div class="dialog">
      <div class="head"><strong>Task</strong><button class="btn ghost" data-close="m-task">Close</button></div>
      <div class="body grid">
        <input id="task-id" type="hidden"/>
        <label for="task-title">Title</label>
        <input id="task-title" class="input" placeholder="Title"/>
        <label for="task-status">Status</label>
        <select id="task-status"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
      </div>
      <div class="foot"><button class="btn" id="save-task">Save</button></div>
    </div>
  </div>

  <div class="modal-backdrop" id="mb-user"></div>
  <div class="modal" id="m-user">
    <div class="dialog">
      <div class="head"><strong>User</strong><button class="btn ghost" data-close="m-user">Close</button></div>
      <div class="body grid">
        <label for="user-name">Name</label>
        <input id="user-name" class="input" placeholder="Name"/>
        <label for="user-email">Email</label>
        <input id="user-email" class="input" type="email" placeholder="Email"/>
        <label for="user-username">Username</label>
        <input id="user-username" class="input" placeholder="Username"/>
        <label for="user-role">Role</label>
        <select id="user-role"></select>
      </div>
      <div class="foot"><button class="btn" id="save-user">Save</button></div>
    </div>
  </div>

  <!-- Product card modal is in viewProducts() -->
`; }
function ensureGlobalModals(){
  if ($('#__modals')) return;
  const wrap=document.createElement('div'); wrap.id='__modals'; wrap.innerHTML=modalsHTML(); document.body.appendChild(wrap);
  // Close handlers
  document.body.addEventListener('click', (e)=>{
    const c=e.target.closest('[data-close]'); if(!c) return; const id=c.getAttribute('data-close');
    $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open');
  });
}
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.add('active'); document.body.classList.add('modal-open'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active'); document.body.classList.remove('modal-open'); }

/* ---------- App shell ---------- */
function renderApp(){
  const root = $('#root'); if (!root) return;
  if (!state.session){
    renderLogin(); return;
  }
  root.innerHTML = `
    <div class="app">
      ${renderSidebar(state.route)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">${safeView(state.route)}</div>
      </div>
    </div>`;
  // wiring
  $('#btnLogout')?.addEventListener('click', doLogout);
  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=> el.addEventListener('click', ()=> go(el.getAttribute('data-route')) ));
  hookSidebarInteractions();
  ensureGlobalModals();
  wirePage(state.route);
  wireSaves(); // <— moved here; wrapper removed
}
function wirePage(route){
  hookSidebarInteractions();
  switch(route){
    case 'dashboard': wireDashboard(); wirePosts(); break;
    case 'inventory': wireInventory(); break;
    case 'products':  wireProducts(); break;
    case 'cogs':      wireCOGS(); break;
    case 'tasks':     wireTasks(); break;
    case 'settings':  wireSettings(); break;
  }
}

/* ---------- Post save ---------- */
function wirePosts(){
  $('#save-post')?.addEventListener('click', async ()=>{
    const id=$('#post-id').value || ('post_'+Date.now());
    const obj={ id, title:($('#post-title')?.value||'').trim(), body:($('#post-body')?.value||'').trim(), createdAt: Date.now() };
    if (!obj.title) return notify('Title required');
    const posts = state.posts.slice(); const i=posts.findIndex(x=>x.id===id);
    if (i>=0){ if(!canEdit()) return notify('No permission'); posts[i]=obj; } else { if(!canAdd()) return notify('No permission'); posts.unshift(obj); }
    state.posts=posts; await set(pathKV('posts'), {key:'posts', val: posts}); closeModal('m-post'); notify('Saved'); renderApp();
  });
}

/* ---------- Inventory / Product / COGS / Task / User saves ---------- */
function wireSaves(){
  $('#save-inv')?.addEventListener('click', async ()=>{
    const id=$('#inv-id').value || ('inv_'+Date.now());
    const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(), price:+($('#inv-price').value||0), stock:+($('#inv-stock').value||0), threshold:+($('#inv-threshold').value||0) };
    if (!obj.name) return notify('Name required');
    const items=state.inventory.slice(); const i=items.findIndex(x=>x.id===id);
    if (i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else { if(!canAdd()) return notify('No permission'); items.push(obj); }
    state.inventory=items; await set(pathKV('inventory'), {key:'inventory', val: items}); closeModal('m-inv'); notify('Saved'); renderApp();
  });

  $('#save-prod')?.addEventListener('click', async ()=>{
    const id=$('#prod-id').value || ('p_'+Date.now());
    const obj={ id, name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(), price:+($('#prod-price').value||0), type:$('#prod-type').value.trim(), ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim() };
    if (!obj.name) return notify('Name required');
    const items=state.products.slice(); const i=items.findIndex(x=>x.id===id);
    if (i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else { if(!canAdd()) return notify('No permission'); items.push(obj); }
    state.products=items; await set(pathKV('products'), {key:'products', val: items}); closeModal('m-prod'); notify('Saved'); renderApp();
  });

  $('#save-cogs')?.addEventListener('click', async ()=>{
    const id=$('#cogs-id').value || ('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value || new Date().toISOString().slice(0,10), grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0), itemCost:+($('#cogs-itemCost').value||0), freight:+($('#cogs-freight').value||0), other:+($('#cogs-other').value||0) };
    const rows=state.cogs.slice(); const i=rows.findIndex(x=>x.id===id);
    if (i>=0){ if(!canEdit()) return notify('No permission'); rows[i]=row; } else { if(!canAdd()) return notify('No permission'); rows.push(row); }
    state.cogs=rows; await set(pathKV('cogs'), {key:'cogs', val: rows}); closeModal('m-cogs'); notify('Saved'); renderApp();
  });

  $('#save-task')?.addEventListener('click', async ()=>{
    const id=$('#task-id').value || ('t_'+Date.now());
    const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value || 'todo' };
    if (!obj.title) return notify('Title required');
    const items=state.tasks.slice(); const i=items.findIndex(x=>x.id===id);
    if (i>=0){ if(!canEdit()) return notify('No permission'); items[i]=obj; } else { if(!canAdd()) return notify('No permission'); items.push(obj); }
    state.tasks=items; await set(pathKV('tasks'), {key:'tasks', val: items}); closeModal('m-task'); notify('Saved'); renderApp();
  });

  $('#save-user')?.addEventListener('click', async ()=>{
    const email=($('#user-email')?.value||'').trim().toLowerCase();
    if (!email) return notify('Email required');
    const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:($('#user-role')?.value||'user'), contact:'' };
    const users=state.users.slice(); const i=users.findIndex(x=> (x.email||'').toLowerCase()===email);
    if (i>=0){ if(!canEdit()) return notify('No permission'); users[i]=obj; } else { if(!canAdd()) return notify('No permission'); users.push(obj); }
    state.users=users; await set(pathKV('users'), {key:'users', val: users}); closeModal('m-user'); notify('Saved'); renderApp();
  });
}

/* ---------- Login screen ---------- */
function renderLogin(){
  const root = $('#root');
  root.innerHTML = `
    <div class="login">
      <div class="card login-card" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div class="card-body">
          <div class="login-logo"><div class="logo">📦</div><div id="login-title" style="font-weight:800;font-size:20px">Inventory</div></div>
          <p class="login-note" style="color:var(--muted)">Sign in to continue</p>
          <div class="grid">
            <div>
              <label for="li-email">Email</label>
              <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
            </div>
            <div>
              <label for="li-pass">Password</label>
              <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
            </div>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div class="link-row">
              <a id="link-forgot" href="#" class="btn secondary"><i class="ri-key-2-line"></i> Forgot password</a>
              <a id="link-register" href="#" class="btn ghost"><i class="ri-user-add-line"></i> Sign up</a>
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
          <label for="su-name">Full name</label><input id="su-name"  class="input" placeholder="Full name"/>
          <label for="su-email">Email</label><input id="su-email" class="input" type="email" placeholder="Email"/>
          <label for="su-pass">Password</label><input id="su-pass"  class="input" type="password" placeholder="Password"/>
          <label for="su-pass2">Confirm password</label><input id="su-pass2" class="input" type="password" placeholder="Confirm password"/>
        </div>
        <div class="foot"><button class="btn" id="btnSignupDo"><i class="ri-user-add-line"></i> Sign up</button></div>
      </div>
    </div>

    <div class="modal" id="m-reset">
      <div class="dialog">
        <div class="head"><strong>Reset password</strong><button class="btn ghost" id="cl-reset">Close</button></div>
        <div class="body grid">
          <label for="fp-email">Your email</label>
          <input id="fp-email" class="input" type="email" placeholder="Your email"/>
        </div>
        <div class="foot"><button class="btn" id="btnResetDo"><i class="ri-mail-send-line"></i> Send reset email</button></div>
      </div>
    </div>
  `;

  const openAuth = sel => { $('#mb-auth')?.classList.add('active'); $(sel)?.classList.add('active'); document.body.classList.add('modal-open'); };
  const closeAuth = ()=>{ $('#mb-auth')?.classList.remove('active'); $('#m-signup')?.classList.remove('active'); $('#m-reset')?.classList.remove('active'); document.body.classList.remove('modal-open'); };

  async function doSignIn(){
    const email = ($('#li-email')?.value||'').trim().toLowerCase();
    const pass  = $('#li-pass')?.value||'';
    if(!email || !pass) return notify('Enter email & password');
    try{ await signInWithEmailAndPassword(auth, email, pass); notify('Welcome'); }catch(e){ notify(e?.message||'Login failed'); }
  }
  async function doSignup(){
    const name  = ($('#su-name')?.value||'').trim();
    const email = ($('#su-email')?.value||'').trim().toLowerCase();
    const pass  = $('#su-pass')?.value||'';
    const pass2 = ($('#su-pass2')?.value||'');
    if(!email || !pass) return notify('Email and password required');
    if(pass !== pass2) return notify('Passwords do not match');
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name || email.split('@')[0] });
      notify('Account created — signed in');
      closeAuth();
    }catch(e){ notify(e?.message||'Signup failed'); }
  }
  async function doReset(){
    const email = ($('#fp-email')?.value||'').trim().toLowerCase();
    if(!email) return notify('Enter your email');
    try{ await sendPasswordResetEmail(auth, email); notify('Reset email sent'); closeAuth(); }catch(e){ notify(e?.message||'Failed to send'); }
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

/* ---------- Auth ---------- */
onAuthStateChanged(auth, async (user)=>{
  if (!user){
    stopLiveSync();
    state.session = null;
    renderApp();
    return;
  }
  try{ await set(ref(db, `registry/users/${user.uid}`), { email:(user.email||'').toLowerCase(), name: user.displayName||user.email?.split('@')[0]||'User' }); }catch{}
  await ensureRoleOnFirstLogin();
  const role = await fetchRole();
  state.session = { uid:user.uid, email:(user.email||'').toLowerCase(), displayName:user.displayName||'', role };
  startLiveSync();
  renderApp();
});
async function doLogout(){ try{ await signOut(auth); }catch{} stopLiveSync(); state.session=null; renderApp(); }
