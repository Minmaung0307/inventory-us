/* ==========================================================
   Inventory — Firebase RTDB SPA
   - Forgot/Signup buttons visible & wired
   - Admin Role Manager (change user levels)
   - Each user writes to registry so admins can see them
   ========================================================== */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const USD = x => `$${Number(x||0).toFixed(2)}`;
function notify(msg,type='ok'){ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>{ n.className='notification'; },2200); }

const firebaseConfig = window.__FIREBASE_CONFIG || null;
if (!firebaseConfig) alert('Missing Firebase config in index.html');
if (firebase.apps && firebase.apps.length===0) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.database();

/* ---------- State ---------- */
const KEYS = ['inventory','products','posts','tasks','cogs','users','_theme2'];
let state = {
  inventory: [], products: [], posts: [], tasks: [], cogs: [], users: [],
  _theme2: { mode:'sunset', size:'medium' },
  registry: {},        // /registry/users
  rolesAll: {}         // /userRoles (admin view)
};
let session = null; // { uid, email, role }
const ROLES = ['user','associate','manager','admin'];
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

function canAdd()    { return ['associate','manager','admin'].includes(session?.role||'user'); }
function canEdit()   { return ['manager','admin'].includes(session?.role||'user'); }
function canDelete() { return ['admin'].includes(session?.role||'user'); }

/* ---------- Refs & kv ---------- */
const tenantRef = (key)=> db.ref(`tenants/${auth.currentUser?.uid}/kv/${key}`);
async function saveKV(key, val){
  if (!auth.currentUser) return notify('Sign in first','warn');
  try{
    await tenantRef(key).set({ key, val, updatedAt: firebase.database.ServerValue.TIMESTAMP });
  }catch(e){ console.warn('[save] '+key, e); notify(e?.message||'Save failed','danger'); }
}
function subscribeKV(key){ tenantRef(key).on('value', snap=>{ const d=snap.val(); if(d && 'val' in d){ state[key]=d.val; if(key==='_theme2') applyTheme(d.val); if($('#root')) renderApp(); } }); }

/* ---------- Roles & Registry ---------- */
async function ensureRoleRecord(){
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    const snap = await db.ref(`userRoles/${uid}`).get();
    if (!snap.exists()) {
      // First-time self-claim — allowed by rules only if value === "user"
      await db.ref(`userRoles/${uid}`).set('user');
    }
  } catch (e) {
    // Never block sign-in if rules are still propagating; fetchRole() will default
    console.warn('[ensureRoleRecord] skipped:', e?.message || e);
  }
}
async function fetchRole(){
  const uid = auth.currentUser?.uid;
  if (!uid) { session.role = 'user'; return; }
  try{
    const s = await db.ref(`userRoles/${uid}`).get();
    session.role = s.exists() ? s.val() : 'user';
  }catch{
    session.role = 'user';
  }
}
function subscribeRegistry(){
  db.ref('registry/users').on('value', snap=>{ state.registry = snap.val()||{}; if($('#root')) renderApp(); });
}
function subscribeAllRoles(){
  db.ref('userRoles').on('value', snap=>{ state.rolesAll = snap.val()||{}; if($('#root')) renderApp(); });
}

/* ---------- Auth ---------- */
auth.onAuthStateChanged(async (user)=>{
  if (!user){ session=null; renderLogin(); return; }

  session = { uid:user.uid, email:(user.email||'').toLowerCase(), role:'user' };

  try { await ensureRoleRecord(); } catch {}
  await fetchRole();

  // Subscribe to tenant KV
  ['inventory','products','posts','tasks','cogs','users','_theme2'].forEach(subscribeKV);

  // Everyone can see registry; admins also see all roles
  subscribeRegistry();
  if (session.role === 'admin') subscribeAllRoles();

  // Seed initial data into the user's own KV if empty (only needs add permission)
  if (['associate','manager','admin'].includes(session.role)) {
    const initIfEmpty = async (key, fallback)=> {
      const snap = await db.ref(`tenants/${user.uid}/kv/${key}`).get();
      if (!snap.exists() || !('val' in (snap.val()||{}))) await saveKV(key, fallback);
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

/* ---------- Idle auto-logout ---------- */
const AUTO_LOGOUT_MS = 20*60*1000;
let __lastActivity = Date.now();
['click','keydown','mousemove','scroll','touchstart','visibilitychange'].forEach(evt=>document.addEventListener(evt,()=>__lastActivity=Date.now(),{passive:true}));
setInterval(()=>{ if(auth.currentUser && (Date.now()-__lastActivity)>=AUTO_LOGOUT_MS) doLogout(); }, 30*1000);

/* ---------- Router ---------- */
let currentRoute='dashboard';
function go(r){ currentRoute=r; renderApp(); }

/* ---------- UI: Sidebar/Topbar/Search (unchanged) ---------- */
function renderSidebar(active='dashboard'){
  const links=[
    { route:'dashboard', icon:'ri-dashboard-line',           label:'Dashboard' },
    { route:'inventory', icon:'ri-archive-2-line',           label:'Inventory' },
    { route:'products',  icon:'ri-store-2-line',             label:'Products' },
    { route:'cogs',      icon:'ri-money-dollar-circle-line', label:'COGS' },
    { route:'tasks',     icon:'ri-list-check-2',             label:'Tasks' },
    { route:'settings',  icon:'ri-settings-3-line',          label:'Settings' }
  ];
  const pages=[
    { route:'about',   icon:'ri-information-line',        label:'About' },
    { route:'policy',  icon:'ri-shield-check-line',       label:'Policy' },
    { route:'license', icon:'ri-copyright-line',          label:'License' },
    { route:'setup',   icon:'ri-guide-line',              label:'Setup Guide' },
    { route:'contact', icon:'ri-customer-service-2-line', label:'Contact' },
    { route:'guide',   icon:'ri-book-open-line',          label:'User Guide' },
  ];
  return `
  <aside class="sidebar" id="sidebar">
    <div class="brand"><div class="logo">📦</div><div class="title">Inventory</div></div>
    <div class="search-wrap">
      <input id="globalSearch" placeholder="Search…" autocomplete="off" />
      <div id="searchResults" class="search-results"></div>
    </div>
    <h6 class="menu-caption">Menu</h6>
    <div class="nav">${links.map(l=>`<div class="item ${active===l.route?'active':''}" data-route="${l.route}"><i class="${l.icon}"></i><span>${l.label}</span></div>`).join('')}</div>
    <h6 class="links-caption">Links</h6>
    <div class="links">${pages.map(p=>`<div class="item" data-route="${p.route}"><i class="${p.icon}"></i><span>${p.label}</span></div>`).join('')}</div>
    <h6 class="social-caption">Social</h6>
    <div class="socials-row">
      <a href="https://tiktok.com"  target="_blank" rel="noopener" title="TikTok"><i class="ri-tiktok-fill"></i></a>
      <a href="https://twitter.com" target="_blank" rel="noopener" title="X/Twitter"><i class="ri-twitter-x-line"></i></a>
      <a href="https://youtube.com" target="_blank" rel="noopener" title="YouTube"><i class="ri-youtube-fill"></i></a>
      <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram"><i class="ri-instagram-line"></i></a>
    </div>
  </aside>`;
}
function renderTopbar(){
  return `<div class="topbar">
    <div class="left"><div class="burger" id="burger"><i class="ri-menu-line"></i></div><div><strong>${(currentRoute||'dashboard').replace(/^\w/,c=>c.toUpperCase())}</strong></div></div>
    <div class="right"><span style="color:var(--muted);font-size:.85rem">${session?.email||''} &nbsp;•&nbsp; <b>${(session?.role||'user').toUpperCase()}</b></span><button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button></div>
  </div><div class="backdrop" id="backdrop"></div>`;
}

/* ---------- Search helpers (unchanged) ---------- */
function buildSearchIndex(){
  const posts=state.posts||[], inv=state.inventory||[], prods=state.products||[], cogs=state.cogs||[], users=state.users||[];
  const pages=[{id:'about',label:'About',section:'Pages',route:'about'},{id:'policy',label:'Policy',section:'Pages',route:'policy'},{id:'license',label:'License',section:'Pages',route:'license'},{id:'setup',label:'Setup Guide',section:'Pages',route:'setup'},{id:'contact',label:'Contact',section:'Pages',route:'contact'},{id:'guide',label:'User Guide',section:'Pages',route:'guide'}];
  const ix=[]; posts.forEach(p=>ix.push({id:p.id,label:p.title,section:'Posts',route:'dashboard',text:`${p.title} ${p.body}`}));
  inv.forEach(i=>ix.push({id:i.id,label:i.name,section:'Inventory',route:'inventory',text:`${i.name} ${i.code} ${i.type}`}));
  prods.forEach(p=>ix.push({id:p.id,label:p.name,section:'Products',route:'products',text:`${p.name} ${p.barcode} ${p.type} ${p.ingredients}`}));
  cogs.forEach(r=>ix.push({id:r.id,label:r.date,section:'COGS',route:'cogs',text:`${r.date} ${r.grossIncome} ${r.produceCost} ${r.itemCost} ${r.freight} ${r.other}`}));
  users.forEach(u=>ix.push({id:u.email,label:u.name,section:'Users',route:'settings',text:`${u.name} ${u.email} ${u.role}`}));
  pages.forEach(p=>ix.push(p)); return ix;
}
function searchAll(index,q){
  const norm=s=>(s||'').toLowerCase(); const tokens=norm(q).split(/\s+/).filter(Boolean);
  return index.map(item=>{ const label=norm(item.label), text=norm(item.text||''); let hits=0; const ok=tokens.every(t=>{const hit=label.includes(t)||text.includes(t); if(hit) hits++; return hit;}); const score=ok?(hits*3+(label.includes(tokens[0]||'')?2:0)):0; return {item,score}; })
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
}
function hookSidebarInteractions(){
  const input=$('#globalSearch'), results=$('#searchResults'); if(!input||!results) return;
  const openResultsPage=q=>{ window.__searchQ=q; if(currentRoute!=='search') go('search'); else renderApp(); };
  let timer;
  input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ const q=input.value.trim(); if(q){ openResultsPage(q); results.classList.remove('active'); input.blur(); closeSidebar(); } } });
  input.addEventListener('input', ()=>{ clearTimeout(timer); const q=input.value.trim().toLowerCase(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
    timer=setTimeout(()=>{ const out=searchAll(buildSearchIndex(),q).slice(0,12);
      if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
      results.innerHTML=out.map(r=>`<div class="result" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong><span style="color:var(--muted)"> — ${r.section||''}</span></div>`).join('');
      results.classList.add('active'); results.querySelectorAll('.result').forEach(row=>{ row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id')||''; const label=row.textContent.trim(); openResultsPage(label); results.classList.remove('active'); input.value=''; closeSidebar(); if(id) setTimeout(()=>scrollToRow(id),80); }; });
    },120);
  });
  document.addEventListener('click',e=>{ if(!results.contains(e.target) && e.target!==input){ results.classList.remove('active'); }});
}
function closeSidebar(){ $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('active'); document.body.classList.remove('sidebar-open'); }

/* ---------- Views (same as previous answer, trimmed where not relevant) ---------- */
/* Dashboard/Inventory/Products/COGS/Tasks views are identical to the prior version you have,
   so I’m only replacing Settings and Login below to fix your reported issues. 
   (If you need the other pages pasted again verbatim, say the word.) */

/* ====== SETTINGS (with Role Manager) ====== */
function viewSettings(){
  const theme=state._theme2 || {mode:'sunset', size:'medium'};
  const users=state.users||[];
  const isAdmin = session?.role==='admin';

  // Role Manager list from registry
  const regEntries = Object.entries(state.registry||{}).sort((a,b)=> (a[1].email||'').localeCompare(b[1].email||''));
  return `
    <div class="grid">
      <div class="card"><div class="card-body">
        <h3 style="margin-top:0">Theme</h3>
        <div class="grid cols-2">
          <div><label style="font-size:.85rem;color:var(--muted)">Mode</label>
            <select id="theme-mode" class="input">${THEME_MODES.map(m=>`<option value="${m.key}" ${theme.mode===m.key?'selected':''}>${m.name}</option>`).join('')}</select>
          </div>
          <div><label style="font-size:.85rem;color:var(--muted)">Font Size</label>
            <select id="theme-size" class="input">${THEME_SIZES.map(s=>`<option value="${s.key}" ${theme.size===s.key?'selected':''}>${s.label}</option>`).join('')}</select>
          </div>
        </div>
        <p style="color:var(--muted);font-size:.85rem;margin-top:8px">Changes apply instantly and are saved to your account.</p>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">Users (Tenant Roster)</h3>
          ${canAdd()? `<button class="btn" id="addUser"><i class="ri-add-line"></i> Add User</button>`:''}
        </div>
        <table class="table" data-section="users">
          <thead><tr><th>Name</th><th>Email</th><th>App Role (display)</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u=>`<tr id="${u.email}"><td>${u.name}</td><td>${u.email}</td><td>${u.role||'user'}</td>
            <td>${canEdit()? `<button class="btn ghost" data-edit="${u.email}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                ${canDelete()? `<button class="btn danger" data-del="${u.email}" title="Delete"><i class="ri-delete-bin-line"></i></button>`:''}
            </td></tr>`).join('')}
          </tbody>
        </table>
        <p style="color:var(--muted);font-size:.85rem;margin-top:6px">Note: Permission enforcement uses your authenticated role at <code>/userRoles/{uid}</code>.</p>
      </div></div>

      ${isAdmin ? `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 10px 0">Role Manager (Admin)</h3>
        <div class="table-wrap">
          <table class="table" id="role-table">
            <thead><tr><th>Email</th><th>UID</th><th>Current</th><th>Change To</th><th></th></tr></thead>
            <tbody>
              ${regEntries.map(([uid,info])=>{
                const cur = (state.rolesAll||{})[uid] || 'user';
                return `<tr data-uid="${uid}">
                  <td>${info.email||''}</td>
                  <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${uid}</td>
                  <td>${cur}</td>
                  <td>
                    <select class="input role-select">
                      ${ROLES.map(r=>`<option value="${r}" ${r===cur?'selected':''}>${r}</option>`).join('')}
                    </select>
                  </td>
                  <td><button class="btn ok role-save"><i class="ri-save-3-line"></i> Save</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p style="color:var(--muted);font-size:.85rem;margin-top:6px">This writes to <code>/userRoles/{uid}</code>. Admins only.</p>
      </div></div>` : ``}
    </div>`;
}
function wireSettings(){
  // Theme
  const mode=$('#theme-mode'), size=$('#theme-size');
  const applyNow=async ()=>{ const t={mode:mode.value,size:size.value}; applyTheme(t); await saveKV('_theme2',t); notify('Theme saved'); };
  mode?.addEventListener('change', applyNow); size?.addEventListener('change', applyNow);

  // Tenant roster (kv/users)
  wireUsers();

  // Role Manager
  if (session?.role==='admin'){
    const table=$('#role-table');
    table?.addEventListener('click', async e=>{
      const btn=e.target.closest('.role-save'); if(!btn) return;
      const tr=btn.closest('tr'); const uid=tr?.getAttribute('data-uid'); const sel=tr?.querySelector('.role-select'); if(!uid||!sel) return;
      const role=sel.value;
      try{
        await db.ref(`userRoles/${uid}`).set(role);
        notify('Role updated');
      }catch(err){ notify(err?.message||'Failed to update role','danger'); }
    });
  }
}
function wireUsers(){
  const addBtn=$('#addUser'); const table=document.querySelector('[data-section="users"]');
  addBtn?.addEventListener('click', ()=>{ if(!canAdd()) return notify('No permission','warn'); openModal('m-user'); $('#user-name').value=''; $('#user-email').value=''; $('#user-username').value=''; const sel=$('#user-role'); sel.innerHTML=ROLES.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value='user'; });
  const saveBtn=$('#save-user');
  if (saveBtn && !saveBtn.__wired){
    saveBtn.__wired=true;
    saveBtn.addEventListener('click', async ()=>{ if(!canAdd()) return notify('No permission','warn');
      const users=[...(state.users||[])];
      const email=($('#user-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Email required','warn');
      const roleSel=($('#user-role')?.value||'user'); const obj={ name:($('#user-name')?.value||email.split('@')[0]).trim(), email, username:($('#user-username')?.value||email.split('@')[0]).trim(), role:roleSel };
      const i=users.findIndex(x=>(x.email||'').toLowerCase()===email); if(i>=0){ if(!canEdit()) return notify('No permission','warn'); users[i]=obj; } else users.push(obj);
      await saveKV('users', users); closeModal('m-user'); notify('Saved'); renderApp();
    });
  }
  table?.addEventListener('click', async e=>{
    const btn=e.target.closest('button'); if(!btn) return; const email=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!email) return;
    if(btn.hasAttribute('data-edit')){ if(!canEdit()) return notify('No permission','warn'); const u=(state.users||[]).find(x=>x.email===email); if(!u) return;
      openModal('m-user'); $('#user-name').value=u.name; $('#user-email').value=u.email; $('#user-username').value=u.username; const sel=$('#user-role'); sel.innerHTML=ROLES.map(r=>`<option value="${r}">${r[0].toUpperCase()+r.slice(1)}</option>`).join(''); sel.value=u.role||'user';
    }else{ if(!canDelete()) return notify('No permission','warn'); const next=(state.users||[]).filter(x=>x.email!==email); await saveKV('users', next); notify('Deleted'); renderApp(); }
  });
}

/* ====== LOGIN (Forgot + Signup clearly visible) ====== */
function renderLogin(){
  const root=$('#root');
  root.innerHTML=`
  <div class="login">
    <div class="card" style="max-width:460px;margin:40px auto">
      <div class="card-body">
        <div class="brand" style="justify-content:center"><div class="logo">📦</div><div class="title">Inventory</div></div>
        <p class="login-note" style="text-align:center;color:var(--muted)">Sign in to continue</p>
        <div class="grid">
          <input id="li-email" class="input" type="email" placeholder="Email" autocomplete="username"/>
          <input id="li-pass"  class="input" type="password" placeholder="Password" autocomplete="current-password"/>
          <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          <div class="actions">
            <button id="link-forgot"   class="btn ghost"><i class="ri-key-2-line"></i> Forgot password</button>
            <button id="link-register" class="btn secondary"><i class="ri-user-add-line"></i> Sign up</button>
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
    const email=($('#li-email')?.value||'').trim().toLowerCase(); const pass=$('#li-pass')?.value||'';
    if(!email||!pass) return notify('Enter email & password','warn');
    try{ await auth.signInWithEmailAndPassword(email,pass); notify('Welcome!'); }catch(e){ notify(e?.message||'Login failed','danger'); }
  }
  async function doSignup(){
    const name=($('#su-name')?.value||'').trim(); const email=($('#su-email')?.value||'').trim().toLowerCase();
    const pass=$('#su-pass')?.value||''; const pass2=$('#su-pass2')?.value||'';
    if(!email||!pass) return notify('Email and password required','warn');
    if(pass!==pass2)  return notify('Passwords do not match','warn');
    try{
      await auth.createUserWithEmailAndPassword(email,pass);
      try{ await auth.currentUser.updateProfile({displayName: name || email.split('@')[0]}); }catch{}
      // Write self to registry for admins to see
      const uid=auth.currentUser.uid;
      await db.ref(`registry/users/${uid}`).set({ email, name: name || email.split('@')[0], createdAt: firebase.database.ServerValue.TIMESTAMP });
      await ensureRoleRecord(); // default 'user'
      notify('Account created — you are signed in'); closeAuth();
    }catch(e){ notify(e?.message||'Signup failed','danger'); }
  }
  async function doReset(){
    const email=($('#fp-email')?.value||'').trim().toLowerCase(); if(!email) return notify('Enter your email','warn');
    try{ await auth.sendPasswordResetEmail(email); notify('Reset email sent'); closeAuth(); }catch(e){ notify(e?.message||'Reset failed','danger'); }
  }

  $('#btnLogin')?.addEventListener('click', doSignIn);
  $('#li-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doSignIn(); });
  $('#link-register')?.addEventListener('click', e=>{ e.preventDefault(); openAuth('#m-signup'); $('#su-email').value=$('#li-email')?.value||''; });
  $('#link-forgot')?.addEventListener('click', e=>{ e.preventDefault(); openAuth('#m-reset'); $('#fp-email').value=$('#li-email')?.value||''; });
  $('#cl-signup')?.addEventListener('click', e=>{ e.preventDefault(); closeAuth(); });
  $('#cl-reset')?.addEventListener('click', e=>{ e.preventDefault(); closeAuth(); });
  $('#btnSignupDo')?.addEventListener('click', doSignup);
  $('#btnResetDo')?.addEventListener('click', doReset);
}

/* ====== Existing pages from previous build (kept) ====== */
/* For brevity, paste back your working Dashboard/Inventory/Products/COGS/Tasks + modals exactly
   as in my last message. (They are unchanged and already meet your specs.)                      */

/* ====== Shell / Render (unchanged) ====== */
function renderTopShell(content){
  return `<div class="app">
    ${renderSidebar(currentRoute)}
    <div>${renderTopbar()}<div class="main" id="main">${content}</div></div>
  </div>`;
}

/* Include your prior implementations of:
   - viewDashboard(), wireDashboard()
   - viewInventory(), wireInventory()
   - viewProducts(),  wireProducts()
   - viewCOGS(),      wireCOGS()
   - viewTasks(),     wireTasks()
   - Modals + ensureGlobalModals()
   (They remain identical to the last drop; no regressions.)                                    */

/* Boot helpers copied from the last drop */
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

/* ========= Modal system safety shims (place before renderApp is ever called) ========= */
(function () {
  // Create a minimal modals root so calls don't explode even if you don't use modals anymore
  if (typeof window.ensureGlobalModals !== 'function') {
    window.ensureGlobalModals = function () {
      if (document.getElementById('__modals')) return;
      const wrap = document.createElement('div');
      wrap.id = '__modals';
      // Keep it empty; pages that actually need modals can append into this later.
      // Having the node present prevents null refs.
      wrap.style.display = 'contents';
      document.body.appendChild(wrap);
    };
  }

  // Defensive fallbacks so existing code paths won't throw
  if (typeof window.openModal !== 'function') {
    window.openModal = function (id) {
      const m = document.getElementById(id);
      if (!m) return;
      m.classList.add('active');
      const bd = document.getElementById('mb-' + (id.split('-')[1] || ''));
      if (bd) bd.classList.add('active');
      document.body.classList.add('modal-open');
    };
  }

  if (typeof window.closeModal !== 'function') {
    window.closeModal = function (id) {
      const m = document.getElementById(id);
      if (m) m.classList.remove('active');
      const bd = document.getElementById('mb-' + (id.split('-')[1] || ''));
      if (bd) bd.classList.remove('active');
      document.body.classList.remove('modal-open');
    };
  }
})();

function renderApp(){
  const root=$('#root'); if(!root) return;
  if(!auth.currentUser){ renderLogin(); return; }
  ensureGlobalModals(); // from previous file
  root.innerHTML = renderTopShell(safeView(currentRoute));
  $('#btnLogout')?.addEventListener('click', doLogout);
  $('#burger')?.addEventListener('click', ()=>{ $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('active'); document.body.classList.add('sidebar-open'); });
  $('#backdrop')?.addEventListener('click', closeSidebar);
  document.querySelectorAll('.sidebar .item[data-route]').forEach(el=> el.addEventListener('click', ()=>{ const r=el.getAttribute('data-route'); go(r); closeSidebar(); }));
  document.querySelectorAll('[data-go]').forEach(el=> el.addEventListener('click', ()=>{ const r=el.getAttribute('data-go'); const id=el.getAttribute('data-id'); if(r){ go(r); if(id) setTimeout(()=>scrollToRow(id),80);} }));
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
async function doLogout(){ try{ await auth.signOut(); }catch{} session=null; notify('Signed out'); renderLogin(); }
function scrollToRow(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

(function boot(){ applyTheme(state._theme2); renderLogin(); })();