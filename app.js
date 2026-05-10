/* Vantage Scout — app.js */
const C = window.VS;
let allLeads = [], selectedLead = null, charts = {}, pipelineRunning = false;
let activities = JSON.parse(localStorage.getItem('vs_activities') || '[]');

/* ── SUPABASE ── */
async function sbReq(path, opts = {}) {
  const r = await fetch(`${C.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: { 'apikey': C.SUPABASE_KEY, 'Authorization': `Bearer ${C.SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation', ...(opts.headers||{}) }
  });
  const t = await r.text(); if (!r.ok) throw new Error(t); return t ? JSON.parse(t) : [];
}

/* ── AI ── */
async function callGroq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST', headers:{'Authorization':`Bearer ${C.GROQ_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({model:C.GROQ_MODEL, max_tokens:280, temperature:0.8,
      messages:[{role:'user',content:prompt}]})
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).choices[0].message.content.trim();
}

async function callAnakin(prompt) {
  const r = await fetch(C.ANAKIN_URL, {
    method:'POST', headers:{'Authorization':`Bearer ${C.ANAKIN_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({model:'gpt-4o', max_tokens:350, temperature:0.7,
      messages:[{role:'user',content:prompt}]})
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).choices[0].message.content.trim();
}

async function genPitch(lead) {
  const p = loadProfile();
  const prov = document.getElementById('ai-provider')?.value || 'groq';
  const prompt = `Write a warm WhatsApp outreach message (55-75 words) for a web design agency.
Agency: ${p.name||'Vantage Scout'}, Services: ${p.services||'Web Design, SEO'}
Business: ${lead.name}, Location: Bengaluru, Rating: ${lead.rating||'highly rated'}
They have NO website. Compliment them, mention the opportunity, soft CTA. Sign as "${p.name||'Team Vantage Scout'}".`;
  return prov === 'anakin' ? await callAnakin(prompt) : await callGroq(prompt);
}

/* ── LOAD LEADS ── */
async function loadLeads() {
  let data = null;
  try { data = await fetch('/api/leads').then(r => r.json()); } catch(e) {}
  if (!data || !data.length) {
    try { data = await sbReq('/leads?select=*'); } catch(e) {}
  }
  if (!data || !data.length) {
    try { const r = await fetch('leads.json'); data = await r.json(); } catch(e) {}
  }
  // Guarantee every lead has a unique non-null id — this is the fix for wrong-lead bug
  allLeads = (data || []).map((l, i) => {
    if (l.id != null && l.id !== '') return l;
    const safe = String(l.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 18);
    return { ...l, id: `lid_${i}_${safe}` };
  });
}


async function saveLead(id, patch) {
  const idx = allLeads.findIndex(l=>l.id===id);
  if (idx>-1) Object.assign(allLeads[idx], patch);
  try { await sbReq(`/leads?id=eq.${id}`,{method:'PATCH',body:JSON.stringify(patch)}); } catch(e){}
}

/* ── PROFILE ── */
function loadProfile() { return JSON.parse(localStorage.getItem('vs_profile')||'{}'); }

function loadProfileUI() {
  const p = loadProfile();
  ['name','role','exp','loc','services','audience','portfolio','wa','uvp','target']
    .forEach(k=>{ const el=document.getElementById('p-'+k); if(el&&p[k]) el.value=p[k]; });
}

/* ── CHARTS ── */
function buildCharts() {
  const font={family:"'Inter'",size:11}, grid={color:'rgba(0,0,0,0.04)'};
  const lav='#9B87D8',lavL='#C4B5F4',grn='#43C59E',org='#F4A261';
  const sc={New:0,Pitched:0,Interested:0,Meeting:0,Closed:0};
  allLeads.forEach(l=>{ if(sc[l.status]!==undefined) sc[l.status]++; });
  const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toLocaleDateString('en-IN',{weekday:'short'});});

  charts.activity = new Chart(document.getElementById('chart-activity'),{
    type:'line', data:{labels:days,datasets:[
      {label:'Pitched',data:[0,1,0,1,2,0,sc.Pitched],borderColor:lav,backgroundColor:'rgba(155,135,216,.1)',fill:true,tension:0.4,pointRadius:4},
      {label:'Responses',data:[0,0,1,0,1,0,sc.Interested+sc.Meeting],borderColor:grn,backgroundColor:'rgba(67,197,158,.1)',fill:true,tension:0.4,pointRadius:4}
    ]}, options:{plugins:{legend:{labels:{font}}},scales:{x:{grid},y:{grid,beginAtZero:true,ticks:{font}}}}
  });

  charts.status = new Chart(document.getElementById('chart-status'),{
    type:'doughnut', data:{labels:Object.keys(sc),datasets:[{data:Object.values(sc),
      backgroundColor:[lavL,lav,org,'#64B5F6',grn],borderWidth:2,borderColor:'#fff'}]},
    options:{plugins:{legend:{position:'bottom',labels:{font,padding:10}}},cutout:'65%'}
  });

  charts.funnel = new Chart(document.getElementById('chart-funnel'),{
    type:'bar', data:{labels:['Leads','Pitched','Interested','Meeting','Closed'],
      datasets:[{data:[allLeads.length,sc.Pitched,sc.Interested,sc.Meeting,sc.Closed],
        backgroundColor:[lavL,lav,org,'#64B5F6',grn],borderRadius:6,borderSkipped:false}]},
    options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid,ticks:{font}},y:{grid:{display:false},ticks:{font}}}}
  });

  const revData = activities.filter(a=>a.type==='revenue').slice(-7);
  charts.revenue = new Chart(document.getElementById('chart-revenue'),{
    type:'line', data:{labels:revData.length?revData.map(a=>a.date):['No data'],
      datasets:[{label:'Revenue (₹)',data:revData.length?revData.map(a=>+a.val):[0],
        borderColor:org,backgroundColor:'rgba(244,162,97,.15)',fill:true,tension:0.4,pointRadius:5}]},
    options:{plugins:{legend:{labels:{font}}},scales:{x:{grid},y:{grid,beginAtZero:true,ticks:{font}}}}
  });
}

function killCharts() { Object.values(charts).forEach(c=>c?.destroy()); charts={}; }
function recharts() { killCharts(); buildCharts(); }

/* ── KPI ── */
function updateKPIs() {
  const total=allLeads.length, pitched=allLeads.filter(l=>l.pitch).length;
  const meetings=activities.filter(a=>a.type==='meeting').reduce((s,a)=>s+(+a.val),0);
  const revenue=activities.filter(a=>a.type==='revenue').reduce((s,a)=>s+(+a.val),0);
  document.getElementById('k-leads').textContent=total;
  document.getElementById('k-pitched').textContent=pitched;
  document.getElementById('k-meetings').textContent=meetings;
  document.getElementById('k-revenue').textContent=revenue?'₹'+revenue.toLocaleString('en-IN'):'₹0';
  document.getElementById('k-rate').textContent=total?((meetings/total)*100).toFixed(1)+'%':'0%';
}

/* ── RENDER LEADS ── */
function renderLeads(list) {
  const g=document.getElementById('leads-grid');
  if (!list.length){g.innerHTML='<p style="color:var(--muted);padding:40px 0">No leads yet. Run Auto-Scout to generate leads.</p>';return;}
  g.innerHTML=list.map(l=>cardHTML(l)).join('');
}

function cardHTML(l) {
  const hp  = l.pitch?.trim();
  const sid = String(l.id); // always string — prevents ReferenceError in onclick
  const badge = {New:'badge-new',Pitched:'badge-pitched',Interested:'badge-interested',Meeting:'badge-meeting',Closed:'badge-closed'}[l.status]||'badge-new';
  const stars = (()=>{const n=parseFloat(l.rating);return n?'★'.repeat(Math.round(n))+'☆'.repeat(5-Math.round(n)):'';})();
  const waPhone = formatPhone(l.phone);
  const waUrl   = (hp && waPhone) ? `https://web.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(l.pitch)}` : null;
  return `<div class="lead-card" id="lc-${sid}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div class="lead-name">${esc(l.name)}</div><span class="badge ${badge}">${l.status||'New'}</span>
    </div>
    <div class="lead-phone">📞 ${l.phone||'No phone'}</div>
    ${stars?`<div class="lead-rating"><span class="stars">${stars}</span> ${esc(l.rating)}</div>`:''}
    <div class="pitch-area${hp?'':' pitch-empty'}">${hp?esc(l.pitch):'No pitch yet — click Generate.'}</div>
    <div class="card-actions">
      <button class="btn btn-draft btn-sm" id="gb-${sid}" onclick="App.genOne('${sid}')">${hp?'↺ Regen':'✦ Generate'}</button>
      <select class="inp-sm" style="font-size:.72rem" onchange="App.changeStatus('${sid}',this.value)">
        ${['New','Pitched','Interested','Meeting','Closed'].map(s=>`<option${s===l.status?' selected':''}>${s}</option>`).join('')}
      </select>
      ${waUrl?`<a class="btn btn-wa btn-sm" href="${waUrl}" target="_blank">💬 WhatsApp</a>`:''}
      ${hp&&!waUrl?`<button class="btn btn-draft btn-sm" onclick="App.copyMsg('${sid}')">📋 Copy</button>`:''}
    </div>
  </div>`;
}


/* ── RENDER CONTACTS (fixed — no re-render after select) ── */
function renderContacts(list) {
  const el = document.getElementById('contact-list');
  el.innerHTML = (list || allLeads).map(l => `
    <div class="contact-item${selectedLead?.id===l.id?' active':''}" id="ci-${l.id}" onclick="App.selectContact('${String(l.id)}')">
      <div class="contact-avatar">${(l.name[0]||'?').toUpperCase()}</div>
      <div>
        <div class="contact-name">${esc(l.name)}</div>
        <div class="contact-sub">${l.phone||'No phone'} · <span class="badge ${l.pitch?'badge-pitched':'badge-new'}" style="font-size:.6rem">${l.pitch?'Pitched':'New'}</span></div>
      </div>
    </div>`).join('');
}

/* ── PIPELINE SSE ── */
let sseSource = null;

function startSSE() {
  if (sseSource) sseSource.close();
  const log = document.getElementById('pipeline-log');
  if (log) { log.style.display='block'; log.innerHTML=''; }
  sseSource = new EventSource('/api/events');
  sseSource.addEventListener('start', e => { logMsg('🚀 '+JSON.parse(e.data).message, log); setPipelineBtn(true); });
  sseSource.addEventListener('step',  e => { logMsg(JSON.parse(e.data).message, log); });
  sseSource.addEventListener('lead_ready', e => {
    const lead = JSON.parse(e.data).lead;
    // Give every lead a stable unique id — use real DB id or a name-based local id
    if (!lead.id) {
      lead.id = 'loc_' + lead.name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + Date.now();
    }
    const byId   = allLeads.findIndex(l => String(l.id) === String(lead.id));
    const byName = allLeads.findIndex(l => l.name === lead.name);
    const idx    = byId > -1 ? byId : byName;
    if (idx > -1) Object.assign(allLeads[idx], lead);
    else allLeads.unshift(lead);
    renderLeads(allLeads); renderContacts(); updateKPIs(); recharts();
    logMsg(`✅ Lead ready: ${lead.name}`, log);
    // Show clickable WhatsApp toast instead of auto-open (auto-open is blocked by browser)
    const phone = lead.phone?.replace(/\D/g, '');
    if (phone && phone.length >= 8 && lead.pitch) {
      const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(lead.pitch)}`;
      toast(`✅ ${lead.name} pitched! <a href="${url}" target="_blank" style="color:#2E9B78;font-weight:600">► Open WhatsApp</a>`, 'success');
    } else {
      toast(`New lead: ${lead.name}`, 'success');
    }
  });
  sseSource.addEventListener('done', e => {
    const d=JSON.parse(e.data);
    logMsg('🎉 '+d.message, log);
    setPipelineBtn(false); pipelineRunning=false;
    recharts(); updateKPIs();
    toast(d.message, 'success');
  });
  sseSource.addEventListener('error', e => {
    const d=JSON.parse(e.data||'{}');
    logMsg('❌ '+(d.message||'Pipeline error'), log);
    toast('Pipeline error', 'error'); setPipelineBtn(false); pipelineRunning=false;
  });
  sseSource.onerror = () => { if(!pipelineRunning) { sseSource?.close(); sseSource=null; } };
}

function logMsg(msg, el) {
  if (!el) return;
  el.innerHTML += `<div>${new Date().toLocaleTimeString('en-IN')} — ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function setPipelineBtn(running) {
  const btn=document.getElementById('pipeline-toggle');
  if (!btn) return;
  btn.textContent = running ? '⏹ STOP' : '⏵ START';
  btn.classList.toggle('running', running);
}

/* ── MAP ── */
function initMap() {
  if (window._mapInit) return; window._mapInit=true;
  const map=L.map('scout-map').setView([12.9716,77.5946],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(map);
  [{name:'Koramangala',ll:[12.9352,77.6245]},{name:'Indiranagar',ll:[12.9784,77.6408]},
   {name:'HSR Layout',ll:[12.9116,77.6389]},{name:'Jayanagar',ll:[12.9308,77.5839]},
   {name:'MG Road',ll:[12.9756,77.6099]},{name:'Whitefield',ll:[12.9698,77.7499]}]
  .forEach(z=>L.circleMarker(z.ll,{radius:14,color:'#9B87D8',fillColor:'#C4B5F4',fillOpacity:0.35,weight:2})
    .bindPopup(`<b>${z.name}</b>`).addTo(map));
}

/* ── ACTIVITY LOG ── */
function renderActivityLog() {
  const el=document.getElementById('activity-log'); if(!el) return;
  el.innerHTML=[...activities].reverse().slice(0,10).map(a=>`
    <div class="activity-item">
      <span>${a.type==='revenue'?'₹'+(+a.val).toLocaleString('en-IN'):a.type+': '+a.val}</span>
      <span>${a.note||''} · ${a.date}</span>
    </div>`).join('') || '<div style="color:var(--muted);font-size:.8rem;padding:8px">No activity yet.</div>';
}

/* ── UTILS ── */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function formatPhone(raw) {
  // Convert Indian phone numbers to WhatsApp-compatible format (91XXXXXXXXXX)
  // Returns empty string if NOT a mobile number (landline = not WhatsApp-compatible)
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('91') && p.length >= 12) p = p.substring(2); // strip +91
  if (p.startsWith('0')) p = p.substring(1);                     // strip leading 0
  // Must be 10 digits starting with 6/7/8/9 (Indian mobile)
  if (p.length !== 10 || !'6789'.includes(p[0])) return '';      // landline — skip
  return '91' + p; // WhatsApp format: 91XXXXXXXXXX
}

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = msg; // innerHTML so links inside toasts work
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ════════════════════════════════════════ APP OBJECT ════════════════════════════════════════ */
const App = {

  async init() {
    await loadLeads();
    this.renderAll();
    loadProfileUI();
    this.bindTabs();
    this.setupRealtime();
    toast('Vantage Scout ready ✓', 'success');
  },

  renderAll() {
    updateKPIs();
    renderLeads(allLeads);
    renderContacts();
    renderActivityLog();
    setTimeout(()=>{ killCharts(); buildCharts(); }, 150);
  },

  async refresh() {
    toast('Syncing…');
    await loadLeads();
    this.renderAll();
    toast('Synced ✓', 'success');
  },

  bindTabs() {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const tab = el.dataset.tab;
        document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
        document.getElementById('tab-'+tab)?.classList.add('active');
        const T={dashboard:'Dashboard',leads:'Leads',outreach:'Outreach & WhatsApp',scout:'Lead Scout',profile:'My Profile'};
        const S={dashboard:'Pipeline overview',leads:'Manage leads',outreach:'Craft & send messages',scout:'Find new leads',profile:'Agency settings'};
        document.getElementById('page-title').textContent=T[tab]||tab;
        document.getElementById('page-sub').textContent=S[tab]||'';
        if (tab==='scout') setTimeout(initMap,100);
        if (tab==='dashboard') setTimeout(()=>{killCharts();buildCharts();},100);
        if (tab==='outreach') renderContacts();
      });
    });
  },

  setupRealtime() {
    if (!window.supabase) return;
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
    sb.channel('leads').on('postgres_changes',{event:'*',schema:'public',table:'leads'}, payload => {
      if (payload.eventType==='INSERT') { if(!allLeads.find(l=>l.id===payload.new.id)) allLeads.unshift(payload.new); }
      else if (payload.eventType==='UPDATE') { const i=allLeads.findIndex(l=>l.id===payload.new.id); if(i>-1) allLeads[i]=payload.new; }
      else if (payload.eventType==='DELETE') allLeads=allLeads.filter(l=>l.id!==payload.old.id);
      renderLeads(allLeads); renderContacts(); updateKPIs(); recharts();
    }).subscribe();
  },

  /* ── PIPELINE ── */
  togglePipeline() {
    if (pipelineRunning) { sseSource?.close(); pipelineRunning=false; setPipelineBtn(false); toast('Pipeline stopped'); }
    else this.startPipeline();
  },

  async startPipeline() {
    if (pipelineRunning) { toast('Pipeline already running','warn'); return; }
    const niche = document.getElementById('s-niche')?.value||'Cafes';
    const city  = document.getElementById('s-area')?.value||'Bengaluru';
    const zone  = document.getElementById('s-zone')?.value||'';
    const count = document.getElementById('s-count')?.value||'5';
    startSSE();
    try {
      const res = await fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({niche,city,zone,count:+count})});
      if (res.status===409) { toast('Pipeline already running on server','warn'); return; }
      if (!res.ok) throw new Error(await res.text());
      pipelineRunning=true; setPipelineBtn(true);
      toast(`Pipeline started: ${count} ${niche} in ${zone||city}`,'success');
    } catch(e) { toast('Could not reach server. Is server.py running?','error'); sseSource?.close(); }
  },

  /* ── LEAD ACTIONS ── */
  filterLeads(val) {
    const q=(document.getElementById('lead-search')?.value||val||'').toLowerCase();
    const s=document.getElementById('lead-filter')?.value||'';
    renderLeads(allLeads.filter(l=>(!q||l.name.toLowerCase().includes(q)||(l.phone||'').includes(q))&&(!s||l.status===s)));
  },

  async genOne(id) {
    // Capture lead reference ONCE — don’t re-find after await (array may shift)
    const lead = allLeads.find(l => String(l.id) === String(id));
    if (!lead) { toast('Lead not found', 'error'); return; }
    const btn = document.getElementById('gb-' + id);
    if (btn) { btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
    try {
      const pitch = await genPitch(lead);
      // Mutate the captured ref directly so id never changes
      lead.pitch  = pitch;
      lead.status = 'Pitched';
      await saveLead(id, { pitch, status: 'Pitched' });
      // Re-render just this card (now includes the WhatsApp button)
      const card = document.getElementById('lc-' + id);
      if (card) card.outerHTML = cardHTML(lead);
      renderContacts(); updateKPIs(); recharts();
      toast(`Pitch ready for ${lead.name}`, 'success');
      // Auto-select this lead in Outreach tab so compose box is pre-filled
      this.selectContact(lead.id);
    } catch(e) {
      toast('AI error: ' + e.message, 'error');
      if (btn) { btn.innerHTML = '\u2726 Generate'; btn.disabled = false; }
    }
  },

  async generateAll() {
    const up=allLeads.filter(l=>!l.pitch);
    if (!up.length){toast('All leads already pitched!','success');return;}
    toast(`Generating ${up.length} pitches…`);
    for (const l of up) { await this.genOne(l.id); await sleep(400); }
    toast('All pitches generated!','success');
  },

  async changeStatus(id,status) { await saveLead(id,{status}); updateKPIs(); recharts(); },

  copyMsg(id) {
    const l=allLeads.find(x=>x.id===id);
    if(l?.pitch) navigator.clipboard.writeText(l.pitch).then(()=>toast('Copied!','success'));
  },

  /* ── CONTACT SELECTION (fixed) ── */
  selectContact(id) {
    selectedLead=allLeads.find(l=>l.id===id); if(!selectedLead) return;
    // Update active state without full re-render
    document.querySelectorAll('.contact-item').forEach(el=>el.classList.remove('active'));
    document.getElementById('ci-'+id)?.classList.add('active');
    document.getElementById('compose-name').textContent=selectedLead.name;
    document.getElementById('compose-phone').textContent=selectedLead.phone||'No phone';
    const hist=document.getElementById('message-history');
    hist.innerHTML=selectedLead.pitch
      ?`<div class="msg-bubble msg-sent">${esc(selectedLead.pitch)}<div class="msg-info">AI-drafted · ${selectedLead.status}</div></div>`
      :'<div class="history-empty">No messages yet. Click ✦ AI Draft to generate.</div>';
    if(selectedLead.pitch) document.getElementById('compose-msg').value=selectedLead.pitch;
  },

  filterContacts(q) {
    renderContacts(allLeads.filter(l=>l.name.toLowerCase().includes((q||'').toLowerCase())));
  },

  async generatePitchForSelected() {
    if (!selectedLead){toast('Select a contact first','warn');return;}
    const btn=document.querySelector('.compose-header .btn-draft');
    btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    try {
      const msg=await genPitch(selectedLead);
      document.getElementById('compose-msg').value=msg;
      await saveLead(selectedLead.id,{pitch:msg,status:'Pitched'});
      selectedLead.pitch=msg;
      const hist=document.getElementById('message-history');
      hist.innerHTML=`<div class="msg-bubble msg-sent">${esc(msg)}<div class="msg-info">Just drafted</div></div>`;
      renderContacts(); toast('AI message drafted ✓','success');
    } catch(e){toast('AI error: '+e.message,'error');}
    finally{btn.innerHTML='✦ AI Draft';btn.disabled=false;}
  },

  /* ── WHATSAPP ── */
  sendWhatsApp() {
    const msg=document.getElementById('compose-msg').value.trim();
    if (!msg){toast('Write a message first','warn');return;}
    if (!selectedLead){toast('Select a contact first','warn');return;}
    const phone=selectedLead.phone?.replace(/\D/g,'');
    if (!phone||phone.length<8){toast('No valid phone for this lead','warn');return;}
    const isAuto=document.getElementById('auto-send')?.checked;
    saveLead(selectedLead.id,{status:'Pitched'});
    if (isAuto) {
      const btn=document.getElementById('send-wa-btn');
      btn.innerHTML='<span class="spinner"></span> Sending'; btn.disabled=true;
      setTimeout(()=>{
        toast('Message auto-queued ✓','success');
        btn.innerHTML='💬 Send Message'; btn.disabled=false;
        updateKPIs(); recharts();
      },1500);
    } else {
      window.open(`https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`,'_blank');
      toast('WhatsApp Web opened — hit Send ✓','success');
    }
  },

  clearCompose(){document.getElementById('compose-msg').value='';},

  useTemplate(type) {
    const n=loadProfile().name||'Vantage Scout';
    const T={
      intro:`Hi! I came across your business on Google Maps and love your reviews! I'm ${n}, a web design agency in Bengaluru. I noticed you don't have a website yet — we'd love to help. Quick chat?`,
      followup:`Hi! Following up on my earlier message. We're offering a special package for local Bengaluru businesses this month. Would love to show you what we can create. Interested?`,
      value:`A professional website can 3x your customer inquiries. As a highly-rated business, you deserve a digital presence that matches your quality. We build stunning, affordable sites. Free consultation?`,
      meeting:`Hi! Would you be open to a 15-min call this week? I'd love to share website ideas for your business — completely free, no obligation. When works?`
    };
    document.getElementById('compose-msg').value=T[type]||'';
  },

  /* ── ACTIVITY LOG ── */
  logActivity() {
    const type=document.getElementById('log-type').value;
    const val=document.getElementById('log-val').value;
    const note=document.getElementById('log-note').value;
    if (!val){toast('Enter a value','warn');return;}
    activities.push({type,val:+val,note,date:new Date().toLocaleDateString('en-IN')});
    localStorage.setItem('vs_activities',JSON.stringify(activities));
    renderActivityLog(); updateKPIs(); recharts();
    document.getElementById('log-val').value='';
    document.getElementById('log-note').value='';
    toast('Logged ✓','success');
  },

  /* ── SCOUT ── */
  openGoogleMaps() {
    const n=document.getElementById('s-niche')?.value||'Cafes';
    const a=document.getElementById('s-area')?.value||'Bengaluru';
    const z=document.getElementById('s-zone')?.value||'';
    window.open(`https://www.google.com/maps/search/${encodeURIComponent(n+' in '+(z?z+', ':'')+a)}`,'_blank');
  },

  /* ── LEADS CRUD ── */
  showAddLead(){document.getElementById('modal-lead').style.display='grid';},
  closeModal(){document.getElementById('modal-lead').style.display='none';},

  async saveLead() {
    const name=document.getElementById('m-name').value.trim();
    const phone=document.getElementById('m-phone').value.trim();
    const rating=document.getElementById('m-rating').value.trim();
    const status=document.getElementById('m-status').value;
    if (!name){toast('Name required','warn');return;}
    const lead={name,phone:phone||'N/A',rating,status};
    try{const s=await sbReq('/leads',{method:'POST',body:JSON.stringify([lead])});allLeads=[...allLeads,...(Array.isArray(s)?s:[{...lead,id:Date.now()}])];}
    catch{allLeads.push({...lead,id:Date.now()});}
    this.closeModal(); renderLeads(allLeads); renderContacts(); updateKPIs(); recharts();
    toast(`${name} added ✓`,'success');
  },

  async addManualLead() {
    const name=document.getElementById('ml-name')?.value.trim();
    const phone=document.getElementById('ml-phone')?.value.trim();
    const rating=document.getElementById('ml-rating')?.value.trim();
    const status=document.getElementById('ml-status')?.value||'New';
    if (!name){toast('Business name required','warn');return;}
    const lead={name,phone:phone||'N/A',rating,status};
    try{const s=await sbReq('/leads',{method:'POST',body:JSON.stringify([lead])});allLeads=[...allLeads,...(Array.isArray(s)?s:[{...lead,id:Date.now()}])];}
    catch{allLeads.push({...lead,id:Date.now()});}
    renderLeads(allLeads); renderContacts(); updateKPIs(); recharts();
    ['ml-name','ml-phone','ml-rating'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    toast(`${name} added ✓`,'success');
  },

  /* ── PROFILE ── */
  saveProfile() {
    const p={};
    ['name','role','exp','loc','services','audience','portfolio','wa','uvp','target']
      .forEach(k=>{p[k]=document.getElementById('p-'+k)?.value||'';});
    localStorage.setItem('vs_profile',JSON.stringify(p));
    toast('Profile saved ✓','success');
  }
};

document.addEventListener('DOMContentLoaded', ()=>App.init());

