// Quarantine Prototype App (client-side only)
// Data model: patients in localStorage under key 'q_app_patients'
const LS_KEY = 'q_app_patients_v1';
const TEMP_THRESHOLD = 37.5; // below this considered fever-free for discharge logic

// Helper: today date string
function today(){ const d=new Date(); return d.toISOString().slice(0,10); }

// Load & save
function loadPatients(){ 
  const raw = localStorage.getItem(LS_KEY); 
  if(!raw) return []; 
  return JSON.parse(raw); 
}
function savePatients(p){ 
  localStorage.setItem(LS_KEY, JSON.stringify(p)); 
}

// UI helpers
function el(id){ return document.getElementById(id); }
function show(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  el(view).classList.remove('hidden');
  renderAll();
}

// Initial wiring
document.addEventListener('DOMContentLoaded', ()=>{

  // navigation
  el('nav-dashboard').onclick = ()=>show('dashboard');
  el('nav-nurse').onclick = ()=>show('nurse');
  el('nav-doctor').onclick = ()=>show('doctor');
  el('nav-admin').onclick = ()=>show('admin');
  el('roleSwitch').onchange = (e)=> show(e.target.value);

  // controls
  el('resetAll').onclick = ()=>{
    if(confirm('Clear all stored data?')){
      localStorage.removeItem(LS_KEY);
      renderAll();
    }
  };
  el('searchInput').oninput = renderPatientTable;

  // nurse / doctor / admin
  el('recordTemp').onclick = recordTemperature;
  el('markVisit').onclick = markDoctorVisit;
  el('markDischarge').onclick = adminDischarge;
  el('markDeath').onclick = adminMarkDeath;

  // export / import
  el('exportBtn').onclick = ()=>{
    const data = localStorage.getItem(LS_KEY) || '[]';
    const blob = new Blob([data],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download='quarantine_data.json';
    a.click();
  };

  el('importBtn').onclick = ()=>{
    const f = el('importFile').files[0];
    if(!f){ alert('Choose a JSON file'); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        JSON.parse(reader.result);
        localStorage.setItem(LS_KEY, reader.result);
        renderAll();
        alert('Imported');
      }catch(e){ alert('Invalid JSON'); }
    };
    reader.readAsText(f);
  };

  // Add Patient panel wiring
  el('addPatientBtn').onclick = ()=>{
    el('addPatientPanel').classList.remove('hidden');
    el('addPatientMsg').textContent='';
  };
  el('closeAddPanel').onclick = ()=>{
    el('addPatientPanel').classList.add('hidden');
    el('addPatientMsg').textContent='';
  };
  el('saveNewPatient').onclick = addNewPatient;

  // START EMPTY — DO NOT SEED ANY PATIENTS
  renderAll();
});

// ----------------------------
// Rendering
// ----------------------------
function renderAll(){
  renderPatientTable();
  renderSelects();
  renderKPIs();
  renderTodos();
  renderPatientDetail();
}

function renderPatientTable(){
  const tbl = el('patientTable').querySelector('tbody');
  tbl.innerHTML = '';

  const q = el('searchInput').value.toLowerCase();
  const patients = loadPatients();

  // Sort by bed
  patients.sort((a,b)=> (a.bed||0) - (b.bed||0));

  patients.forEach(p=>{
    if(q && !( 
      (p.name||'').toLowerCase().includes(q) || 
      String(p.bed||'').includes(q) || 
      (p.id||'').toLowerCase().includes(q) 
    )) return;

    const tr = document.createElement('tr');
    const ff = feverFreeDays(p);
    const status = computeStatus(p);

    tr.innerHTML = `
      <td>${p.bed}</td>
      <td>${p.name} <div class="muted small">${p.id}</div></td>
      <td>${p.age}</td>
      <td><span class="status ${status.cls}">${status.label}</span></td>
      <td>${ff}</td>
      <td>
        <button onclick="viewDetail('${p.id}')">View</button>
        <button onclick="prefillNurse('${p.id}')">Record Temp</button>
        <button onclick="prefillDoctor('${p.id}')">Mark Visit</button>
      </td>`;
    tbl.appendChild(tr);
  });

  renderKPIs();
}

// fever-free streak
function feverFreeDays(p){
  if(!p.records || p.records.length===0) return 0;

  const map = {};
  p.records.forEach(r=>{
    map[r.date] = map[r.date]===undefined ? r.temp : Math.min(map[r.date], r.temp);
  });

  const dates = Object.keys(map).sort((a,b)=>b.localeCompare(a));
  let streak=0;

  for(const d of dates){
    if(map[d] < TEMP_THRESHOLD) streak++;
    else break;
  }

  return streak;
}

// status computation
function computeStatus(p){
  if(p.discharged) return {label:'Discharged', cls:'green'};
  if(p.deceased) return {label:'Deceased', cls:'red'};

  const d = today();
  const hasTempToday = (p.records||[]).some(r=>r.date===d);
  const hasVisitToday = (p.visits||[]).some(v=>v.date===d);

  if(!hasTempToday) return {label:'Needs Temp', cls:'yellow'};
  if(!hasVisitToday) return {label:'Needs Doctor Visit', cls:'blue'};

  if(feverFreeDays(p) >= 3) return {label:'Eligible Discharge', cls:'green'};
  return {label:'Stable Today', cls:'green'};
}

// -----------------------
// Nurse actions
// -----------------------
function prefillNurse(id){
  show('nurse');
  const patients = loadPatients();
  const sel = el('nursePatient');
  sel.innerHTML = '';

  patients.forEach(p=>{
    sel.appendChild(new Option(`${p.name} | Bed ${p.bed}`, p.id));
  });

  sel.value = id || '';
}

function recordTemperature(){
  const pid = el('nursePatient').value;
  const tempVal = parseFloat(el('tempInput').value);

  if(!pid){ el('nurseMsg').textContent='Choose a patient'; return; }
  if(!tempVal){ el('nurseMsg').textContent='Enter a valid temperature'; return; }

  const patients = loadPatients();
  const p = patients.find(x=>x.id===pid);

  const dt = today();
  if(p.records.some(r=>r.date===dt)){
    el('nurseMsg').textContent='Temperature already recorded today';
    return;
  }

  p.records.push({date:dt, temp:tempVal});
  savePatients(patients);

  el('nurseMsg').textContent = `Saved ${tempVal}°C for ${p.name}`;
  el('tempInput').value = '';
  renderAll();
}

// -----------------------
// Doctor actions
// -----------------------
function prefillDoctor(id){
  show('doctor');
  const patients = loadPatients();
  const sel = el('doctorPatient');
  sel.innerHTML = '';

  patients.forEach(p=>{
    sel.appendChild(new Option(`${p.name} | Bed ${p.bed}`, p.id));
  });

  sel.value = id || '';
}

function markDoctorVisit(){
  const pid = el('doctorPatient').value;
  const notes = el('docNotes').value || '';

  if(!pid){ el('doctorMsg').textContent='Choose a patient'; return; }

  const patients = loadPatients();
  const p = patients.find(x=>x.id===pid);
  const dt = today();

  if(p.visits.some(v=>v.date===dt)){
    el('doctorMsg').textContent='Already visited today';
    return;
  }

  p.visits.push({date:dt, notes});
  savePatients(patients);

  el('doctorMsg').textContent = `Visit recorded for ${p.name}`;
  el('docNotes').value = '';
  renderAll();
}

// -----------------------
// Admin actions
// -----------------------
function renderSelects(){
  const patients = loadPatients();
  const dropdowns = [el('nursePatient'), el('doctorPatient'), el('adminPatient')];

  dropdowns.forEach(sel=>{
    if(!sel) return;
    sel.innerHTML = '';

    patients.forEach(p=>{
      sel.appendChild(new Option(`${p.name} | Bed ${p.bed}`, p.id));
    });
  });
}

function adminDischarge(){
  const pid = el('adminPatient').value;
  if(!pid){ el('adminMsg').textContent='Pick a patient'; return; }

  const patients = loadPatients();
  const p = patients.find(x=>x.id===pid);

  if(feverFreeDays(p) < 3){
    el('adminMsg').textContent='Needs 3 fever-free days';
    return;
  }

  p.discharged = true;
  savePatients(patients);

  el('adminMsg').textContent = `${p.name} discharged`;
  renderAll();
}

function adminMarkDeath(){
  const pid = el('adminPatient').value;
  if(!pid){ el('adminMsg').textContent='Pick a patient'; return; }

  const patients = loadPatients();
  const p = patients.find(x=>x.id===pid);

  if(confirm("Mark as deceased?")){
    p.deceased = true;
    savePatients(patients);
    el('adminMsg').textContent='Marked deceased';
    renderAll();
  }
}

// -----------------------
// Todos
// -----------------------
function renderTodos(){
  const patients = loadPatients();
  const d = today();

  const needTemp = patients.filter(p=> !p.records.some(r=>r.date===d) && !p.discharged && !p.deceased);
  const needVisit = patients.filter(p=> !p.visits.some(v=>v.date===d) && !p.discharged && !p.deceased);

  el('nurseTodo').innerHTML = `<strong>Patients needing temperature today:</strong> ${needTemp.length}`;
  el('doctorTodo').innerHTML = `<strong>Patients needing doctor visit today:</strong> ${needVisit.length}`;
}

// -----------------------
// KPIs
// -----------------------
function renderKPIs(){
  const patients = loadPatients();
  const total = patients.length;

  const discharged = patients.filter(p=>p.discharged).length;
  const deceased = patients.filter(p=>p.deceased).length;

  const d = today();

  const tempsToday = patients.filter(p=> p.records.some(r=>r.date===d)).length;
  const visitsToday = patients.filter(p=> p.visits.some(v=>v.date===d)).length;

  el('stats').innerHTML = `
    <div class="card"><strong>Total patients</strong><div>${total}</div></div>
    <div class="card"><strong>Temp compliance</strong><div>${ total?Math.round(tempsToday/total*100):0 }%</div></div>
    <div class="card"><strong>Visit compliance</strong><div>${ total?Math.round(visitsToday/total*100):0 }%</div></div>
    <div class="card"><strong>Discharged</strong><div>${discharged}</div></div>
    <div class="card"><strong>Mortality</strong><div>${ total?Math.round(deceased/total*100):0 }%</div></div>
  `;

  el('adminKPIs').innerHTML = el('stats').innerHTML;
}

// -----------------------
// View detail
// -----------------------
function viewDetail(id){
  show('admin');
  const patients = loadPatients();
  const p = patients.find(x=>x.id===id);
  if(!p){ el('patientDetail').innerHTML='<small>Not found</small>'; return; }

  el('adminPatient').value = id;

  el('patientDetail').innerHTML = `
    <h4>${p.name} — Bed ${p.bed} ${p.discharged?'(Discharged)':''} ${p.deceased?'(Deceased)':''}</h4>

    <div class="panel">
      <strong>Temperature Records</strong>
      <div>${ (p.records||[]).slice(-14).reverse().map(r=>`<div>${r.date}: ${r.temp}°C</div>`).join('') }</div>
    </div>

    <div class="panel">
      <strong>Doctor Visits</strong>
      <div>${ (p.visits||[]).slice(-14).reverse().map(v=>`<div>${v.date}: ${v.notes||''}</div>`).join('') }</div>
    </div>

    <div class="panel"><strong>Fever-free streak:</strong> ${feverFreeDays(p)}</div>
  `;
}

// -----------------------
// Add new patient
// -----------------------
function addNewPatient(){
  const name = el('newPatientName').value.trim();
  const age = parseInt(el('newPatientAge').value);
  const bed = parseInt(el('newPatientBed').value);

  if(!name){ el('addPatientMsg').textContent="Enter patient name"; return; }
  if(!age || age <= 0){ el('addPatientMsg').textContent="Enter valid age"; return; }
  if(!bed || bed <= 0){ el('addPatientMsg').textContent="Enter valid bed no."; return; }

  const patients = loadPatients();

  if(patients.some(p=>p.bed === bed && !p.discharged && !p.deceased)){
    el('addPatientMsg').textContent="Bed already assigned";
    return;
  }

  // Generate ID
  const ids = patients.map(p=>parseInt((p.id||'P000').replace('P',''))||0);
  const nextId = 'P' + String((ids.length?Math.max(...ids):0)+1).padStart(3,'0');

  const newPatient = {
    id: nextId,
    bed,
    name,
    age,
    records: [],
    visits: [],
    discharged: false,
    deceased: false
  };

  patients.push(newPatient);
  savePatients(patients);

  el('addPatientMsg').textContent = "Patient added successfully";
  el('newPatientName').value = '';
  el('newPatientAge').value = '';
  el('newPatientBed').value = '';

  renderAll();
}

// Export functions globally
window.prefillNurse = prefillNurse;
window.prefillDoctor = prefillDoctor;
window.viewDetail = viewDetail;
