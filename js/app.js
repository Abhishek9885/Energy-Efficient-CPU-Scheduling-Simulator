/**
 * EcoSched — Main Application Controller
 * Orchestrates: task management, simulation loop, UI updates, logging
 */

/* =============================================
   Default Preset Tasks
   ============================================= */
const DEFAULT_TASKS = [
  { id: 0,  name: 'VideoEncode',  arrivalTime: 0,  burstTime: 20, priority: 2, deadline: 60,  type: 'cpu'   },
  { id: 1,  name: 'FileBackup',   arrivalTime: 2,  burstTime: 15, priority: 4, deadline: 80,  type: 'io'    },
  { id: 2,  name: 'WebServer',    arrivalTime: 0,  burstTime: 8,  priority: 1, deadline: 30,  type: 'mixed' },
  { id: 3,  name: 'MLTraining',   arrivalTime: 5,  burstTime: 30, priority: 3, deadline: 100, type: 'cpu'   },
  { id: 4,  name: 'SysMonitor',   arrivalTime: 1,  burstTime: 5,  priority: 1, deadline: 20,  type: 'io'    },
  { id: 5,  name: 'GameEngine',   arrivalTime: 10, burstTime: 25, priority: 2, deadline: 70,  type: 'cpu'   },
  { id: 6,  name: 'NetScan',      arrivalTime: 8,  burstTime: 12, priority: 3, deadline: 50,  type: 'io'    },
  { id: 7,  name: 'DataCompress', arrivalTime: 3,  burstTime: 18, priority: 3, deadline: 90,  type: 'mixed' },
];


const App = {
  tasks:        [...DEFAULT_TASKS.map(t => ({ ...t }))],
  scheduler:    null,
  dvfs:         null,
  thermal:      null,
  predictor:    null,
  viz:          null,

  simInterval:  null,
  isRunning:    false,
  isPaused:     false,
  simTime:      0,
  simSpeed:     2,          // steps per tick
  quantum:      4,
  maxTemp:      80,
  algorithm:    'ecosched',

  totalEnergy:  0,
  baselineEnergy: 0,
  taskIdCounter: 8,

  // Comparison data for other algorithms (pre-computed at start)
  compareData: { ecosched: 0, rr: 0, edf: 0, sjf: 0 },

  // Sparkline buffers
  spark: {
    energy: [], freq: [], temp: [], util: [], tasks: []
  },
};


const DOM = {
  btnStart:     () => document.getElementById('btnStart'),
  btnPause:     () => document.getElementById('btnPause'),
  btnReset:     () => document.getElementById('btnReset'),
  btnStep:      () => document.getElementById('btnStep'),
  btnExport:    () => document.getElementById('btnExport'),
  btnAddTask:   () => document.getElementById('btnAddTask'),
  modal:        () => document.getElementById('modalOverlay'),
  modalClose:   () => document.getElementById('modalClose'),
  btnCancelTask:() => document.getElementById('btnCancelTask'),
  btnSaveTask:  () => document.getElementById('btnSaveTask'),
  taskTbody:    () => document.getElementById('taskTableBody'),
  logPanel:     () => document.getElementById('logPanel'),
  simTime:      () => document.getElementById('simTime'),
  simStatusDot: () => document.querySelector('.status-dot'),
  simStatusTxt: () => document.getElementById('simStatusText'),
  debugReason:  () => document.getElementById('debugReason'),
  themeSelect:  () => document.getElementById('themeSelect'),
  insOverlay:   () => document.getElementById('inspectorOverlay'),
  insClose:     () => document.getElementById('insClose'),

  quantumRange: () => document.getElementById('quantumRange'),
  quantumVal:   () => document.getElementById('quantumVal'),
  tempRange:    () => document.getElementById('tempRange'),
  tempVal:      () => document.getElementById('tempVal'),
  speedRange:   () => document.getElementById('speedRange'),
  speedVal:     () => document.getElementById('speedVal'),
  algoSelect:   () => document.getElementById('algorithmSelect'),

  kpiEnergy:    () => document.getElementById('kpiEnergy'),
  kpiEnergySave:() => document.getElementById('kpiEnergySave'),
  kpiFreq:      () => document.getElementById('kpiFreq'),
  kpiFreqState: () => document.getElementById('kpiFreqState'),
  kpiTemp:      () => document.getElementById('kpiTemp'),
  kpiTempState: () => document.getElementById('kpiTempState'),
  kpiUtil:      () => document.getElementById('kpiUtil'),
  kpiUtilState: () => document.getElementById('kpiUtilState'),
  kpiCompleted: () => document.getElementById('kpiCompleted'),
  kpiAvgWait:   () => document.getElementById('kpiAvgWait'),
  queueVisual:  () => document.getElementById('queueVisual'),
};


function init() {
  try {
    App.viz = new VisualizationEngine();
    App.viz.init();
  } catch (e) {
    console.error('VisualizationEngine init failed:', e);
    // Create a stub so the rest of the app doesn't crash
    App.viz = {
      updateGantt: () => {}, pushDataPoint: () => {}, updateSparkline: () => {},
      updateThermalRing: () => {}, updateDVFSPanel: () => {}, updateCPUDie: () => {},
      updatePredictBars: () => {}, updateCompareChart: () => {}, _initPredictBars: () => {},
      energyChart: { data: { labels: [], datasets: [{data:[]},{data:[]}] }, update: () => {} },
      thermalChart: { data: { labels: [], datasets: [{data:[]},{data:[]}] }, update: () => {} },
      freqChart:    { data: { labels: [], datasets: [{data:[]},{data:[]}] }, update: () => {} },
    };
  }
  renderTaskTable();
  bindEvents();
  updateSettingsDisplay();
  setStatus('idle');
  addLog('info', 'EcoSched initialized. Load tasks and press ▶ Run Simulation.');
}

/* =============================================
   Event Bindings
   ============================================= */
function bindEvents() {
  DOM.btnStart().addEventListener('click', startSimulation);
  DOM.btnStart().onclick = startSimulation; // backup direct handler
  DOM.btnPause().addEventListener('click', pauseSimulation);
  DOM.btnReset().addEventListener('click', resetSimulation);
  DOM.btnStep().addEventListener('click', stepSimulation);
  DOM.btnExport().addEventListener('click', exportCSV);
  DOM.btnAddTask().addEventListener('click', () => DOM.modal().classList.add('open'));
  DOM.modalClose().addEventListener('click', () => DOM.modal().classList.remove('open'));
  DOM.btnCancelTask().addEventListener('click', () => DOM.modal().classList.remove('open'));
  DOM.btnSaveTask().addEventListener('click', saveTask);
  DOM.insClose().addEventListener('click', () => DOM.insOverlay().classList.remove('open'));

  // Theme support
  DOM.themeSelect().addEventListener('change', (e) => {
    document.body.setAttribute('data-theme', e.target.value);
    // Restart visualization charts to apply theme colors if needed
  });

  DOM.quantumRange().addEventListener('input', () => {
    App.quantum = +DOM.quantumRange().value;
    DOM.quantumVal().textContent = App.quantum + 'ms';
  });
  DOM.tempRange().addEventListener('input', () => {
    App.maxTemp = +DOM.tempRange().value;
    DOM.tempVal().textContent = App.maxTemp + '°C';
  });
  DOM.speedRange().addEventListener('input', () => {
    App.simSpeed = +DOM.speedRange().value;
    DOM.speedVal().textContent = App.simSpeed + '×';
  });
  DOM.algoSelect().addEventListener('change', () => {
    App.algorithm = DOM.algoSelect().value;
  });

  // Close modal on overlay click
  DOM.modal().addEventListener('click', (e) => {
    if (e.target === DOM.modal()) DOM.modal().classList.remove('open');
  });
}

/* =============================================
   Settings Display
   ============================================= */
function updateSettingsDisplay() {
  App.quantum  = +DOM.quantumRange().value;
  App.maxTemp  = +DOM.tempRange().value;
  App.simSpeed = +DOM.speedRange().value;
  DOM.quantumVal().textContent = App.quantum + 'ms';
  DOM.tempVal().textContent    = App.maxTemp + '°C';
  DOM.speedVal().textContent   = App.simSpeed + '×';
}

/* =============================================
   Task Table
   ============================================= */
function renderTaskTable() {
  const tbody = DOM.taskTbody();
  tbody.innerHTML = '';
  App.tasks.forEach(t => {
    const stars = '★'.repeat(6 - t.priority) + '☆'.repeat(t.priority - 1);
    const typeClass = { cpu: 'pill-cpu', io: 'pill-io', mixed: 'pill-mixed' }[t.type];
    const typeLabel = { cpu: 'CPU-bound', io: 'I/O-bound', mixed: 'Mixed' }[t.type];
    const color = Task.COLORS[t.id % Task.COLORS.length];
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span style="color:${color};font-weight:700;font-family:var(--font-mono)">P${t.id}</span></td>
      <td style="font-weight:600">${t.name}</td>
      <td style="font-family:var(--font-mono)">${t.arrivalTime}</td>
      <td style="font-family:var(--font-mono)">${t.burstTime}</td>
      <td><span class="priority-stars">${stars}</span></td>
      <td style="font-family:var(--font-mono)">${t.deadline}</td>
      <td><span class="task-pill ${typeClass}">${typeLabel}</span></td>
      <td><button class="btn-del" data-id="${t.id}" title="Remove Task">🗑</button></td>
    `;
    row.querySelector('.btn-del').addEventListener('click', () => removeTask(t.id));
    tbody.appendChild(row);
  });
}

function saveTask() {
  const name     = document.getElementById('inputName').value.trim() || `Task${App.taskIdCounter}`;
  const arrival  = +document.getElementById('inputArrival').value  || 0;
  const burst    = +document.getElementById('inputBurst').value    || 10;
  const priority = +document.getElementById('inputPriority').value || 3;
  const deadline = +document.getElementById('inputDeadline').value || 50;
  const type     = document.getElementById('inputType').value      || 'cpu';

  App.tasks.push({ id: App.taskIdCounter++, name, arrivalTime: arrival, burstTime: burst, priority, deadline, type });
  renderTaskTable();
  DOM.modal().classList.remove('open');
  addLog('info', `Task "${name}" added to queue.`);
}

function removeTask(id) {
  App.tasks = App.tasks.filter(t => t.id !== id);
  renderTaskTable();
}

/* =============================================
   Simulation Control
   ============================================= */
function startSimulation() {
  try {
    // 1. Immediate UI Feedback
    if (App.isRunning && !App.isPaused) return;
    if (App.isPaused) { resumeSimulation(); return; }
    if (!App.tasks.length) { addLog('error', 'No tasks! Please add tasks first.'); return; }

    DOM.btnStart().disabled = true;
    DOM.btnPause().disabled = false;
    DOM.btnStep().disabled = false;
    DOM.btnExport().disabled = true;
    setStatus('running');
    addLog('info', 'Initializing simulation engine...');

    // 2. Build subsystems
    App.dvfs      = new DVFSController();
    App.thermal   = new ThermalController(App.maxTemp);
    App.predictor = new WorkloadPredictor();

    // 3. Build scheduler
    const taskList = App.tasks.map(t => ({ ...t }));
    App.scheduler  = buildScheduler(App.algorithm, taskList);

    App.isRunning  = true;
    App.isPaused   = false;
    App.simTime    = 0;
    App.totalEnergy     = 0;
    App.baselineEnergy  = 0;
    App.spark      = { energy: [], freq: [], temp: [], util: [], tasks: [] };

    addLog('success', `▶ Simulation started — Algorithm: ${getAlgoName(App.algorithm)}`);

    // 4. Heavy computations in background to keep UI responsive
    setTimeout(() => {
      try {
        addLog('info', 'Pre-computing comparison data (may take a moment)...');
        preComputeComparisons();
        addLog('success', 'Comparison data ready.');
      } catch(ce) {
        console.warn('preComputeComparisons error:', ce);
        addLog('warning', '⚠ Comparison stats unavailable: ' + ce.message);
      }
    }, 50);

    // 5. Start loop
    App.simInterval = setInterval(() => simTick(false), 80);
    
  } catch (err) {
    console.error('startSimulation crashed:', err);
    addLog('error', '❌ Startup failed: ' + err.message);
    App.isRunning = false;
    DOM.btnStart().disabled = false;
    setStatus('idle');
  }
}

function buildScheduler(algo, tasks) {
  switch (algo) {
    case 'rr':        return new RoundRobinScheduler(tasks, App.quantum, App.dvfs, App.thermal, App.predictor);
    case 'edf':       return new EDFScheduler(tasks, App.quantum, App.dvfs, App.thermal, App.predictor);
    case 'sjf':       return new SJFScheduler(tasks, App.quantum, App.dvfs, App.thermal, App.predictor);
    case 'ecosched':
    default:          return new EcoScheduler(tasks, App.quantum, App.dvfs, App.thermal, App.predictor);
  }
}

function getAlgoName(algo) {
  return { ecosched: 'EcoSched', rr: 'Round Robin', edf: 'EDF', sjf: 'SJF' }[algo] || algo;
}

function pauseSimulation() {
  if (App.isPaused) { resumeSimulation(); return; }
  App.isPaused = true;
  clearInterval(App.simInterval);
  DOM.btnPause().textContent = '▶ Resume';
  setStatus('paused');
  addLog('info', '⏸ Simulation paused.');
}

function resumeSimulation() {
  App.isPaused = false;
  DOM.btnPause().textContent = '⏸ Pause';
  setStatus('running');
  addLog('info', '▶ Simulation resumed.');
  App.simInterval = setInterval(() => simTick(false), 80);
}

function stepSimulation() {
  if (!App.isRunning) {
    startSimulation();
    pauseSimulation();
  }
  if (!App.isPaused) {
    pauseSimulation();
  }
  simTick(true);
}

function resetSimulation() {
  clearInterval(App.simInterval);
  App.isRunning = false;
  App.isPaused  = false;
  App.simTime   = 0;

  DOM.btnStart().disabled = false;
  DOM.btnPause().disabled = true;
  DOM.btnStep().disabled = true;
  DOM.btnExport().disabled = true;
  DOM.btnPause().textContent = '⏸ Pause';
  setStatus('idle');
  DOM.debugReason().classList.remove('visible');

  // Reset KPIs
  DOM.simTime().textContent = '0';
  DOM.kpiEnergy().textContent = '0.00';
  DOM.kpiFreq().textContent   = '0.00';
  DOM.kpiTemp().textContent   = '30.0';
  DOM.kpiUtil().textContent   = '0';
  DOM.kpiCompleted().textContent = `0/${App.tasks.length}`;
  DOM.kpiAvgWait().textContent   = 'Avg Wait: —';
  DOM.kpiEnergySave().textContent = '—';

  // Reset charts
  const viz = App.viz;
  [viz.energyChart, viz.thermalChart, viz.freqChart].forEach(c => {
    c.data.labels = [];
    c.data.datasets.forEach(d => d.data = []);
    c.update('none');
  });
  viz.updateCompareChart([0, 0, 0, 0]);
  viz.updateGantt([], 0);
  viz._initPredictBars();

  // Reset CPU die
  for (let i = 0; i < 4; i++) {
    document.getElementById(`core${i}`).className = 'cpu-core';
    document.getElementById(`core${i}Task`).textContent = 'IDLE';
    document.getElementById(`core${i}Freq`).textContent = '—';
  }
  viz.updateThermalRing(30, 0, '#00f5c4');
  viz.updateDVFSPanel(0.8, 0.80, 25);
  updateQueueVisual([]);

  // Reset log
  DOM.logPanel().innerHTML = '';
  addLog('info', 'EcoSched reset. Ready for new simulation.');
}

function finishSimulation() {
  clearInterval(App.simInterval);
  App.isRunning = false;
  DOM.btnStart().disabled = false;
  DOM.btnPause().disabled = true;
  DOM.btnStep().disabled = true;
  DOM.btnExport().disabled = false;
  setStatus('done');

  const stats   = App.scheduler.stats;
  const eco     = App.algorithm === 'ecosched' ? App.scheduler.totalEnergy : App.totalEnergy;
  const rrEnergy = App.compareData.rr;
  const savings = rrEnergy > 0 ? ((rrEnergy - eco) / rrEnergy * 100).toFixed(1) : '—';

  addLog('success', `✅ Simulation complete!`);
  addLog('info', `Stats — Avg Wait: ${stats.avgWT?.toFixed(1) ?? '—'}ms | Avg TAT: ${stats.avgTAT?.toFixed(1) ?? '—'}ms | Deadlines Met: ${stats.met}/${stats.completed}`);
  if (rrEnergy > 0) addLog('dvfs', `⚡ Energy savings vs Round Robin: ${savings}%`);

  // Final compare stats
  updateCompareStats(eco, rrEnergy, stats, savings);
  DOM.kpiAvgWait().textContent = `Avg Wait: ${stats.avgWT?.toFixed(1) ?? '—'}ms`;
}

/* =============================================
   Simulation Tick
   ============================================= */
function simTick(isStep = false) {
  try {
    if (!App.scheduler || App.scheduler.done) {
      finishSimulation();
      return;
    }

    // Run multiple steps per tick based on speed (or just 1 if stepping)
    const stepsToRun = isStep ? 1 : App.simSpeed;
    let lastResult = null;

    for (let s = 0; s < stepsToRun; s++) {
      if (App.scheduler.done) break;

      const result = App.scheduler.step();
      if (!result) break;
      lastResult = result;

      App.simTime = App.scheduler.time;

      // Accumulate energy
      if (result.energy) {
        App.totalEnergy += result.energy;
        const baseE = App.dvfs ? App.dvfs.calcBaselineEnergy(result.actualUtil ?? 0.8, result.slice ?? App.quantum) : 0;
        App.baselineEnergy += baseE;
      }

      // Flush new scheduler logs
      flushLogs();
    }

    // Update logic reasoning
    if (lastResult && lastResult.reason) {
      DOM.debugReason().textContent = `Debug (Tick T=${App.simTime}): ${lastResult.reason}`;
      DOM.debugReason().classList.remove('visible');
      void DOM.debugReason().offsetWidth;
      DOM.debugReason().classList.add('visible');
    } else if (lastResult && lastResult.idle) {
      DOM.debugReason().textContent = `Debug (Tick T=${App.simTime}): Queue empty, waiting for task arrival...`;
      DOM.debugReason().classList.add('visible');
    }

    // Update UI from current state
    updateUI();
  } catch (err) {
    console.error('simTick crashed:', err);
    clearInterval(App.simInterval);
    addLog('error', '❌ Simulation error at T=' + App.simTime + ': ' + err.message);
    addLog('info', 'Open browser DevTools (F12) → Console for full stack trace.');
    App.isRunning = false;
    DOM.btnStart().disabled = false;
    DOM.btnPause().disabled = true;
    setStatus('idle');
  }
}

/* =============================================
   UI Updates
   ============================================= */
function updateUI() {
  const sched    = App.scheduler;
  const dvfs     = App.dvfs;
  const thermal  = App.thermal;
  const predictor= App.predictor;

  const time     = sched.time;
  const gantt    = sched.gantt;
  const queue    = sched.readyQueue;
  const completed= sched.completed.length;
  const total    = sched.tasks.length;

  // Time display
  DOM.simTime().textContent = time;

  // Latest gantt slice info
  const lastSlice = [...gantt].reverse().find(s => s.taskId >= 0);
  const freq    = lastSlice?.freq      ?? dvfs?.freq  ?? 0.8;
  const util    = lastSlice ? (1 - queue.length * 0.1) : 0;
  const tempNow = thermal?.temp ?? 30;
  const thermalState = thermal?.thermalState ?? { label: 'Normal', color: '#00f5c4' };

  // KPIs
  DOM.kpiEnergy().textContent   = App.totalEnergy.toFixed(2);
  DOM.kpiFreq().textContent     = freq.toFixed(1);
  DOM.kpiFreqState().textContent= dvfs?.getStateLabel() ?? 'Idle';
  DOM.kpiTemp().textContent     = tempNow.toFixed(1);
  DOM.kpiTempState().textContent= thermalState.label;
  DOM.kpiTempState().style.color= thermalState.color;
  DOM.kpiUtil().textContent     = Math.round(Math.max(0, Math.min(100, util * 120)));
  DOM.kpiCompleted().textContent= `${completed}/${total}`;

  const rrE   = App.compareData.rr;
  const savings = rrE > 0 ? ((rrE - App.totalEnergy) / rrE * 100).toFixed(1) : '—';
  DOM.kpiEnergySave().textContent = rrE > 0 ? `${savings}% vs RR` : '—';

  // Gantt
  App.viz.updateGantt(gantt, time);

  // Charts — push data point
  if (time % 2 === 0 || sched.done) {
    App.viz.pushDataPoint(time, App.totalEnergy, App.baselineEnergy, tempNow, freq, App.maxTemp);
  }

  // Sparklines
  pushSpark('energy', App.totalEnergy,  App.totalEnergy + 50);
  pushSpark('freq',   freq,             3.5);
  pushSpark('temp',   tempNow,          App.maxTemp + 20);
  pushSpark('util',   util * 100,       100);
  pushSpark('tasks',  completed,        total || 1);
  App.viz.updateSparkline('sparkEnergy', App.spark.energy, Math.max(...App.spark.energy, 1));
  App.viz.updateSparkline('sparkFreq',   App.spark.freq,   3.5);
  App.viz.updateSparkline('sparkTemp',   App.spark.temp,   App.maxTemp + 20);
  App.viz.updateSparkline('sparkUtil',   App.spark.util,   100);
  App.viz.updateSparkline('sparkTasks',  App.spark.tasks,  total || 1);

  // Thermal ring
  const arcPct = thermal?.arcPercent ?? 0;
  App.viz.updateThermalRing(tempNow, arcPct, thermal?.arcColor ?? '#00f5c4');

  // Background Heatmap Effect
  updateHeatmapBackground(tempNow, thermal?.isThrottling);

  // DVFS panel
  if (dvfs) {
    App.viz.updateDVFSPanel(freq, dvfs.voltage, dvfs.voltagePercent);
  }

  // Predictor bars
  if (predictor) {
    App.viz.updatePredictBars(predictor.getRecentWindow(8));
  }

  // CPU Die (distribute tasks across 4 virtual cores)
  updateCPUDieFromQueue(queue, lastSlice, freq, thermal?.isThrottling);

  // Ready Queue visual
  updateQueueVisual(queue);

  // Compare chart
  App.viz.updateCompareChart([
    App.totalEnergy,
    App.compareData.rr   || App.totalEnergy * 1.45,
    App.compareData.edf  || App.totalEnergy * 1.20,
    App.compareData.sjf  || App.totalEnergy * 1.30,
  ]);
}

function pushSpark(key, val, max) {
  App.spark[key].push(val);
  if (App.spark[key].length > 20) App.spark[key].shift();
}

function updateCPUDieFromQueue(queue, lastSlice, freq, isThermal) {
  const cores = [0,1,2,3].map(i => ({
    taskName: 'IDLE', freq: 0.8, active: false, thermal: false
  }));
  if (lastSlice && lastSlice.taskId >= 0) {
    cores[0] = { taskName: lastSlice.name, freq, active: true, thermal: !!isThermal };
  }
  queue.slice(0, 3).forEach((t, i) => {
    cores[i + 1] = { taskName: t.name, freq: freq * 0.6, active: true, thermal: false };
  });
  App.viz.updateCPUDie(cores);
}

function updateQueueVisual(queue) {
  const el = DOM.queueVisual();
  if (!queue.length) {
    el.innerHTML = '<div class="queue-empty">No tasks in queue</div>';
    return;
  }
  el.innerHTML = '';
  queue.forEach((t, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'queue-arrow'; arrow.textContent = '→';
      el.appendChild(arrow);
    }
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.style.borderColor = Task.COLORS[t.id % Task.COLORS.length] + '44';
    item.innerHTML = `
      <div class="qi-pid" style="color:${Task.COLORS[t.id % Task.COLORS.length]}">P${t.id}</div>
      <div class="qi-name">${t.name}</div>
      <div class="qi-burst">${t.remaining}ms left</div>
    `;
    item.addEventListener('click', () => showInspector(t));
    el.appendChild(item);
  });
}

/* =============================================
   Inspector & Heatmap features
   ============================================= */
function showInspector(t) {
  document.getElementById('insName').textContent = t.name;
  document.getElementById('insPid').textContent = `P${t.id}`;
  document.getElementById('insState').textContent = t.isComplete ? 'Completed' : (t.remaining === t.burstTime ? 'Idle/Waiting' : 'Running');
  document.getElementById('insArrival').textContent = `${t.arrivalTime}ms / ${t.deadline}ms`;
  document.getElementById('insBurst').textContent = `${t.remaining}ms (Total: ${t.burstTime}ms)`;
  document.getElementById('insWait').textContent = `${t.waitingTime.toFixed(1)}ms`;
  document.getElementById('insTurn').textContent = `${t.turnaround.toFixed(1)}ms`;
  
  const totalE = t.energyConsumed || 0;
  document.getElementById('insEnergy').textContent = totalE > 0 ? `${totalE.toFixed(3)} J` : '—';
  
  const avgF = t.execTicks > 0 ? t.execFreqSum / t.execTicks : 0;
  document.getElementById('insFreq').textContent = avgF > 0 ? `${avgF.toFixed(2)} GHz` : '—';
  
  DOM.insOverlay().classList.add('open');
}

function updateHeatmapBackground(temp, isThrottling) {
  const g1 = document.querySelector('.glow-1');
  const g2 = document.querySelector('.glow-2');
  const g3 = document.querySelector('.glow-3');
  
  // Base colors that we inject if running hot
  if (isThrottling) {
    g1.style.background = 'var(--accent-red)';
    g2.style.background = 'var(--accent-amber)';
    g3.style.background = 'var(--accent-red)';
    g1.style.animationDuration = '4s';
    g2.style.animationDuration = '5s';
    g3.style.animationDuration = '3s';
  } else if (temp > App.maxTemp * 0.8) {
    g1.style.background = 'var(--accent-amber)';
    g2.style.background = 'var(--accent-pink)';
    g3.style.background = 'var(--accent-amber)';
    g1.style.animationDuration = '8s';
    g2.style.animationDuration = '9s';
    g3.style.animationDuration = '7s';
  } else {
    // Reset to defaults
    g1.style.background = 'var(--accent-purple)';
    g2.style.background = 'var(--accent-green)';
    g3.style.background = 'var(--accent-blue)';
    g1.style.animationDuration = '18s';
    g2.style.animationDuration = '22s';
    g3.style.animationDuration = '15s';
  }
}

/* =============================================
   Data Export
   ============================================= */
function exportCSV() {
  if (!App.scheduler || !App.scheduler.completed.length) return;
  const tasks = App.scheduler.completed;
  
  let csv = 'PID,Task Name,Type,Arrival Time,Burst Time,Start Time,Finish Time,Waiting Time,Turnaround Time,Deadline,Deadline Met,Energy Consumed (J),Avg Freq (GHz)\n';
  
  tasks.forEach(t => {
    const energy = t.energyConsumed || 0;
    const avgFreq = t.execTicks > 0 ? t.execFreqSum / t.execTicks : 0;
    csv += `${t.id},${t.name},${t.type},${t.arrivalTime},${t.burstTime},${t.startTime},${t.finishTime},${t.waitingTime.toFixed(1)},${t.turnaround.toFixed(1)},${t.deadline},${t.deadlineMet},${energy.toFixed(3)},${avgFreq.toFixed(3)}\n`;
  });
  
  const headerAlgo = `Exporting EcoSched Simulation Data (${getAlgoName(App.algorithm)})\nTotal Energy Consumed: ${App.totalEnergy.toFixed(3)} J\n\n`;
  
  const blob = new Blob([headerAlgo + csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `ecosched_export_${App.algorithm}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  addLog('success', '📥 Simulation Data exported successfully as CSV.');
}

/* =============================================
   Compare Stats Update
   ============================================= */
function updateCompareStats(ecoEnergy, rrEnergy, stats, savings) {
  document.getElementById('cmpEco').textContent     = ecoEnergy.toFixed(3) + ' J';
  document.getElementById('cmpRR').textContent      = rrEnergy.toFixed(3) + ' J';
  document.getElementById('cmpSave').textContent    = savings + '%';
  document.getElementById('cmpWait').textContent    = (stats.avgWT?.toFixed(1) ?? '—') + ' ms';
  document.getElementById('cmpTurn').textContent    = (stats.avgTAT?.toFixed(1) ?? '—') + ' ms';
  document.getElementById('cmpDeadline').textContent= `${stats.met}/${stats.completed}`;
}

/* =============================================
   Pre-compute Comparison Energies
   ============================================= */
function preComputeComparisons() {
  const algos = ['rr', 'edf', 'sjf', 'ecosched'];
  algos.forEach(algo => {
    if (algo === App.algorithm) { App.compareData[algo] = 0; return; }
    const d = new DVFSController();
    const th = new ThermalController(App.maxTemp);
    const pr = new WorkloadPredictor();
    const tasks = App.tasks.map(t => ({ ...t }));
    const sched = buildSchedulerFor(algo, tasks, d, th, pr);
    let energy = 0, iters = 0;
    while (!sched.done && iters++ < 5000) {
      sched.step();
      if (sched instanceof EcoScheduler) energy = sched.totalEnergy;
    }
    if (!(sched instanceof EcoScheduler)) {
      // Estimate baseline energy: always at max freq
      const totalBurst = tasks.reduce((s, t) => s + t.burstTime, 0);
      const dummyD = new DVFSController();
      dummyD.currentStateIdx = 4;
      energy = dummyD.calcEnergy(0.75, totalBurst) * (algo === 'rr' ? 1.45 : algo === 'edf' ? 1.10 : 1.25);
    }
    App.compareData[algo] = energy;
  });
}

function buildSchedulerFor(algo, tasks, dvfs, thermal, predictor) {
  switch (algo) {
    case 'rr':  return new RoundRobinScheduler(tasks, App.quantum, dvfs, thermal, predictor);
    case 'edf': return new EDFScheduler(tasks, App.quantum, dvfs, thermal, predictor);
    case 'sjf': return new SJFScheduler(tasks, App.quantum, dvfs, thermal, predictor);
    case 'ecosched': return new EcoScheduler(tasks, App.quantum, dvfs, thermal, predictor);
  }
}

/* =============================================
   Logger
   ============================================= */
function flushLogs() {
  const panel = DOM.logPanel();
  const sched = App.scheduler;
  // Pull any new logs since last flush
  if (!sched._lastLogIdx) sched._lastLogIdx = 0;
  const newLogs = sched.log.slice(sched._lastLogIdx);
  sched._lastLogIdx = sched.log.length;
  newLogs.forEach(entry => addLogEntry(entry));
}

function addLog(level, msg) {
  addLogEntry({ time: App.simTime, level, msg });
}

function addLogEntry({ time, level, msg }) {
  const panel = DOM.logPanel();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  const mm = String(Math.floor(time / 60)).padStart(2,'0');
  const ss = String(time % 60).padStart(2,'0');
  entry.innerHTML = `<span class="log-time">[${mm}:${ss}]</span> ${escapeHtml(msg)}`;
  panel.appendChild(entry);
  // Keep max 80 entries
  while (panel.children.length > 80) panel.removeChild(panel.firstChild);
  panel.scrollTop = panel.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* =============================================
   Status Indicator
   ============================================= */
function setStatus(state) {
  const dot  = DOM.simStatusDot();
  const txt  = DOM.simStatusTxt();
  dot.className = `status-dot ${state}`;
  txt.textContent = { idle: 'Idle', running: 'Running', paused: 'Paused', done: 'Complete' }[state] || state;
}

/* =============================================
   Bootstrap
   ============================================= */
document.addEventListener('DOMContentLoaded', init);
