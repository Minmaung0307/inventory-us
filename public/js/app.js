/* =========================
   Inventory — Cloud-first SPA (no images, no videos)
   ========================= */

/* ---------- Utils ---------- */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const USD=x=>`$${Number(x||0).toFixed(2)}`;
const notify=(m,t='ok')=>{ const n=$('#notification'); if(!n) return; n.textContent=m; n.className=`notification show ${t}`; setTimeout(()=>{ n.className='notification'; },2100); };
const parseYMD=s=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; };

/* ---------- Firebase ---------- */
if(!firebase?.initializeApp){ console.error('Firebase SDK missing'); }
firebase.apps.length||firebase.initializeApp(window.__FIREBASE_CONFIG||{});
const auth=firebase.auth(), db=firebase.database();

/* ---------- Global state ---------- */
let session=null;          // {uid,email,name,role}
let route='home';          // current route
let state={                // mirrors RTDB
  settings:{ theme:{mode:'sky', size:'medium'} },
  inventory:{}, products:{}, posts:{}, tasks:{}, cogs:{}, users:{}
};

/* ---------- DB helpers ---------- */
const path=(p='')=>`tenants/${auth.currentUser?.uid}/${p}`;
const ref=(p)=>db.ref(path(p));
const listToArray=(obj={})=>Object.values(obj||{});

/* ---------- Theme ---------- */
const THEMES=[
  {key:'sunrise',label:'Sunrise (soft peach)'},
  {key:'sky',label:'Sky (soft blue)'},
  {key:'mint',label:'Mint (soft green)'},
  {key:'slate',label:'Slate (neutral)'},
  {key:'midnight',label:'Midnight (dark)'}
];
const FONT_SIZES=[{key:'small',pct:90,label:'Small'},{key:'medium',pct:100,label:'Medium'},{key:'large',pct:112,label:'Large'}];

function applyTheme(){
  const t=state.settings?.theme||{mode:'sky',size:'medium'};
  const sizePct = (FONT_SIZES.find(s=>s.key===t.size)?.pct) ?? 100;
  document.documentElement.setAttribute('data-theme', t.mode);
  document.documentElement.style.setProperty('--font-scale', sizePct+'%');
}
async function saveTheme(mode,size){
  state.settings.theme={mode,size};
  applyTheme();
  try{ await ref('settings/theme').set(state.settings.theme); }catch(e){ notify(e?.message||'Theme save failed','warn'); }
}

/* ---------- Auth ---------- */
auth.onAuthStateChanged(async user=>{
  if(!user){ renderLogin(); return; }
  session={ uid:user.uid, email:user.email||'', name:user.displayName||user.email?.split('@')[0]||'User', role:'user' };
  await subscribeAll();
  renderApp();
});

function renderLogin(){
  $('#root').innerHTML=`
    <div class="login" style="display:grid;place-items:center;min-height:100vh">
      <div class="card" style="width:min(480px,92vw)">
        <div class="card-body">
          <div class="brand"><div class="logo">📦</div><div class="title">Inventory</div></div>
          <p style="color:var(--muted);margin-top:-6px">Sign in to continue</p>
          <div class="grid">
            <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username" />
            <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password" />
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button id="btnSignup" class="btn secondary"><i class="ri-user-add-line"></i> Create account</button>
              <button id="btnReset"  class="btn ghost"><i class="ri-key-2-line"></i> Reset password</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  $('#btnLogin').onclick=async()=>{
    const email=$('#li-email').value.trim(), pass=$('#li-pass').value;
    if(!email||!pass) return notify('Email & password required','warn');
    try{ await auth.signInWithEmailAndPassword(email,pass); }catch(e){ notify(e?.message||'Login failed','danger'); }
  };
  $('#btnSignup').onclick=async()=>{
    const email=$('#li-email').value.trim(), pass=$('#li-pass').value||'password123';
    if(!email) return notify('Enter an email','warn');
    try{ await auth.createUserWithEmailAndPassword(email, pass); }catch(e){ notify(e?.message||'Signup failed','danger'); }
  };
  $('#btnReset').onclick=async()=>{
    const email=$('#li-email').value.trim(); if(!email) return notify('Enter your email','warn');
    try{ await auth.sendPasswordResetEmail(email); notify('Reset sent'); }catch(e){ notify(e?.message||'Reset failed','danger'); }
  };
}

/* ---------- Subscriptions (live sync) ---------- */
let _subs=[];
async function subscribeAll(){
  _subs.forEach(s=>s.off && s.off()); _subs=[];
  const add=(p,handler)=>{ const r=ref(p); r.on('value',snap=>handler(snap.val())); _subs.push(r); };

  add('settings/theme',v=>{ if(v){ state.settings.theme=v; } applyTheme(); renderShellOnly(); });
  add('inventory',v=>{ state.inventory=v||{}; renderIf('inventory'); });
  add('products', v=>{ state.products =v||{}; renderIf('products'); });
  add('posts',    v=>{ state.posts    =v||{}; renderIf('dashboard'); });
  add('tasks',    v=>{ state.tasks    =v||{}; renderIf('tasks'); });
  add('cogs',     v=>{ state.cogs     =v||{}; renderIf('cogs'); });
  add('users',    v=>{ state.users    =v||{}; renderIf('settings'); });
}

/* ---------- Data ops ---------- */
const addOrUpdate=(col,obj)=>ref(`${col}/${obj.id}`).set(obj);
const removeItem=(col,id)=>ref(`${col}/${id}`).remove();

/* ---------- Rendering helpers ---------- */
function renderShellOnly(){
  if(!$('.app')) return;
  $('#sidebar')?.replaceWith(htmlToEl(renderSidebar(route)));
  $('#topbar')?.replaceWith(htmlToEl(renderTopbar()));
  wireShell();
}
function renderMain(){
  const main=$('#main'); if(!main) return;
  main.innerHTML = safeView(route);
  wireRoute(route);
}
function renderIf(target){
  // Re-render main if we're looking at the affected route or at Home (which shows counts)
  if (route===target || route==='home') renderMain();
}
function htmlToEl(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }

function renderApp(){
  const root=$('#root'); if(!session){ renderLogin(); return; }
  if(!route) route='home';
  root.innerHTML=`
    <div class="app">
      ${renderSidebar(route)}
      <div>
        ${renderTopbar()}
        <div class="main" id="main">${safeView(route)}</div>
      </div>
    </div>`;
  applyTheme();
  wireShell();
  wireRoute(route);
}

/* ---------- Shell ---------- */
function renderSidebar(active='home'){
  const links=[
    {route:'home',icon:'ri-home-5-line',label:'Home'},
    {route:'dashboard',icon:'ri-dashboard-line',label:'Dashboard'},
    {route:'inventory',icon:'ri-archive-2-line',label:'Inventory'},
    {route:'products',icon:'ri-store-2-line',label:'Products'},
    {route:'cogs',icon:'ri-money-dollar-circle-line',label:'COGS'},
    {route:'tasks',icon:'ri-list-check-2',label:'Tasks'},
    {route:'settings',icon:'ri-settings-3-line',label:'Settings'}
  ];
  const pages=[
    {route:'about',icon:'ri-information-line',label:'About'},
    {route:'policy',icon:'ri-shield-check-line',label:'Policy'},
    {route:'license',icon:'ri-copyright-line',label:'License'},
    {route:'setup',icon:'ri-guide-line',label:'Setup Guide'},
    {route:'contact',icon:'ri-customer-service-2-line',label:'Contact'},
    {route:'guide',icon:'ri-book-open-line',label:'User Guide'},
  ];
  return `
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo">📦</div><div class="title">Inventory</div></div>
      <div class="search-wrap">
        <input id="globalSearch" placeholder="Search everything…" autocomplete="off" />
        <div id="searchResults" class="search-results"></div>
      </div>
      <h6 class="menu-caption">Menu</h6>
      <div class="nav">${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}</div>
      <h6 class="links-caption">Links</h6>
      <div class="links">${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}</div>
      <h6 class="social-caption">SOCIAL</h6>
      <div class="socials-row">
        <a href="https://youtube.com" target="_blank" rel="noopener"><i class="ri-youtube-fill"></i></a>
        <a href="https://facebook.com" target="_blank" rel="noopener"><i class="ri-facebook-fill"></i></a>
        <a href="https://instagram.com" target="_blank" rel="noopener"><i class="ri-instagram-line"></i></a>
      </div>
    </aside>`;
}
function renderTopbar(){
  return `
    <div class="topbar" id="topbar">
      <div class="left">
        <div class="burger" id="burger"><i class="ri-menu-line"></i></div>
        <div><strong>${route.replace(/^\w/,c=>c.toUpperCase())}</strong></div>
      </div>
      <div class="right">
        <button class="btn ghost" id="btnHome"><i class="ri-home-5-line"></i> Home</button>
        <button class="btn secondary" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
      </div>
    </div>
    <div class="backdrop" id="backdrop"></div>`;
}
function wireShell(){
  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=>el.onclick=()=>{ route=el.dataset.route; renderApp(); closeSidebar(); });
  $('#btnLogout')?.addEventListener('click', async()=>{ try{ await auth.signOut(); }catch{} });
  $('#btnHome')?.addEventListener('click', ()=>{ route='home'; renderApp(); });
  $('#burger')?.addEventListener('click', openSidebar);
  $('#backdrop')?.addEventListener('click', closeSidebar);
  hookSidebarSearch();
}
function openSidebar(){ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); }
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }

/* ---------- Search ---------- */
function buildSearchIndex(){
  const posts=listToArray(state.posts), inv=listToArray(state.inventory), prods=listToArray(state.products), cogs=listToArray(state.cogs), users=listToArray(state.users);
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
  const norm=s=>(s||'').toLowerCase(); const tokens=norm(q).split(/\s+/).filter(Boolean);
  return index
    .map(item=>{
      const label=norm(item.label), text=norm(item.text||''); let hits=0;
      const ok=tokens.every(t=>{ const hit=label.includes(t)||text.includes(t); if(hit) hits++; return hit; });
      const score= ok ? (hits*3 + (label.includes(tokens[0]||'')?2:0)) : 0;
      return {item, score};
    })
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score)
    .map(x=>x.item);
}
function hookSidebarSearch(){
  const input=$('#globalSearch'), results=$('#searchResults'); if(!input||!results) return;
  let timer;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); } }});
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    const q=input.value.trim().toLowerCase();
    if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer=setTimeout(()=>{
      const out=searchAll(buildSearchIndex(), q).slice(0,12);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section||''}</span></div>`).join('');
      results.classList.add('active');
      results.querySelectorAll('.result').forEach(row=>{
        row.onclick=()=>{ route=row.dataset.route; renderApp(); results.classList.remove('active'); input.value=''; closeSidebar(); setTimeout(()=>{ if(row.dataset.id) scrollIntoViewById(row.dataset.id); },80); };
      });
    },120);
  });
  document.addEventListener('click',(e)=>{ if(!results.contains(e.target)&&e.target!==input){ results.classList.remove('active'); } });
}
function openResultsPage(q){ route='search'; window.__lastQuery=q; renderApp(); }
function scrollIntoViewById(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

/* ---------- Views ---------- */
function safeView(r){
  switch(r){
    case 'home': return viewHome();
    case 'dashboard': return viewDashboard();
    case 'inventory': return viewInventory();
    case 'products': return viewProducts();
    case 'cogs': return viewCOGS();
    case 'tasks': return viewTasks();
    case 'settings': return viewSettings();
    case 'about': case 'policy': case 'license': case 'setup': case 'contact': case 'guide': return viewPage(r);
    case 'search': return viewSearch();
    default: return viewHome();
  }
}

/* Home (no videos) */
function viewHome(){
  const invCt=Object.keys(state.inventory).length;
  const prodCt=Object.keys(state.products).length;
  const usersCt=Object.keys(state.users).length;
  const tasksCt=Object.keys(state.tasks).length;
  return `
  <div class="grid cols-4">
    <div class="card tile" data-go="inventory"><div class="card-body"><i class="ri-archive-2-line"></i><div>Inventory</div><h2>${invCt}</h2></div></div>
    <div class="card tile" data-go="products"><div class="card-body"><i class="ri-store-2-line"></i><div>Products</div><h2>${prodCt}</h2></div></div>
    <div class="card tile" data-go="tasks"><div class="card-body"><i class="ri-list-check-2"></i><div>Tasks</div><h2>${tasksCt}</h2></div></div>
    <div class="card tile" data-go="settings"><div class="card-body"><i class="ri-user-settings-line"></i><div>Users</div><h2>${usersCt}</h2></div></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="card-body">
      <h3 style="margin:0">Welcome 👋</h3>
      <p style="color:var(--muted)">Use the sidebar, search everything, and manage your business on the go. Mobile-first, cloud-synced.</p>
    </div>
  </div>`;
}
function wireHome(){ $$('.card.tile').forEach(el=> el.onclick=()=>{ route=el.dataset.go; renderApp(); }); }

/* Dashboard (restored KPI tiles) + Posts */
function viewDashboard(){
  const posts=listToArray(state.posts).sort((a,b)=>b.createdAt-a.createdAt);
  const inv=listToArray(state.inventory);
  const prods=listToArray(state.products);
  const users=listToArray(state.users);
  const tasks=listToArray(state.tasks);
  const lowCt  = inv.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
  const critCt = inv.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;

  // Month-to-date from COGS
  const today=new Date(); const cy=today.getFullYear(), cm=today.getMonth()+1;
  const py=cm===1?(cy-1):cy, pm=cm===1?12:(cm-1), ly=cy-1, lm=cm;
  const rows=listToArray(state.cogs);
  const parseMonthTotal=(y,m)=>rows.filter(r=>{ const p=parseYMD(r.date); return p && p.y===y && p.m===m; }).reduce((s,r)=>s+(+r.grossIncome||0),0);
  const totalThis=parseMonthTotal(cy,cm), totalPrev=parseMonthTotal(py,pm), totalLY=parseMonthTotal(ly,lm);
  const pct=(a,b)=> (b>0 ? ((a-b)/b)*100 : (a>0?100:0));
  const mom=pct(totalThis,totalPrev), yoy=pct(totalThis,totalLY);
  const fmt=v=>`${v>=0?'+':''}${v.toFixed(1)}%`; const col=v=> v>=0?'var(--ok)':'var(--danger)';

  return `
    <div class="grid cols-4">
      <div class="card tile" data-go="inventory"><div class="card-body"><div>Total Items</div><h2>${inv.length}</h2></div></div>
      <div class="card tile" data-go="products"><div class="card-body"><div>Products</div><h2>${prods.length}</h2></div></div>
      <div class="card tile" data-go="settings"><div class="card-body"><div>Users</div><h2>${users.length}</h2></div></div>
      <div class="card tile" data-go="tasks"><div class="card-body"><div>Tasks</div><h2>${tasks.length}</h2></div></div>
    </div>

    <div class="grid cols-4" style="margin-top:12px">
      <div class="card" style="border-left:4px solid var(--warn); background:rgba(245,158,11,.08)"><div class="card-body"><strong>Low stock</strong><div style="color:var(--muted)">${lowCt}</div></div></div>
      <div class="card" style="border-left:4px solid var(--danger); background:rgba(239,68,68,.10)"><div class="card-body"><strong>Critical</strong><div style="color:var(--muted)">${critCt}</div></div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Sales (Month-to-Date)</strong>
          <button class="btn ghost" data-go="cogs"><i class="ri-line-chart-line"></i> Details</button>
        </div>
        <div style="margin-top:6px"><span style="color:var(--muted)">This month:</span> <strong>${USD(totalThis)}</strong></div>
        <div><span style="color:var(--muted)">Prev month:</span> ${USD(totalPrev)} <span style="color:${col(mom)}">${fmt(mom)} MoM</span></div>
        <div><span style="color:var(--muted)">Same month last year:</span> ${USD(totalLY)} <span style="color:${col(yoy)}">${fmt(yoy)} YoY</span></div>
      </div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Posts</h3>
          <button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns:1fr">
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
                <p style="margin-top:8px">${p.body||''}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    ${postModal()}`;
}
function wireDashboard(){
  $('#addPost')?.addEventListener('click',()=>{ openModal('m-post'); $('#post-id').value=''; $('#post-title').value=''; $('#post-body').value=''; });
  const sec=document.querySelector('[data-section="posts"]'); if(!sec) return;
  sec.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.dataset.edit||b.dataset.del; if(!id) return;
    if(b.dataset.edit){
      const p=state.posts[id]; if(!p) return;
      openModal('m-post'); $('#post-id').value=p.id; $('#post-title').value=p.title; $('#post-body').value=p.body||'';
    }else{
      await removeItem('posts', id); notify('Deleted');
    }
  });
  $('#save-post')?.addEventListener('click', async()=>{
    const id=$('#post-id').value||('post_'+Date.now());
    const obj={ id, title:$('#post-title').value.trim(), body:$('#post-body').value.trim(), createdAt:Date.now() };
    if(!obj.title) return notify('Title required','warn');
    await addOrUpdate('posts', obj); closeModal('m-post'); notify('Saved');
  });
}

/* Inventory */
function viewInventory(){
  const items=listToArray(state.inventory);
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
              const isCrit= it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
              const trClass = isCrit ? 'tr-crit' : (isLow ? 'tr-warn' : '');
              return `<tr id="${it.id}" class="${trClass}">
                <td>${it.name}</td><td>${it.code}</td><td>${it.type||'-'}</td><td>${USD(it.price)}</td>
                <td><button class="btn ghost" data-dec="${it.id}">–</button><span style="padding:0 10px">${it.stock}</span><button class="btn ghost" data-inc="${it.id}">+</button></td>
                <td><button class="btn ghost" data-dec-th="${it.id}">–</button><span style="padding:0 10px">${it.threshold}</span><button class="btn ghost" data-inc-th="${it.id}">+</button></td>
                <td><button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div></div>
    ${invModal()}`;
}
function wireInventory(){
  $('#export-inventory')?.addEventListener('click',()=> downloadCSV('inventory.csv', listToArray(state.inventory), ['id','name','code','type','price','stock','threshold']));
  $('#addInv')?.addEventListener('click',()=>{ openModal('m-inv'); $('#inv-id').value=''; $('#inv-name').value=''; $('#inv-code').value='Other-001'; $('#inv-type').value='Other'; $('#inv-price').value=''; $('#inv-stock').value=''; $('#inv-threshold').value='';});
  $('#save-inv')?.addEventListener('click', async()=>{
    const id=$('#inv-id').value||('inv_'+Date.now());
    const obj={ id, name:$('#inv-name').value.trim(), code:$('#inv-code').value.trim(), type:$('#inv-type').value.trim(),
      price:parseFloat($('#inv-price').value||'0'), stock:parseInt($('#inv-stock').value||'0'), threshold:parseInt($('#inv-threshold').value||'0') };
    if(!obj.name) return notify('Name required','warn');
    await addOrUpdate('inventory', obj); closeModal('m-inv'); notify('Saved');
  });
  const sec=document.querySelector('[data-section="inventory"]'); if(!sec) return;
  sec.addEventListener('click', async e=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const id=btn.dataset.edit||btn.dataset.del||btn.dataset.inc||btn.dataset.dec||btn.getAttribute('data-inc-th')||btn.getAttribute('data-dec-th'); if(!id) return;
    const it=state.inventory[id];
    if(btn.dataset.edit){
      openModal('m-inv'); $('#inv-id').value=it.id; $('#inv-name').value=it.name; $('#inv-code').value=it.code; $('#inv-type').value=it.type||'Other'; $('#inv-price').value=it.price; $('#inv-stock').value=it.stock; $('#inv-threshold').value=it.threshold;
    }else if(btn.dataset.del){
      await removeItem('inventory', id); notify('Deleted');
    }else{
      const curr={...it};
      if(btn.dataset.inc) curr.stock++;
      if(btn.dataset.dec) curr.stock=Math.max(0,curr.stock-1);
      if(btn.hasAttribute('data-inc-th')) curr.threshold++;
      if(btn.hasAttribute('data-dec-th')) curr.threshold=Math.max(0,curr.threshold-1);
      await addOrUpdate('inventory', curr);
    }
  });
}

/* Products */
function viewProducts(){
  const items=listToArray(state.products);
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
                <td>${it.name}</td><td>${it.barcode||''}</td><td>${USD(it.price)}</td><td>${it.type||'-'}</td>
                <td><button class="btn ghost" data-edit="${it.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${it.id}"><i class="ri-delete-bin-6-line"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div></div>
    ${prodModal()}`;
}
function wireProducts(){
  $('#export-products')?.addEventListener('click',()=> downloadCSV('products.csv', listToArray(state.products), ['id','name','barcode','price','type','ingredients','instructions']));
  $('#addProd')?.addEventListener('click',()=>{ openModal('m-prod'); $('#prod-id').value=''; $('#prod-name').value=''; $('#prod-barcode').value=''; $('#prod-price').value=''; $('#prod-type').value=''; $('#prod-ingredients').value=''; $('#prod-instructions').value='';});
  $('#save-prod')?.addEventListener('click', async()=>{
    const id=$('#prod-id').value||('p_'+Date.now());
    const obj={ id, name:$('#prod-name').value.trim(), barcode:$('#prod-barcode').value.trim(), price:+($('#prod-price').value||0), type:$('#prod-type').value.trim(), ingredients:$('#prod-ingredients').value.trim(), instructions:$('#prod-instructions').value.trim() };
    if(!obj.name) return notify('Name required','warn');
    await addOrUpdate('products', obj); closeModal('m-prod'); notify('Saved');
  });
  const sec=document.querySelector('[data-section="products"]'); if(!sec) return;
  sec.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.dataset.edit||b.dataset.del; if(!id) return;
    if(b.dataset.edit){
      const it=state.products[id]; if(!it) return;
      openModal('m-prod'); $('#prod-id').value=it.id; $('#prod-name').value=it.name; $('#prod-barcode').value=it.barcode||''; $('#prod-price').value=it.price; $('#prod-type').value=it.type||''; $('#prod-ingredients').value=it.ingredients||''; $('#prod-instructions').value=it.instructions||'';
    }else{
      await removeItem('products', id); notify('Deleted');
    }
  });
}

/* COGS (month/year picker + exports) */
function viewCOGS(){
  const rows=listToArray(state.cogs);
  const today=new Date(); const y=today.getFullYear(), m=today.getMonth()+1;
  const selY = window.__cogsYear || y;
  const selM = window.__cogsMonth || m;
  const filtered = rows.filter(r=>{ const p=parseYMD(r.date); if(!p) return false; return p.y===selY && p.m===selM; }).sort((a,b)=> (a.date>b.date?1:-1));
  const sums = rows.reduce((a,r)=>({gi:a.gi+(+r.grossIncome||0),pc:a.pc+(+r.produceCost||0),ic:a.ic+(+r.itemCost||0),fr:a.fr+(+r.freight||0),dl:a.dl+(+r.delivery||0),ot:a.ot+(+r.other||0)}),{gi:0,pc:0,ic:0,fr:0,dl:0,ot:0});
  const gp=r=>(+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.delivery||0)+(+r.other||0));
  const gpTotal=gp({grossIncome:sums.gi,produceCost:sums.pc,itemCost:sums.ic,freight:sums.fr,delivery:sums.dl,other:sums.ot});
  const years=[...new Set(rows.map(r=>parseYMD(r.date)?.y).filter(Boolean))].sort((a,b)=>b-a); if(!years.includes(y)) years.unshift(y);
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">COGS</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="cogs-year" class="input" style="width:auto">${years.map(yy=>`<option ${yy===selY?'selected':''}>${yy}</option>`).join('')}</select>
          <select id="cogs-month" class="input" style="width:auto">${[1,2,3,4,5,6,7,8,9,10,11,12].map(mm=>`<option value="${mm}" ${mm===selM?'selected':''}>${String(mm).padStart(2,'0')}</option>`).join('')}</select>
          <button class="btn secondary" id="cogs-filter"><i class="ri-filter-2-line"></i> Filter</button>
          <button class="btn ok" id="export-cogs-month"><i class="ri-download-2-line"></i> Export Month</button>
          <button class="btn ok" id="export-cogs-year"><i class="ri-download-2-line"></i> Export Year</button>
          <button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>
        </div>
      </div>
      <div class="table-wrap" data-section="cogs">
        <table class="table">
          <thead><tr><th>Date</th><th>Gross Income</th><th>Produce Cost</th><th>Item Cost</th><th>Freight</th><th>Delivery</th><th>Other</th><th>Gross Profit</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map(r=>`
              <tr id="${r.id}">
                <td>${r.date}</td><td>${USD(r.grossIncome)}</td><td>${USD(r.produceCost)}</td><td>${USD(r.itemCost)}</td>
                <td>${USD(r.freight)}</td><td>${USD(r.delivery)}</td><td>${USD(r.other)}</td><td>${USD(gp(r))}</td>
                <td><button class="btn ghost" data-edit="${r.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${r.id}"><i class="ri-delete-bin-6-line"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card" style="margin-top:12px"><div class="card-body">
        <strong>Totals (All time):</strong>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;color:var(--muted)">
          <div>Gross: <strong>${USD(sums.gi)}</strong></div>
          <div>Produce: <strong>${USD(sums.pc)}</strong></div>
          <div>Items: <strong>${USD(sums.ic)}</strong></div>
          <div>Freight: <strong>${USD(sums.fr)}</strong></div>
          <div>Delivery: <strong>${USD(sums.dl)}</strong></div>
          <div>Other: <strong>${USD(sums.ot)}</strong></div>
          <div>Profit: <strong>${USD(gpTotal)}</strong></div>
        </div>
      </div></div>
    </div></div>
    ${cogsModal()}`;
}
function wireCOGS(){
  $('#cogs-filter')?.addEventListener('click',()=>{ window.__cogsYear=+$('#cogs-year').value; window.__cogsMonth=+$('#cogs-month').value; renderMain(); });
  $('#addCOGS')?.addEventListener('click',()=>{ openModal('m-cogs'); $('#cogs-id').value=''; $('#cogs-date').value=new Date().toISOString().slice(0,10); ['grossIncome','produceCost','itemCost','freight','delivery','other'].forEach(k=>$('#cogs-'+k).value=''); });
  $('#save-cogs')?.addEventListener('click', async()=>{
    const id=$('#cogs-id').value||('c_'+Date.now());
    const row={ id, date:$('#cogs-date').value||new Date().toISOString().slice(0,10),
      grossIncome:+($('#cogs-grossIncome').value||0), produceCost:+($('#cogs-produceCost').value||0), itemCost:+($('#cogs-itemCost').value||0),
      freight:+($('#cogs-freight').value||0), delivery:+($('#cogs-delivery').value||0), other:+($('#cogs-other').value||0) };
    await addOrUpdate('cogs', row); closeModal('m-cogs'); notify('Saved');
  });
  const sec=document.querySelector('[data-section="cogs"]'); if(!sec) return;
  sec.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.dataset.edit||b.dataset.del; if(!id) return;
    if(b.dataset.edit){
      const r=state.cogs[id]; if(!r) return;
      openModal('m-cogs'); $('#cogs-id').value=r.id; $('#cogs-date').value=r.date; $('#cogs-grossIncome').value=r.grossIncome; $('#cogs-produceCost').value=r.produceCost; $('#cogs-itemCost').value=r.itemCost; $('#cogs-freight').value=r.freight; $('#cogs-delivery').value=r.delivery; $('#cogs-other').value=r.other;
    }else{
      await removeItem('cogs', id); notify('Deleted');
    }
  });
  $('#export-cogs-month')?.addEventListener('click',()=>{
    const y=+$('#cogs-year').value, m=+$('#cogs-month').value, rows=listToArray(state.cogs).filter(r=>{ const p=parseYMD(r.date); return p && p.y===y && p.m===m; });
    downloadCSV(`cogs_${y}_${String(m).padStart(2,'0')}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','freight','delivery','other']);
  });
  $('#export-cogs-year')?.addEventListener('click',()=>{
    const y=+$('#cogs-year').value, rows=listToArray(state.cogs).filter(r=>parseYMD(r.date)?.y===y);
    downloadCSV(`cogs_${y}.csv`, rows, ['id','date','grossIncome','produceCost','itemCost','freight','delivery','other']);
  });
}

/* Tasks (DnD works on empty lanes) */
function viewTasks(){
  const items=listToArray(state.tasks);
  const lane=(key,label,color)=>`
    <div class="card lane-row" data-lane="${key}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:${color}">${label}</h3>
          ${key==='todo'? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
        </div>
        <div class="grid lane-grid" id="lane-${key}"></div>
      </div>
    </div>`;
  const html=`
    <div data-section="tasks">
      ${lane('todo','To do','#f59e0b')}
      ${lane('inprogress','In progress','#3b82f6')}
      ${lane('done','Done','#10b981')}
    </div>`;
  setTimeout(()=>{
    ['todo','inprogress','done'].forEach(k=>{
      const host=$(`#lane-${k}`); if(!host) return;
      items.filter(t=>t.status===k).forEach(t=>{
        host.insertAdjacentHTML('beforeend', `
          <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
            <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
              <div>${t.title}</div>
              <div>
                <button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>
                <button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>
              </div>
            </div>
          </div>`);
      });
    });
    setupDnD(); // after DOM
  },0);
  return html + taskModal();
}
function wireTasks(){
  const root=document.querySelector('[data-section="tasks"]'); if(!root) return;
  $('#addTask')?.addEventListener('click',()=>{ openModal('m-task'); $('#task-id').value=''; $('#task-title').value=''; $('#task-status').value='todo'; });
  $('#save-task')?.addEventListener('click', async()=>{
    const id=$('#task-id').value||('t_'+Date.now());
    const obj={ id, title:($('#task-title')?.value||'').trim(), status:$('#task-status')?.value||'todo' };
    if(!obj.title) return notify('Title required','warn');
    await addOrUpdate('tasks', obj); closeModal('m-task'); notify('Saved');
  });
  root.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.dataset.edit||b.dataset.del; if(!id) return;
    if(b.dataset.edit){
      const t=state.tasks[id]; if(!t) return;
      openModal('m-task'); $('#task-id').value=t.id; $('#task-title').value=t.title; $('#task-status').value=t.status;
    }else{
      await removeItem('tasks', id); notify('Deleted');
    }
  });
}
function setupDnD(){
  $$('.task-card').forEach(card=>{
    card.addEventListener('dragstart',e=>{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.dataset.task); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=> card.classList.remove('dragging'));
  });
  $$('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row.dataset.lane;
    const show=e=>{ e.preventDefault(); row.classList.add('drop'); e.dataTransfer.dropEffect='move'; };
    const hide=()=> row.classList.remove('drop');
    ['dragenter','dragover'].forEach(ev=>grid.addEventListener(ev,show));
    grid.addEventListener('dragleave', hide);
    grid.addEventListener('drop', async e=>{
      e.preventDefault(); hide();
      const id=e.dataTransfer.getData('text/plain'); if(!id) return;
      const t=state.tasks[id]; if(!t) return;
      await addOrUpdate('tasks', {...t, status:lane});
    });
  });
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints>0;
  if(isTouch){
    $$('.task-card').forEach(card=>{
      card.addEventListener('click', async e=>{
        if(e.target.closest('button')) return;
        const id=card.dataset.task; const t=state.tasks[id]; if(!t) return;
        const next= t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
        await addOrUpdate('tasks', {...t, status:next});
      });
    });
  }
}

/* Settings + Users (no avatars) */
function viewSettings(){
  const users=listToArray(state.users);
  const theme=state.settings.theme||{mode:'sky',size:'medium'};
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
          <div><label style="font-size:12px;color:var(--muted)">Mode</label>
            <select id="theme-mode" class="input">${THEMES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.label}</option>`).join('')}</select>
          </div>
          <div><label style="font-size:12px;color:var(--muted)">Font Size</label>
            <select id="theme-size" class="input">${FONT_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}</select>
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
                <td><button class="btn ghost" data-edit="${u.email}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${u.email}"><i class="ri-delete-bin-6-line"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>
    ${userModal()}`;
}
function wireSettings(){
  $('#theme-mode')?.addEventListener('change',()=> saveTheme($('#theme-mode').value, $('#theme-size').value));
  $('#theme-size')?.addEventListener('change',()=> saveTheme($('#theme-mode').value, $('#theme-size').value));

  $('#addUser')?.addEventListener('click',()=>{ openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; $('#user-role').innerHTML=['user','associate','manager','admin'].map(r=>`<option value="${r}">${r}</option>`).join(''); $('#user-role').value='user'; });
  $('#save-user')?.addEventListener('click', async()=>{
    const email=($('#user-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Email required','warn');
    const obj={ id:email, name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:($('#user-role').value||'user') };
    await addOrUpdate('users', obj); closeModal('m-user'); notify('Saved');
  });
  const table=document.querySelector('[data-section="users"]');
  table?.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    const email=b.dataset.edit||b.dataset.del; if(!email) return;
    if(b.dataset.edit){
      const u=state.users[email]; if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; $('#user-role').innerHTML=['user','associate','manager','admin'].map(r=>`<option value="${r}">${r}</option>`).join(''); $('#user-role').value=u.role||'user';
    }else{
      await removeItem('users', email); notify('Deleted');
    }
  });
}

/* Static pages (enriched) */
const pageContent={
  about:`<h3>About</h3><p>Inventory is a lightweight, mobile-first app for stock, products, COGS and tasks. It saves directly to your Firebase Realtime Database so your data is always in sync.</p><ul><li>Cloud-first, no images/videos.</li><li>Soft themes (Sunrise, Sky, Mint, Slate, Midnight).</li><li>Exports for COGS by month/year.</li></ul>`,
  policy:`<h3>Privacy & Data Policy</h3><p>Your data lives in your Firebase project. This app reads/writes under <code>/tenants/{uid}</code> only. You manage access via Firebase Auth + RTDB Security Rules.</p><p><strong>Suggested rules:</strong> allow the signed-in user to read/write only their own tenant path.</p>`,
  license:`<h3>License</h3><p>MIT License. You can use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies.</p>`,
  setup:`<h3>Setup Guide</h3><ol><li>Create a Firebase project and enable Email/Password auth.</li><li>Enable Realtime Database (in Native/Realtime mode) and set rules to protect <code>/tenants/{uid}</code>.</li><li>Paste your Firebase config into <code>index.html</code>.</li><li>Deploy to Firebase Hosting (optional).</li></ol>`,
  guide:`<h3>User Guide</h3><ul><li>Use the left search to find posts, inventory, products, users and COGS.</li><li>Drag & drop tasks between lanes — drops on empty lanes are supported.</li><li>Change theme in Settings (Sunrise/Sky/Mint/Slate/Midnight).</li><li>Export COGS by month or by year from the COGS page.</li></ul>`,
  contact:`<h3>Contact</h3><p>Questions or feedback? Click the button below to email us.</p>
  <a class="btn secondary" id="emailUs"><i class="ri-mail-send-line"></i> Email us</a>
  <p style="color:var(--muted);font-size:12px;margin-top:8px">This opens your email app to <strong>minmaung0307@gmail.com</strong> with helpful context.</p>`
};
function viewPage(key){ return `<div class="card"><div class="card-body">${pageContent[key]||'<p>Page</p>'}</div></div>`; }
function wireContact(){ const btn=$('#emailUs'); if(!btn) return; btn.onclick=()=>{ const uid=session?.uid||''; const sub=encodeURIComponent('Inventory App — Feedback'); const body=encodeURIComponent(`Hi,\n\nMy UID: ${uid}\nContext: ${location.origin}\n\nMessage:\n`); location.href=`mailto:minmaung0307@gmail.com?subject=${sub}&body=${body}`; }; }

/* Search page */
function viewSearch(){
  const q=(window.__lastQuery||'').trim();
  const out=q? searchAll(buildSearchIndex(),q) : [];
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Search</h3><div style="color:var(--muted)">Query: <strong>${q||'(empty)'}</strong></div>
      </div>
      ${out.length? `<div class="grid">${out.map(r=>`
        <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:700">${r.label}</div><div style="color:var(--muted);font-size:12px">${r.section||''}</div></div>
          <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
        </div></div>`).join('')}</div>` : `<p style="color:var(--muted)">No results.</p>`}
    </div></div>`;
}

/* ---------- Wiring per-view ---------- */
function wireRoute(r){
  document.querySelectorAll('[data-go]').forEach(el=> el.onclick=()=>{ route=el.dataset.go; renderApp(); if(el.dataset.id) setTimeout(()=>scrollIntoViewById(el.dataset.id),80); });
  switch(r){
    case 'home': wireHome(); break;
    case 'dashboard': wireDashboard(); break;
    case 'inventory': wireInventory(); break;
    case 'products': wireProducts(); break;
    case 'cogs': wireCOGS(); break;
    case 'tasks': wireTasks(); break;
    case 'settings': wireSettings(); break;
    case 'contact': wireContact(); break;
  }
}

/* ---------- Modals ---------- */
function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-'+(id.split('-')[1]||'')).classList.add('active'); }
function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-'+(id.split('-')[1]||'')).classList.remove('active'); }

function postModal(){ return `
  <div class="modal-backdrop" id="mb-post"></div>
  <div class="modal" id="m-post"><div class="dialog">
    <div class="head"><strong>Post</strong><button class="btn ghost" data-close="m-post" onclick="closeModal('m-post')">Close</button></div>
    <div class="body grid">
      <input id="post-id" type="hidden"/>
      <input id="post-title" class="input" placeholder="Title"/>
      <textarea id="post-body" class="input" placeholder="Body"></textarea>
    </div>
    <div class="foot"><button class="btn" id="save-post">Save</button></div>
  </div></div>`; }
function invModal(){ return `
  <div class="modal-backdrop" id="mb-inv"></div>
  <div class="modal" id="m-inv"><div class="dialog">
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
  </div></div>`; }
function prodModal(){ return `
  <div class="modal-backdrop" id="mb-prod"></div>
  <div class="modal" id="m-prod"><div class="dialog">
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
  </div></div>`; }
function cogsModal(){ return `
  <div class="modal-backdrop" id="mb-cogs"></div>
  <div class="modal" id="m-cogs"><div class="dialog">
    <div class="head"><strong>COGS Row</strong><button class="btn ghost" onclick="closeModal('m-cogs')">Close</button></div>
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
  </div></div>`; }
function taskModal(){ return `
  <div class="modal-backdrop" id="mb-task"></div>
  <div class="modal" id="m-task"><div class="dialog">
    <div class="head"><strong>Task</strong><button class="btn ghost" onclick="closeModal('m-task')">Close</button></div>
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
    <div class="head"><strong>User</strong><button class="btn ghost" onclick="closeModal('m-user')">Close</button></div>
    <div class="body grid">
      <input id="user-name" class="input" placeholder="Name"/>
      <input id="user-email" class="input" type="email" placeholder="Email"/>
      <input id="user-username" class="input" placeholder="Username"/>
      <select id="user-role"></select>
    </div>
    <div class="foot"><button class="btn" id="save-user">Save</button></div>
  </div></div>`; }

/* ---------- CSV helper ---------- */
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

/* ---------- Online hints + Boot ---------- */
window.addEventListener('online', ()=> notify('Back online','ok'));
window.addEventListener('offline',()=> notify('You are offline','warn'));
(function boot(){ renderLogin(); })();