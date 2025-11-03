/* Inventory SPA — Firestore + EmailJS (v1.0.3)
   -----------------------------------------------------
   • Surgical fixes only; no redesign.
   • Roles via userRegistry (user/associate/manager/admin)
   • Mobile drawer + backdrop + burger + iPhone-safe
   • Search: highlight selected row (bg highlight)
   • “Powered by MM, <year>” auto-updates
   • Crisp calculator SVG replaces emoji logo
   ----------------------------------------------------- */

(() => {
  'use strict';

  /* ---------- EmailJS config (optional) ---------- */
  const EMAILJS_PUBLIC_KEY  = 'WT0GOYrL9HnDKvLUf';
  const EMAILJS_SERVICE_ID  = 'service_z9tkmvr';
  const EMAILJS_TEMPLATE_ID = 'template_q5q471f';

  /* ---------- Firebase ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) {
    console.error('Firebase SDK or config missing.');
  }
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  /* ---------- Constants ---------- */
  const ADMIN_EMAILS = ['admin@inventory.com', 'minmaung0307@gmail.com'];
  const VALID_ROLES  = ['user','associate','manager','admin'];

  /* ---------- App State ---------- */
  const state = {
    user: null,
    role: 'user',
    route: 'dashboard',
    searchQ: '',
    searchHitId: null,       // the row to highlight after a search
    inventory: [],
    products: [],
    cogs: [],
    tasks: [],
    posts: [],
    links: [],
    users: [],
    theme: { palette:'sunrise', font:'medium' },
    unsub: []
  };

  /* ---------- Utilities ---------- */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtUSD = v => `$${Number(v||0).toFixed(2)}`;
  const yearNow = () => new Date().getFullYear();

  // Minimal calculator logo (SVG uses currentColor, sits on gradient .logo)
  function appLogoSVG(){
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true" role="img">
      <rect x="3" y="2.5" width="18" height="19" rx="4.5" ry="4.5"
            fill="none" stroke="currentColor" stroke-width="1.8"/>
      <rect x="7" y="5.5" width="10" height="4" rx="1.2"
            fill="none" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="8.5" cy="12.5" r="1.25" fill="currentColor"/>
      <circle cx="12"  cy="12.5" r="1.25" fill="currentColor"/>
      <circle cx="15.5" cy="12.5" r="1.25" fill="currentColor"/>
      <circle cx="8.5" cy="16.5" r="1.25" fill="currentColor"/>
      <circle cx="12"  cy="16.5" r="1.25" fill="currentColor"/>
      <rect x="14.5" y="15" width="3.2" height="3.6" rx="0.8" fill="currentColor"/>
    </svg>`;
  }

  function notify(msg, type='ok') {
    let n = $('#notification');
    if (!n) {
      n = document.createElement('div');
      n.id = 'notification';
      n.className = 'notification';
      document.body.appendChild(n);
    }
    n.textContent = msg;
    n.className = `notification show ${type}`;
    setTimeout(()=> n.className='notification', 2300);
  }

  const canAdd    = () => ['associate','manager','admin'].includes(state.role);
  const canEdit   = () => ['manager','admin'].includes(state.role);
  const canDelete = () => state.role === 'admin';

  const uid  = () => auth.currentUser?.uid || null;
  const tcol = (name) => db.collection('tenants').doc(uid()).collection(name);
  const tdoc = (name) => db.collection('tenants').doc(uid()).collection('kv').doc(name);
  const regDoc = (emailLower) => db.collection('userRegistry').doc(emailLower);

  const setTheme = (palette, font) => {
    if (palette) state.theme.palette = palette;
    if (font)    state.theme.font    = font;
    document.documentElement.setAttribute('data-theme', state.theme.palette);
    document.documentElement.setAttribute('data-font',  state.theme.font);
  };

  /* ---------- Idle auto logout (20 min) ---------- */
  const idle = {
    timer:null,
    MAX: 20*60*1000,
    arm(){
      this.disarm();
      this.timer = setTimeout(()=> auth.signOut().catch(()=>{}), this.MAX);
    },
    disarm(){ if (this.timer){ clearTimeout(this.timer); this.timer=null; } },
    hook(){
      ['click','keydown','mousemove','scroll','touchstart','pointerdown'].forEach(evt=>{
        document.addEventListener(evt, ()=> this.arm(), {passive:true});
      });
      this.arm();
    }
  };

  /* ---------- Modals ---------- */
  function openModal(id){
    $('#'+id)?.classList.add('active');
    $('#mb-'+(id.split('-')[1]||''))?.classList.add('active');
  }
  function closeModal(id){
    $('#'+id)?.classList.remove('active');
    $('#mb-'+(id.split('-')[1]||''))?.classList.remove('active');
  }

  /* ---------- Router ---------- */
  const routes = ['dashboard','inventory','products','cogs','tasks','settings','links','search'];
  function go(route){
    state.route = routes.includes(route) ? route : 'dashboard';
    closeSidebar();
    render();
  }

  /* ---------- Firestore sync ---------- */
  function clearSnapshots(){
    state.unsub.forEach(u=>{ try{ u(); }catch{} });
    state.unsub = [];
  }
  function syncTenant(){
    if (!uid()) return;
    clearSnapshots();

    // KV: theme
    state.unsub.push(tdoc('_theme').onSnapshot(snap=>{
      const data = snap.data() || {};
      setTheme(data.palette || state.theme.palette, data.font || state.theme.font);
    }));

    const attach = (name, targetKey, order='desc') => {
      state.unsub.push(
        tcol(name).orderBy('createdAt', order).onSnapshot(s=>{
          state[targetKey] = s.docs.map(d=> ({ id:d.id, ...d.data() }));
          if (['dashboard',name].includes(state.route)) render();
        })
      );
    };
    attach('inventory','inventory');
    attach('products','products');
    attach('cogs','cogs');
    attach('tasks','tasks');
    attach('posts','posts');
    attach('users','users');
    attach('links','links');
  }

  async function saveKVTheme(){
    try {
      await tdoc('_theme').set({
        palette: state.theme.palette,
        font: state.theme.font,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
      notify('Theme saved');
    } catch {
      notify('Could not save theme (still applied locally).','warn');
    }
  }

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix = [];
    state.inventory.forEach(i=> ix.push({label:i.name, section:'Inventory', route:'inventory', id:i.id, text:`${i.name} ${i.code} ${i.type}`}));
    state.products.forEach(p=> ix.push({label:p.name, section:'Products', route:'products', id:p.id, text:`${p.name} ${p.barcode} ${p.type}`}));
    state.cogs.forEach(r=> ix.push({label:r.date, section:'COGS', route:'cogs', id:r.id, text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.other}`}));
    state.tasks.forEach(t=> ix.push({label:t.title, section:'Tasks', route:'tasks', id:t.id, text:`${t.title} ${t.status}`}));
    state.posts.forEach(p=> ix.push({label:p.title, section:'Posts', route:'dashboard', id:p.id, text:`${p.title} ${p.body}`}));
    state.links.forEach(l=> ix.push({label:l.title, section:'Links', route:'links', id:l.id, text:`${l.title} ${l.url||''}`}));
    state.users.forEach(u=> ix.push({label:u.name, section:'Users', route:'settings', id:u.id, text:`${u.name} ${u.email} ${u.role}`}));
    return ix;
  }
  function doSearch(q){
    const index = buildIndex();
    const tokens = (q||'').toLowerCase().split(/\s+/).filter(Boolean);
    return index
      .map(item=>{
        const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
        const ok = tokens.every(tok => l.includes(tok)||t.includes(tok));
        return ok ? {item,score: tokens.length + (l.includes(tokens[0]||'')?1:0)} : null;
      })
      .filter(Boolean)
      .sort((a,b)=>b.score-a.score)
      .map(x=>x.item)
      .slice(0,20);
  }

  /* ---------- Layout ---------- */
  function layout(content){
    return `
      <div class="app">
        <aside class="sidebar" id="sidebar">
          <div class="brand" id="brand">
            <div class="logo">${appLogoSVG()}</div>
            <div class="title">Inventory</div>
          </div>

          <!-- Mobile-first sidebar search -->
          <div class="search-wrap" style="padding:0 12px 8px; display:none">
            <input id="sideSearch" class="input" placeholder="Search…" autocomplete="off" />
            <div id="sideSearchResults" class="search-results"></div>
          </div>

          <div class="nav" id="side-nav">
            ${[
              ['dashboard','Dashboard','ri-dashboard-line'],
              ['inventory','Inventory','ri-archive-2-line'],
              ['products','Products','ri-store-2-line'],
              ['cogs','COGS','ri-money-dollar-circle-line'],
              ['tasks','Tasks','ri-list-check-2'],
              ['links','Link Pages','ri-links-line'],
              ['settings','Settings','ri-settings-3-line']
            ].map(([r,label,icon])=>`
              <div class="item ${state.route===r?'active':''}" data-route="${r}" role="button" tabindex="0">
                <i class="${icon}"></i><span>${label}</span>
              </div>`).join('')}
          </div>

          <div class="footer" style="flex-direction:column;gap:8px;padding-bottom:16px">
            <div style="display:flex;gap:10px">
              <a href="https://youtube.com"  target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
              <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook"><i class="ri-facebook-fill"></i></a>
              <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
              <a href="https://tiktok.com"   target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
              <a href="https://twitter.com"  target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
            </div>
            <div class="muted" style="font-size:12px" id="copyright">Powered by MM, ${yearNow()}</div>
          </div>
        </aside>

        <div>
          <div class="topbar">
            <div style="display:flex;align-items:center;gap:10px">
              <button class="btn ghost" id="burger" aria-label="Open Menu" title="Menu"><i class="ri-menu-line"></i></button>
              <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
            </div>

            <div class="search-inline">
              <input id="globalSearch" class="input" placeholder="Search everything…" autocomplete="off" />
              <div id="searchResults" class="search-results"></div>
            </div>

            <div style="display:flex;gap:8px">
              <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
            </div>
          </div>

          <div class="backdrop" id="backdrop"></div>
          <div class="main" id="main">${content}</div>
        </div>
      </div>

      <!-- Reusable modal -->
      <div class="modal" id="m-modal"><div class="dialog">
        <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
        <div class="body" id="mm-body"></div>
        <div class="foot" id="mm-foot"></div>
      </div></div><div class="modal-backdrop" id="mb-modal"></div>
    `;
  }

  /* ---------- Views ---------- */
  function viewLogin(){
    return `
      <div class="login-page">
        <div class="card login-card">
          <div class="card-body">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
              <div class="logo">${appLogoSVG()}</div>
              <div>
                <div style="font-size:20px;font-weight:800">Inventory</div>
                <div style="color:var(--muted)">Sign in to continue</div>
              </div>
            </div>
            <div class="login-grid">
              <label>Email</label>
              <input id="li-email" class="input" type="email" placeholder="you@example.com" autocomplete="username" />
              <label>Password</label>
              <input id="li-pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password" />
              <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
              <div style="display:flex;justify-content:space-between;gap:8px">
                <button id="link-forgot" class="btn ghost" style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</button>
                <button id="link-register" class="btn secondary" style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
              </div>
              <div class="muted" style="font-size:12px;margin-top:6px">Tip: Admin — admin@inventory.com</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function dashCard(label, value, route){
    return `<div class="card clickable" data-go="${route}">
      <div class="card-body">
        <div>${label}</div>
        <h2>${value}</h2>
      </div>
    </div>`;
  }

  function viewDashboard(){
    const lowCt  = state.inventory.filter(i => i.stock <= i.threshold && i.stock > Math.max(1, Math.floor(i.threshold*0.6))).length;
    const critCt = state.inventory.filter(i => i.stock <= Math.max(1, Math.floor(i.threshold*0.6))).length;
    const totals = state.cogs.reduce((a,r)=>({
      grossIncome:a.grossIncome + (+r.grossIncome||0),
      produceCost:a.produceCost + (+r.produceCost||0),
      itemCost:a.itemCost + (+r.itemCost||0),
      freight:a.freight + (+r.freight||0),
      other:a.other + (+r.other||0)
    }), {grossIncome:0,produceCost:0,itemCost:0,freight:0,other:0});
    const gProfit = totals.grossIncome - (totals.produceCost + totals.itemCost + totals.freight + totals.other);

    return `
      <div class="grid cols-4">
        ${dashCard('Inventory', state.inventory.length, 'inventory')}
        ${dashCard('Products', state.products.length, 'products')}
        ${dashCard('Tasks', state.tasks.length, 'tasks')}
        ${dashCard('Users', state.users.length, 'settings')}
      </div>

      <div class="grid cols-3">
        <div class="card clickable" data-go="inventory"><div class="card-body"><strong>Low stock</strong><div class="badge warn" style="margin-top:8px">${lowCt}</div></div></div>
        <div class="card clickable" data-go="inventory"><div class="card-body"><strong>Critical</strong><div class="badge danger" style="margin-top:8px">${critCt}</div></div></div>
        <div class="card clickable" data-go="cogs"><div class="card-body"><strong>G-Profit (YTD)</strong><div style="color:var(--muted)">${fmtUSD(gProfit)}</div></div></div>
      </div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Posts</h3>
          ${canAdd()? `<button class="btn" id="addPost"><i class="ri-add-line"></i> Add Post</button>`:''}
        </div>
        <div class="grid" data-section="posts" style="grid-template-columns: 1fr;">
          ${(state.posts||[]).map(p=>`
            <div class="card" id="${p.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div><strong>${p.title}</strong><div style="color:var(--muted);font-size:12px">${new Date(p.createdAt?.toDate?.()||p.createdAt||Date.now()).toLocaleString()}</div></div>
                <div class="actions">
                  ${canEdit()? `<button class="btn ghost" data-edit="${p.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                  ${canDelete()? `<button class="btn danger" data-del="${p.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                </div>
              </div>
              <div class="card-body"><p>${p.body||''}</p></div>
            </div>`).join('')}
        </div>
      </div>
    `;
  }

  function viewInventory(){
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
            <thead><tr>
              <th>Name</th><th>Code</th><th>Type</th><th class="num">Price</th>
              <th class="num">Stock</th><th class="num">Threshold</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${state.inventory.map(it=>{
                const critical = it.stock <= Math.max(1, Math.floor(it.threshold*0.6));
                const low = !critical && it.stock <= it.threshold;
                const rowClass = [
                  critical ? 'critical' : (low? 'low' : ''),
                  (state.searchHitId === it.id ? 'search-hit' : '')
                ].join(' ').trim();
                return `
                  <tr id="${it.id}" class="${rowClass}">
                    <td>${it.name}</td>
                    <td>${it.code}</td>
                    <td>${it.type||'-'}</td>
                    <td class="num">${fmtUSD(it.price)}</td>
                    <td class="num">
                      <div class="qty">
                        ${canEdit()? `<button class="btn ghost" data-dec="${it.id}" title="Decrease"><i class="ri-subtract-line"></i></button>`:''}
                        <span class="qty-num">${it.stock}</span>
                        ${canEdit()? `<button class="btn ghost" data-inc="${it.id}" title="Increase"><i class="ri-add-line"></i></button>`:''}
                      </div>
                    </td>
                    <td class="num">${it.threshold}</td>
                    <td class="actions">
                      ${canEdit()? `<button class="btn ghost" data-edit="${it.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                      ${canDelete()? `<button class="btn danger" data-del="${it.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div style="color:var(--muted);margin-top:8px">
            Tip: Use <strong>+</strong>/<strong>−</strong> to adjust stock (manager/admin).
          </div>
        </div>
      </div></div>
    `;
  }

  function viewProducts(){
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
              ${state.products.map(it=>`
                <tr id="${it.id}" class="${state.searchHitId===it.id?'search-hit':''}">
                  <td><button class="btn ghost" data-card="${it.id}" title="Open" style="padding:6px 10px">${it.name}</button></td>
                  <td>${it.barcode||''}</td>
                  <td class="num">${fmtUSD(it.price)}</td>
                  <td>${it.type||'-'}</td>
                  <td class="actions">
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

  function productCard(it){
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <div style="font-size:20px;font-weight:800;margin-bottom:6px">${it.name}</div>
          <div><strong>Barcode:</strong> ${it.barcode||'-'}</div>
          <div><strong>Price:</strong> ${fmtUSD(it.price)}</div>
          <div><strong>Type:</strong> ${it.type||'-'}</div>
        </div></div>
        <div class="card"><div class="card-body">
          <div><strong>Ingredients</strong></div>
          <div>${it.ingredients||'-'}</div>
          <div style="margin-top:10px"><strong>Instructions</strong></div>
          <div>${it.instructions||'-'}</div>
        </div></div>
      </div>
    `;
  }

  function viewCOGS(){
    const headers = ['Date','G-Income','Produce Cost','Item Cost','Freight','Other','G-Profit'];
    const rows = state.cogs.map(r=>{
      const gp = (+r.grossIncome||0)-((+r.produceCost||0)+(+r.itemCost||0)+(+r.freight||0)+(+r.other||0));
      return { ...r, gp };
    });
    const years = Array.from(new Set(state.cogs.map(r => (r.date||'').slice(0,4)).filter(Boolean))).sort().reverse();

    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
          <h3 style="margin:0">COGS</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="cogs-year" class="input" style="width:140px">
              <option value="">All Years</option>
              ${years.map(y=>`<option value="${y}">${y}</option>`).join('')}
            </select>
            <select id="cogs-month" class="input" style="width:140px">
              <option value="">All Months</option>
              ${Array.from({length:12},(_,i)=>`<option value="${i+1}">${String(i+1).padStart(2,'0')}</option>`).join('')}
            </select>
            <button class="btn ghost" id="filter-cogs"><i class="ri-filter-3-line"></i> Filter</button>
            <button class="btn ok" id="export-cogs"><i class="ri-download-2-line"></i> Export CSV</button>
            <button class="btn secondary" id="export-cogs-range"><i class="ri-download-2-line"></i> Export Range</button>
            ${canAdd()? `<button class="btn" id="addCOGS"><i class="ri-add-line"></i> Add Row</button>`:''}
          </div>
        </div>

        <div class="table-wrap" data-section="cogs">
          <table class="table">
            <thead><tr>${headers.map((h,i)=>`<th class="${i? 'num':''}">${h}</th>`).join('')}<th>Actions</th></tr></thead>
            <tbody id="cogs-tbody">
              ${rows.map(r=>`
                <tr id="${r.id}" class="${state.searchHitId===r.id?'search-hit':''}">
                  <td>${r.date}</td>
                  <td class="num">${fmtUSD(r.grossIncome)}</td>
                  <td class="num">${fmtUSD(r.produceCost)}</td>
                  <td class="num">${fmtUSD(r.itemCost)}</td>
                  <td class="num">${fmtUSD(r.freight)}</td>
                  <td class="num">${fmtUSD(r.other)}</td>
                  <td class="num"><strong>${fmtUSD(r.gp)}</strong></td>
                  <td class="actions">
                    ${canEdit()? `<button class="btn ghost" data-edit="${r.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${r.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </td>
                </tr>`).join('')}
              ${(()=>{
                const t=rows.reduce((a,r)=>({gi:a.gi+(+r.grossIncome||0),pc:a.pc+(+r.produceCost||0),ic:a.ic+(+r.itemCost||0),fr:a.fr+(+r.freight||0),ot:a.ot+(+r.other||0),gp:a.gp+(+r.gp||0)}),{gi:0,pc:0,ic:0,fr:0,ot:0,gp:0});
                return `<tr class="tr-total">
                  <th>Total</th>
                  <th class="num">${fmtUSD(t.gi)}</th>
                  <th class="num">${fmtUSD(t.pc)}</th>
                  <th class="num">${fmtUSD(t.ic)}</th>
                  <th class="num">${fmtUSD(t.fr)}</th>
                  <th class="num">${fmtUSD(t.ot)}</th>
                  <th class="num">${fmtUSD(t.gp)}</th>
                  <th></th>
                </tr>`;
              })()}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }

  function viewTasks(){
    const lane = (key,label,color) => {
      const cards = state.tasks.filter(t=>t.status===key);
      return `
        <div class="card lane-row" data-lane="${key}">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h3 style="margin:0;color:${color}">${label}</h3>
              ${key==='todo' && canAdd()? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
            </div>
            <div class="grid lane-grid" id="lane-${key}">
              ${cards.map(t=>`
                <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
                  <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                    <div>${t.title}</div>
                    <div class="actions">
                      ${canEdit()? `<button class="btn ghost" data-edit="${t.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                      ${canDelete()? `<button class="btn danger" data-del="${t.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                    </div>
                  </div>
                </div>`).join('')}
              ${cards.length? '' : `<div style="padding:10px;color:var(--muted)">Drop tasks here…</div>`}
            </div>
          </div>
        </div>`;
    };
    return `<div data-section="tasks">
      ${lane('todo','To do','#f59e0b')}
      ${lane('inprogress','In progress','#3b82f6')}
      ${lane('done','Done','#10b981')}
    </div>`;
  }

  function viewSettings(){
    const theme = state.theme;
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin-top:0">Theme</h3>
          <div class="grid cols-2">
            <div>
              <label>Palette</label>
              <select id="theme-palette" class="input">
                ${['sunrise','sky','mint','slate','dark'].map(x=>`<option value="${x}" ${theme.palette===x?'selected':''}>${x}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Font size</label>
              <select id="theme-font" class="input">
                ${['small','medium','large'].map(x=>`<option value="${x}" ${theme.font===x?'selected':''}>${x}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save Theme</button></div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin-top:0">Account</h3>
          <div class="grid">
            <div><strong>Email:</strong> ${state.user?.email||'-'}</div>
            <div><strong>Role:</strong> ${state.role}</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 id="users-table" style="margin-top:0">Users (tenant)</h3>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="color:var(--muted)">Manage a simple team list for your tenant.</div>
            ${canAdd()? `<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
          </div>
          <div class="table-wrap" data-section="users">
            <table class="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
              <tbody>
                ${state.users.map(u=>`
                  <tr id="${u.id}" class="${state.searchHitId===u.id?'search-hit':''}">
                    <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
                    <td class="actions">
                      ${canEdit()? `<button class="btn ghost" data-edit="${u.id}"><i class="ri-edit-line"></i></button>`:''}
                      ${canDelete()? `<button class="btn danger" data-del="${u.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div></div>
      </div>
    `;
  }

  function viewLinks(){
    return `
      <div class="grid">
        <div class="card"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">My Links</h3>
            ${canAdd()? `<button class="btn" id="addLink"><i class="ri-add-line"></i> Add Link</button>`:''}
          </div>
          <div class="grid cols-2" data-section="links">
            ${(state.links||[]).map(l=>`
              <div class="card">
                <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:700">${l.title||'(untitled)'}</div>
                    <div style="color:var(--muted);font-size:12px">${l.url||''}</div>
                  </div>
                  <div class="actions">
                    <button class="btn" data-open="${l.id}" title="Open"><i class="ri-external-link-line"></i></button>
                    ${canEdit()? `<button class="btn ghost" data-edit="${l.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                    ${canDelete()? `<button class="btn danger" data-del="${l.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>`:''}
                  </div>
                </div>
              </div>`).join('')}
            ${!state.links.length ? `<div style="color:var(--muted);padding:10px">No links yet.</div>`:''}
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3>Contact</h3>
          <div class="grid">
            <input id="ct-name"  class="input" placeholder="Your name"/>
            <input id="ct-email" class="input" placeholder="you@example.com"/>
            <textarea id="ct-msg" class="input" placeholder="Your message"></textarea>
            <div style="display:flex;gap:8px">
              <button class="btn" id="send-email"><i class="ri-mail-send-line"></i> Send</button>
              <a class="btn ghost" href="mailto:minmaung0307@gmail.com" target="_blank" rel="noopener">or mailto</a>
            </div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3>About</h3>
          <p style="color:var(--muted)">A fast, offline-friendly inventory app for SMBs — manage stock, products, costs, tasks, and export COGS, anywhere.</p>
        </div></div>
      </div>
    `;
  }

  function viewSearch(){
    const q = state.searchQ || '';
    const res = q ? doSearch(q) : [];
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Search</h3>
          <div style="color:var(--muted)">Query: <strong>${q||'(empty)'}</strong></div>
        </div>
        ${res.length ? `
          <div class="grid">
            ${res.map(r=>`
              <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div><div style="font-weight:700">${r.label}</div><div style="color:var(--muted);font-size:12px">${r.section||''}</div></div>
                <button class="btn" data-go="${r.route}" data-id="${r.id||''}">Open</button>
              </div></div>`).join('')}
          </div>` : `<p style="color:var(--muted)">No results.</p>`}
      </div></div>
    `;
  }

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

  /* ---------- Render ---------- */
  function render(){
    const root = $('#root');
    if (!auth.currentUser){
      root.innerHTML = viewLogin();
      wireLogin();
      return;
    }
    const html = layout( safeView(state.route) );
    root.innerHTML = html;
    wireShell();
    wireRoute();

    // If a search hit is set, scroll it into view
    if (state.searchHitId){
      setTimeout(()=>{
        document.getElementById(state.searchHitId)?.scrollIntoView({behavior:'smooth', block:'center'});
      }, 80);
    }
  }

  /* ---------- Sidebar helpers (mobile) ---------- */
  function openSidebar(){
    document.body.classList.add('sidebar-open');
    $('#backdrop')?.classList.add('active');
  }
  function closeSidebar(){
    document.body.classList.remove('sidebar-open');
    $('#backdrop')?.classList.remove('active');
  }
  function ensureEdgeOpener(){
    if ($('#sidebarEdge')) return;
    const edge = document.createElement('div');
    edge.id = 'sidebarEdge';
    document.body.appendChild(edge);
    const opener = ()=> openSidebar();
    ['pointerenter','touchstart'].forEach(evt=> edge.addEventListener(evt, opener, {passive:true}));
  }

  /* ---------- Wiring (shell + routes) ---------- */
  function wireShell(){
    // Burger / Backdrop / Brand / Main -> close on mobile
    $('#burger')?.addEventListener('click', ()=>{
      if (document.body.classList.contains('sidebar-open')) closeSidebar();
      else openSidebar();
    });
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);
    ensureEdgeOpener();

    // Sidebar NAV — event delegation
    const nav = $('#side-nav');
    nav?.addEventListener('click', (e)=>{
      const it = e.target.closest('.item[data-route]');
      if (it){
        state.searchHitId = null;     // clear highlight when using nav
        go(it.getAttribute('data-route'));
      }
    });
    nav?.addEventListener('keydown', (e)=>{
      if (e.key==='Enter' || e.key===' '){
        const it = e.target.closest('.item[data-route]');
        if (it){ e.preventDefault(); state.searchHitId=null; go(it.getAttribute('data-route')); }
      }
    });

    // Dashboard quick tiles open
    $('#main')?.addEventListener('click', (e)=>{
      const card = e.target.closest('.card.clickable[data-go]');
      if (card){ state.searchHitId = null; go(card.getAttribute('data-go')); }
    });

    // Logout
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());

    // Topbar search
    const input = $('#globalSearch'), results = $('#searchResults');
    if (input && results){
      let timer;
      input.addEventListener('keydown', (e)=>{
        if (e.key==='Enter'){
          const q = input.value.trim();
          state.searchQ = q; state.searchHitId = null;
          go('search'); results.classList.remove('active');
        }
      });
      input.addEventListener('input', ()=>{
        clearTimeout(timer);
        const q = input.value.trim();
        if (!q){ results.classList.remove('active'); results.innerHTML=''; return; }
        timer = setTimeout(()=>{
          const out = doSearch(q).slice(0,12);
          results.innerHTML = out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span style="color:var(--muted)">— ${r.section}</span></div>`).join('');
          results.classList.add('active');
          results.querySelectorAll('.row').forEach(row=>{
            row.onclick = ()=>{
              const r = row.getAttribute('data-route'); const id=row.getAttribute('data-id');
              state.searchQ = q; state.searchHitId = id || null; go(r);
              results.classList.remove('active');
            };
          });
        }, 120);
      });
      document.addEventListener('click', (e)=>{ if (!results.contains(e.target) && e.target !== input) results.classList.remove('active'); });
    }

    // Sidebar search (mobile)
    const sInput = $('#sideSearch'), sResults = $('#sideSearchResults');
    if (sInput && sResults){
      let t;
      sInput.addEventListener('keydown', (e)=>{
        if (e.key==='Enter'){
          const q = sInput.value.trim();
          state.searchQ = q; state.searchHitId = null;
          go('search'); sResults.classList.remove('active'); closeSidebar();
        }
      });
      sInput.addEventListener('input', ()=>{
        clearTimeout(t);
        const q = sInput.value.trim();
        if (!q){ sResults.classList.remove('active'); sResults.innerHTML=''; return; }
        t = setTimeout(()=>{
          const out = doSearch(q).slice(0,12);
          sResults.innerHTML = out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span style="color:var(--muted)">— ${r.section}</span></div>`).join('');
          sResults.classList.add('active');
          sResults.querySelectorAll('.row').forEach(row=>{
            row.onclick = ()=>{
              const r = row.getAttribute('data-route'); const id=row.getAttribute('data-id');
              state.searchQ = q; state.searchHitId = id || null; go(r); closeSidebar();
              sResults.classList.remove('active');
            };
          });
        }, 120);
      });
      document.addEventListener('click', (e)=>{ if (!sResults.contains(e.target) && e.target !== sInput) sResults.classList.remove('active'); });
    }

    // Modal close
    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));

    // Update year in footer
    $('#copyright')?.replaceChildren(document.createTextNode(`Powered by MM, ${yearNow()}`));
  }

  function wireRoute(){
    switch(state.route){
      case 'dashboard': wirePosts(); break;
      case 'inventory': wireInventory(); break;
      case 'products':  wireProducts(); break;
      case 'cogs':      wireCOGS(); break;
      case 'tasks':     wireTasks(); break;
      case 'settings':  wireSettings(); break;
      case 'links':     wireLinks(); break;
      case 'search':    wireSearch(); break;
    }
  }

  /* ---------- Login ---------- */
  function wireLogin(){
    const doLogin = async ()=>{
      const email = ($('#li-email')?.value||'').trim();
      const pass  = ($('#li-pass')?.value||'').trim();
      if (!email || !pass) return notify('Enter email & password','warn');
      try{
        await auth.signInWithEmailAndPassword(email, pass);
      }catch(e){
        notify(e?.message||'Login failed','danger');
      }
    };

    $('#btnLogin')?.addEventListener('click', doLogin);
    $('#li-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

    $('#link-forgot')?.addEventListener('click', async ()=>{
      const email = ($('#li-email')?.value||'').trim();
      if (!email) return notify('Enter your email first','warn');
      try { await auth.sendPasswordResetEmail(email); notify('Reset email sent','ok'); } catch(e){ notify(e?.message||'Failed','danger'); }
    });

    $('#link-register')?.addEventListener('click', async ()=>{
      const email = ($('#li-email')?.value||'').trim();
      const pass  = ($('#li-pass')?.value||'').trim() || 'admin123';
      if (!email) return notify('Enter an email in Email box, then click Sign up again.','warn');
      try{
        await auth.createUserWithEmailAndPassword(email, pass);
        // create default role if not exists
        const id = email.toLowerCase();
        await regDoc(id).set({
          email: id, role: ADMIN_EMAILS.includes(id)?'admin':'user',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, {merge:true});
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  /* ---------- Posts ---------- */
  function wirePosts(){
    $('#addPost')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Post';
      $('#mm-body').innerHTML = `
        <div class="grid">
          <input id="post-title" class="input" placeholder="Title"/>
          <textarea id="post-body" class="input" placeholder="Body"></textarea>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-post">Save</button>`;
      openModal('m-modal');

      $('#save-post').onclick = async ()=>{
        const obj = {
          title: ($('#post-title')?.value||'').trim(),
          body:  ($('#post-body')?.value||'').trim(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if(!obj.title) return notify('Title required','warn');
        await tcol('posts').add(obj);
        closeModal('m-modal'); notify('Saved');
      };
    });

    const sec = document.querySelector('[data-section="posts"]');
    if (!sec || sec.__wired) return;
    sec.__wired = true;
    sec.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button'); if(!btn) return;
      const id  = btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const snap = await tcol('posts').doc(id).get(); if(!snap.exists) return;
        const p = { id:snap.id, ...snap.data() };
        $('#mm-title').textContent='Edit Post';
        $('#mm-body').innerHTML = `
          <div class="grid">
            <input id="post-title" class="input" placeholder="Title" value="${p.title||''}"/>
            <textarea id="post-body" class="input" placeholder="Body">${p.body||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-post">Save</button>`;
        openModal('m-modal');
        $('#save-post').onclick = async ()=>{
          await tcol('posts').doc(id).set({
            title: ($('#post-title')?.value||'').trim(),
            body:  ($('#post-body')?.value||'').trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        if(!canDelete()) return notify('No permission','warn');
        await tcol('posts').doc(id).delete();
        notify('Deleted');
      }
    });
  }

  /* ---------- Inventory ---------- */
  function wireInventory(){
    $('#export-inventory')?.addEventListener('click', async ()=>{
      const rows = state.inventory||[];
      const headers=['id','name','code','type','price','stock','threshold'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
      const a=document.createElement('a'); a.href=url; a.download='inventory.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#addInv')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Inventory Item';
      $('#mm-body').innerHTML = `
        <div class="grid cols-3">
          <input id="inv-name" class="input" placeholder="Name"/>
          <input id="inv-code" class="input" placeholder="Code"/>
          <select id="inv-type" class="input"><option>Raw</option><option>Cooked</option><option>Dried</option><option>Utencils</option><option>Tools</option><option>Clothings</option><option>Jewellery</option><option>Docs</option><option>Transports</option><option>Other</option></select>
          <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price"/>
          <input id="inv-stock" class="input" type="number" placeholder="Stock"/>
          <input id="inv-threshold" class="input" type="number" placeholder="Threshold"/>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-inv">Save</button>`;
      openModal('m-modal');

      $('#save-inv').onclick = async ()=>{
        const obj = {
          name: ($('#inv-name')?.value||'').trim(),
          code: ($('#inv-code')?.value||'').trim(),
          type: ($('#inv-type')?.value||'').trim(),
          price: parseFloat($('#inv-price')?.value||'0'),
          stock: parseInt($('#inv-stock')?.value||'0',10),
          threshold: parseInt($('#inv-threshold')?.value||'0',10),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if(!obj.name) return notify('Name required','warn');
        await tcol('inventory').add(obj);
        closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=document.querySelector('[data-section="inventory"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    // inc/dec (manager/admin only)
    sec.addEventListener('click', async (e)=>{
      const incBtn = e.target.closest('button[data-inc]'); const decBtn = e.target.closest('button[data-dec]');
      if (incBtn || decBtn){
        if(!canEdit()) return notify('No permission','warn');
        const id = (incBtn||decBtn).getAttribute('data-inc') || (incBtn||decBtn).getAttribute('data-dec');
        const delta = incBtn ? 1 : -1;
        await tcol('inventory').doc(id).set({ stock: firebase.firestore.FieldValue.increment(delta), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
        return;
      }
    });

    // edit/delete
    sec.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button'); if(!btn) return;
      const id  = btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const snap = await tcol('inventory').doc(id).get(); if(!snap.exists) return;
        const it = { id:snap.id, ...snap.data() };
        $('#mm-title').textContent='Edit Item';
        $('#mm-body').innerHTML = `
          <div class="grid cols-3">
            <input id="inv-name" class="input" placeholder="Name" value="${it.name||''}"/>
            <input id="inv-code" class="input" placeholder="Code" value="${it.code||''}"/>
            <select id="inv-type" class="input">
              ${['Raw','Cooked','Dried', 'Utencils', 'Tools', 'Clothings', 'Jewellery', 'Docs', 'Transports', 'Other'].map(x=>`<option ${it.type===x?'selected':''}>${x}</option>`).join('')}
            </select>
            <input id="inv-price" class="input" type="number" step="0.01" placeholder="Price" value="${it.price||0}"/>
            <input id="inv-stock" class="input" type="number" placeholder="Stock" value="${it.stock||0}"/>
            <input id="inv-threshold" class="input" type="number" placeholder="Threshold" value="${it.threshold||0}"/>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-inv">Save</button>`;
        openModal('m-modal');
        $('#save-inv').onclick = async ()=>{
          await tcol('inventory').doc(id).set({
            name: ($('#inv-name')?.value||'').trim(),
            code: ($('#inv-code')?.value||'').trim(),
            type: ($('#inv-type')?.value||'').trim(),
            price: parseFloat($('#inv-price')?.value||'0'),
            stock: parseInt($('#inv-stock')?.value||'0',10),
            threshold: parseInt($('#inv-threshold')?.value||'0',10),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else if (btn.hasAttribute('data-del')) {
        if(!canDelete()) return notify('No permission','warn');
        await tcol('inventory').doc(id).delete();
        notify('Deleted');
      }
    });
  }

  /* ---------- Products ---------- */
  function wireProducts(){
    $('#export-products')?.addEventListener('click', ()=>{
      const rows = state.products||[];
      const headers=['id','name','barcode','price','type','ingredients','instructions'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const a=document.createElement('a'), url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
      a.href=url; a.download='products.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#addProd')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Product';
      $('#mm-body').innerHTML = `
        <div class="grid cols-2">
          <input id="prod-name" class="input" placeholder="Name"/>
          <input id="prod-barcode" class="input" placeholder="Barcode"/>
          <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price"/>
          <input id="prod-type" class="input" placeholder="Type"/>
          <textarea id="prod-ingredients" class="input" placeholder="Ingredients"></textarea>
          <textarea id="prod-instructions" class="input" placeholder="Instructions"></textarea>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-prod">Save</button>`;
      openModal('m-modal');

      $('#save-prod').onclick = async ()=>{
        const obj = {
          name: ($('#prod-name')?.value||'').trim(),
          barcode: ($('#prod-barcode')?.value||'').trim(),
          price: parseFloat($('#prod-price')?.value||'0'),
          type: ($('#prod-type')?.value||'').trim(),
          ingredients: ($('#prod-ingredients')?.value||'').trim(),
          instructions: ($('#prod-instructions')?.value||'').trim(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if(!obj.name) return notify('Name required','warn');
        await tcol('products').add(obj);
        closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=document.querySelector('[data-section="products"]'); if(!sec||sec.__wired) return; sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const card = e.target.closest('button[data-card]');
      if (card){
        const id = card.getAttribute('data-card');
        const snap = await tcol('products').doc(id).get(); if(!snap.exists) return;
        const it = {id:snap.id, ...snap.data()};
        $('#mm-title').textContent = it.name || 'Product';
        $('#mm-body').innerHTML = productCard(it);
        $('#mm-foot').innerHTML = `<button class="btn ghost" id="pc-close">Back</button>`;
        openModal('m-modal');
        $('#pc-close').onclick=()=> closeModal('m-modal');
        return;
      }
      const btn = e.target.closest('button'); if(!btn) return;
      const id  = btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const snap = await tcol('products').doc(id).get(); if(!snap.exists) return;
        const it = {id:snap.id, ...snap.data()};
        $('#mm-title').textContent='Edit Product';
        $('#mm-body').innerHTML = `
          <div class="grid cols-2">
            <input id="prod-name" class="input" placeholder="Name" value="${it.name||''}"/>
            <input id="prod-barcode" class="input" placeholder="Barcode" value="${it.barcode||''}"/>
            <input id="prod-price" class="input" type="number" step="0.01" placeholder="Price" value="${it.price||0}"/>
            <input id="prod-type" class="input" placeholder="Type" value="${it.type||''}"/>
            <textarea id="prod-ingredients" class="input" placeholder="Ingredients">${it.ingredients||''}</textarea>
            <textarea id="prod-instructions" class="input" placeholder="Instructions">${it.instructions||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-prod">Save</button>`;
        openModal('m-modal');
        $('#save-prod').onclick = async ()=>{
          await tcol('products').doc(id).set({
            name: ($('#prod-name')?.value||'').trim(),
            barcode: ($('#prod-barcode')?.value||'').trim(),
            price: parseFloat($('#prod-price')?.value||'0'),
            type: ($('#prod-type')?.value||'').trim(),
            ingredients: ($('#prod-ingredients')?.value||'').trim(),
            instructions: ($('#prod-instructions')?.value||'').trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        if(!canDelete()) return notify('No permission','warn');
        await tcol('products').doc(id).delete();
        notify('Deleted');
      }
    });
  }

  /* ---------- COGS ---------- */
  function wireCOGS(){
    $('#export-cogs')?.addEventListener('click', ()=>{
      const rows=state.cogs||[]; const headers=['id','date','grossIncome','produceCost','itemCost','freight','other'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='cogs.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#export-cogs-range')?.addEventListener('click', ()=>{
      const y = +($('#cogs-year')?.value || 0), m = +($('#cogs-month')?.value || 0);
      const rows = (state.cogs||[]).filter(r=>{
        const d = r.date || ''; const Y = +d.slice(0,4), M = +d.slice(5,7);
        if (y && m) return Y===y && M===m;
        if (y && !m) return Y===y;
        return true;
      });
      const headers=['id','date','grossIncome','produceCost','itemCost','freight','other'];
      const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replace(/"/g,'""')).map(s=> /[",\n]/.test(s)?`"${s}"`:s ).join(','))).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download = y ? (m?`cogs_${y}-${String(m).padStart(2,'0')}.csv`:`cogs_${y}.csv`) : 'cogs_range.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0);
    });

    $('#addCOGS')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='COGS Row';
      $('#mm-body').innerHTML = `
        <div class="grid cols-3">
          <input id="cogs-date" class="input" type="date" value="${new Date().toISOString().slice(0,10)}"/>
          <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="G-Income"/>
          <input id="cogs-produceCost" class="input" type="number" step="0.01" placeholder="Produce Cost"/>
          <input id="cogs-itemCost" class="input" type="number" step="0.01" placeholder="Item Cost"/>
          <input id="cogs-freight" class="input" type="number" step="0.01" placeholder="Freight"/>
          <input id="cogs-other" class="input" type="number" step="0.01" placeholder="Other"/>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-cogs">Save</button>`;
      openModal('m-modal');

      $('#save-cogs').onclick = async ()=>{
        const row = {
          date: $('#cogs-date')?.value || new Date().toISOString().slice(0,10),
          grossIncome:+($('#cogs-grossIncome')?.value||0),
          produceCost:+($('#cogs-produceCost')?.value||0),
          itemCost:+($('#cogs-itemCost')?.value||0),
          freight:+($('#cogs-freight')?.value||0),
          other:+($('#cogs-other')?.value||0),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await tcol('cogs').add(row);
        closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=document.querySelector('[data-section="cogs"]'); if(!sec||sec.__wired) return; sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if (btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const snap = await tcol('cogs').doc(id).get(); if(!snap.exists) return;
        const r = { id:snap.id, ...snap.data() };
        $('#mm-title').textContent='Edit COGS';
        $('#mm-body').innerHTML = `
          <div class="grid cols-3">
            <input id="cogs-date" class="input" type="date" value="${r.date||new Date().toISOString().slice(0,10)}"/>
            <input id="cogs-grossIncome" class="input" type="number" step="0.01" placeholder="G-Income" value="${r.grossIncome||0}"/>
            <input id="cogs-produceCost" class="input" type="number" step="0.01" placeholder="Produce Cost" value="${r.produceCost||0}"/>
            <input id="cogs-itemCost" class="input" type="number" step="0.01" placeholder="Item Cost" value="${r.itemCost||0}"/>
            <input id="cogs-freight" class="input" type="number" step="0.01" placeholder="Freight" value="${r.freight||0}"/>
            <input id="cogs-other" class="input" type="number" step="0.01" placeholder="Other" value="${r.other||0}"/>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-cogs">Save</button>`;
        openModal('m-modal');
        $('#save-cogs').onclick = async ()=>{
          await tcol('cogs').doc(id).set({
            date: $('#cogs-date')?.value || new Date().toISOString().slice(0,10),
            grossIncome:+($('#cogs-grossIncome')?.value||0),
            produceCost:+($('#cogs-produceCost')?.value||0),
            itemCost:+($('#cogs-itemCost')?.value||0),
            freight:+($('#cogs-freight')?.value||0),
            other:+($('#cogs-other')?.value||0),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        if(!canDelete()) return notify('No permission','warn');
        await tcol('cogs').doc(id).delete();
        notify('Deleted');
      }
    });
  }

  /* ---------- Tasks ---------- */
  function wireTasks(){
    $('#addTask')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML = `
        <div class="grid">
          <input id="task-title" class="input" placeholder="Title"/>
          <select id="task-status" class="input"><option value="todo">To do</option><option value="inprogress">In progress</option><option value="done">Done</option></select>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-task">Save</button>`;
      openModal('m-modal');

      $('#save-task').onclick = async ()=>{
        const t = { title: ($('#task-title')?.value||'').trim(), status: ($('#task-status')?.value||'todo'), createdAt: firebase.firestore.FieldValue.serverTimestamp() };
        if(!t.title) return notify('Title required','warn');
        await tcol('tasks').add(t); closeModal('m-modal'); notify('Saved');
      };
    });

    const root=document.querySelector('[data-section="tasks"]'); if(!root) return;

    // drag + drop
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
      grid.addEventListener('drop',async (e)=>{
        e.preventDefault(); hide(); if(!lane) return;
        if (!canAdd()) return notify('No permission','warn');
        const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        await tcol('tasks').doc(id).set({ status: lane, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
        notify('Task moved');
      });
    });

    // edit/delete
    root.addEventListener('click',(e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const t = state.tasks.find(x=>x.id===id); if(!t) return;
        $('#mm-title').textContent='Edit Task';
        $('#mm-body').innerHTML = `
          <div class="grid">
            <input id="task-title" class="input" placeholder="Title" value="${t.title||''}"/>
            <select id="task-status" class="input">
              ${['todo','inprogress','done'].map(x=>`<option value="${x}" ${t.status===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-task">Save</button>`;
        openModal('m-modal');
        $('#save-task').onclick = async ()=>{
          await tcol('tasks').doc(id).set({
            title: ($('#task-title')?.value||'').trim(),
            status: ($('#task-status')?.value||'todo'),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        if(!canDelete()) return notify('No permission','warn');
        tcol('tasks').doc(id).delete().then(()=> notify('Deleted'));
      }
    });

    // tap to advance (mobile)
    const isTouch='ontouchstart' in window || navigator.maxTouchPoints>0;
    if (isTouch){
      $$('.task-card').forEach(card=>{
        card.addEventListener('click', async (e)=>{
          if (e.target.closest('button')) return;
          if (!canAdd()) return notify('No permission','warn');
          const id=card.getAttribute('data-task'); const t=state.tasks.find(x=>x.id===id); if(!t) return;
          const next=t.status==='todo'?'inprogress':(t.status==='inprogress'?'done':'todo');
          await tcol('tasks').doc(id).set({ status: next, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
        });
      });
    }
  }

  /* ---------- Settings (theme + users + registry) ---------- */
  function wireSettings(){
    $('#theme-palette')?.addEventListener('change', (e)=>{ setTheme(e.target.value, null); });
    $('#theme-font')?.addEventListener('change', (e)=>{ setTheme(null, e.target.value); });
    $('#save-theme')?.addEventListener('click', saveKVTheme);

    const table=document.querySelector('[data-section="users"]');

    // Add user to tenant + registry (role)
    $('#addUser')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Tenant User';
      $('#mm-body').innerHTML = `
        <div class="grid cols-3">
          <input id="user-name" class="input" placeholder="Name"/>
          <input id="user-email" class="input" placeholder="Email"/>
          <select id="user-role" class="input">
            ${VALID_ROLES.map(x=>`<option value="${x}">${x}</option>`).join('')}
          </select>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-user">Save</button>`;
      openModal('m-modal');

      $('#save-user').onclick = async ()=>{
        const name = ($('#user-name')?.value||'').trim();
        const email= ($('#user-email')?.value||'').trim().toLowerCase();
        const role = ($('#user-role')?.value||'user').toLowerCase();
        if(!email) return notify('Email required','warn');
        if(!VALID_ROLES.includes(role)) return notify('Invalid role','warn');

        try {
          const ts = firebase.firestore.FieldValue.serverTimestamp();
          await Promise.all([
            tcol('users').add({ name, email, role, createdAt: ts }),
            regDoc(email).set({ email, role, updatedAt: ts }, { merge:true })
          ]);
          closeModal('m-modal');
          notify('Saved');
        } catch(e){
          notify(e?.message || 'Failed to save user','danger');
        }
      };
    });

    // Edit / delete (also reflect in registry)
    table?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;

      if(btn.hasAttribute('data-edit')){
        if(!canEdit()) return notify('No permission','warn');
        const snap=await tcol('users').doc(id).get(); if(!snap.exists) return;
        const u={id:snap.id, ...snap.data()};
        $('#mm-title').textContent='Edit Tenant User';
        $('#mm-body').innerHTML = `
          <div class="grid cols-3">
            <input id="user-name" class="input" placeholder="Name" value="${u.name||''}"/>
            <input id="user-email" class="input" placeholder="Email" value="${u.email||''}"/>
            <select id="user-role" class="input">
              ${VALID_ROLES.map(x=>`<option value="${x}" ${u.role===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-user">Save</button>`;
        openModal('m-modal');
        $('#save-user').onclick = async ()=>{
          const name = ($('#user-name')?.value||'').trim();
          const email= ($('#user-email')?.value||'').trim().toLowerCase();
          const role = ($('#user-role')?.value||'user').toLowerCase();
          if(!VALID_ROLES.includes(role)) return notify('Invalid role','warn');

          try {
            const ts = firebase.firestore.FieldValue.serverTimestamp();
            await Promise.all([
              tcol('users').doc(id).set({ name, email, role, updatedAt: ts }, { merge:true }),
              regDoc(email).set({ email, role, updatedAt: ts }, { merge:true })
            ]);
            closeModal('m-modal');
            notify('Saved');
          } catch(e){
            notify(e?.message || 'Failed to update','danger');
          }
        };
      } else {
        if(!canDelete()) return notify('No permission','warn');
        const snap=await tcol('users').doc(id).get(); const email=(snap.data()?.email||'').toLowerCase();
        await tcol('users').doc(id).delete();
        if (email) await regDoc(email).set({ email, role:'user', updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true}); // fallback
        notify('Deleted');
      }
    });
  }

  /* ---------- Links (EmailJS + viewer) ---------- */
  function wireLinks(){
    if (window.emailjs && EMAILJS_PUBLIC_KEY) {
      try { window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); } catch {}
    }
    $('#send-email')?.addEventListener('click', async ()=>{
      const name=($('#ct-name')?.value||'').trim(), email=($('#ct-email')?.value||'').trim(), msg=($('#ct-msg')?.value||'').trim();
      if (!name || !email || !msg) return notify('Fill all fields','warn');
      if (window.emailjs && EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID){
        try{
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { from_name:name, reply_to:email, message:msg, to_email:'minmaung0307@gmail.com' });
          notify('Email sent!'); $('#ct-name').value=''; $('#ct-email').value=''; $('#ct-msg').value='';
        }catch(e){ notify('EmailJS failed; opening mail app…','warn'); window.open(`mailto:minmaung0307@gmail.com?subject=Hello&body=${encodeURIComponent(msg)}`,'_blank'); }
      } else {
        window.open(`mailto:minmaung0307@gmail.com?subject=Hello&body=${encodeURIComponent(msg)}`,'_blank');
      }
    });

    const sec=document.querySelector('[data-section="links"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn = e.target.closest('button[data-open]');
      const editBtn = e.target.closest('button[data-edit]');
      const delBtn  = e.target.closest('button[data-del]');
      if (openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await tcol('links').doc(id).get(); if(!snap.exists) return;
        const l = {id:snap.id, ...snap.data()};
        $('#mm-title').textContent=l.title||'Link';
        $('#mm-body').innerHTML = `
          <div style="height:min(70vh,600px);border:1px solid var(--border);border-radius:12px;overflow:hidden">
            <iframe id="ifv" src="${(l.url||'').replace(/"/g,'&quot;')}" style="width:100%;height:100%;border:0"></iframe>
          </div>
          <div style="color:var(--muted);font-size:12px;margin-top:6px">If the site blocks embedding, use “Open in new tab”.</div>`;
        $('#mm-foot').innerHTML = `
          <a class="btn secondary" href="${l.url||'#'}" target="_blank" rel="noopener"><i class="ri-external-link-line"></i> Open in new tab</a>
          <span></span>
          <button class="btn ghost" id="back-links">Back</button>`;
        openModal('m-modal');
        $('#back-links').onclick=()=> closeModal('m-modal');
        return;
      }
      if (editBtn){
        if(!canEdit()) return notify('No permission','warn');
        const id=editBtn.getAttribute('data-edit'); const snap=await tcol('links').doc(id).get(); if(!snap.exists) return;
        const l={id:snap.id, ...snap.data()};
        $('#mm-title').textContent='Edit Link';
        $('#mm-body').innerHTML = `
          <div class="grid">
            <input id="lk-title" class="input" placeholder="Title" value="${l.title||''}"/>
            <input id="lk-url" class="input" placeholder="https://example.com" value="${l.url||''}"/>
          </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="save-link">Save</button>`;
        openModal('m-modal');
        $('#save-link').onclick=async ()=>{
          await tcol('links').doc(id).set({
            title: ($('#lk-title')?.value||'').trim(),
            url:   ($('#lk-url')?.value||'').trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          closeModal('m-modal'); notify('Saved');
        };
        return;
      }
      if (delBtn){
        if(!canDelete()) return notify('No permission','warn');
        const id=delBtn.getAttribute('data-del'); await tcol('links').doc(id).delete(); notify('Deleted'); return;
      }
    });

    // add link
    $('#addLink')?.addEventListener('click', ()=>{
      if(!canAdd()) return notify('No permission','warn');
      $('#mm-title').textContent='Add Link';
      $('#mm-body').innerHTML = `
        <div class="grid">
          <input id="lk-title" class="input" placeholder="Title"/>
          <input id="lk-url" class="input" placeholder="https://example.com"/>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="save-link">Save</button>`;
      openModal('m-modal');
      $('#save-link').onclick=async ()=>{
        const l={ title:($('#lk-title')?.value||'').trim(), url:($('#lk-url')?.value||'').trim(), createdAt: firebase.firestore.FieldValue.serverTimestamp() };
        if(!l.title || !l.url) return notify('Fill title and URL','warn');
        await tcol('links').add(l); closeModal('m-modal'); notify('Saved');
      };
    });
  }

  function wireSearch(){
    document.querySelectorAll('[data-go]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const r=el.getAttribute('data-go'); const id=el.getAttribute('data-id');
        state.searchHitId = id || null;
        go(r);
      });
    });
  }

  /* ---------- Auth listener (role = adminList > registry > user) ---------- */
  auth.onAuthStateChanged(async (user)=>{
    state.user = user || null;
    if (!user){
      clearSnapshots();
      render();
      return;
    }
    const emailLower = (user.email||'').toLowerCase();
    state.role = ADMIN_EMAILS.includes(emailLower) ? 'admin' : 'user';
    try{
      const reg = await regDoc(emailLower).get();
      const r = (reg.data()?.role || state.role || 'user').toLowerCase();
      if (VALID_ROLES.includes(r)) state.role = r;
    }catch(e){
      console.warn('userRegistry read failed; defaulting to "user"', e);
    }

    // Seed/read theme
    try{
      const kv = await tdoc('_theme').get();
      if (!kv.exists){
        await tdoc('_theme').set({
          palette: state.theme.palette, font: state.theme.font, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        const data = kv.data() || {};
        setTheme(data.palette||state.theme.palette, data.font||state.theme.font);
      }
    }catch{}

    syncTenant();
    idle.hook();
    render();
  });

  /* ---------- Boot ---------- */
  setTheme('sunrise','medium');
  render();

  // “Users” tile — scroll to users table after navigate
  document.addEventListener('click', (e)=>{
    const card = e.target.closest('.card.clickable[data-go="settings"]');
    if (card){
      setTimeout(()=> $('#users-table')?.scrollIntoView({behavior:'smooth', block:'start'}), 120);
    }
  });

})();