/**
 * EcoSched — Visualization Engine
 * Manages: Gantt Chart, Line Charts (energy/thermal/freq), Sparklines, CPU Die, Predictor Bars
 */

// Polyfill canvas roundRect for Firefox < 112 and Safari < 15.4
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y,     x + w, y + h, r);
    this.arcTo(x + w, y + h, x,     y + h, r);
    this.arcTo(x,     y + h, x,     y,     r);
    this.arcTo(x,     y,     x + w, y,     r);
    this.closePath();
    return this;
  };
}

class VisualizationEngine {
  constructor() {
    this.energyChart  = null;
    this.thermalChart = null;
    this.freqChart    = null;
    this.compareChart = null;
    this.ganttCtx     = null;
    this.ganttData    = [];

    this._energyData  = { labels: [], ecosched: [], baseline: [] };
    this._thermalData = { labels: [], temps: [], throttleZone: [] };
    this._freqData    = { labels: [], freqs: [] };

    this.sparkPoints  = { energy: [], freq: [], temp: [], util: [], tasks: [] };
    this.MAX_POINTS   = 40;
  }

  init() {
    this._initEnergyChart();
    this._initThermalChart();
    this._initFreqChart();
    this._initCompareChart();
    this._initGantt();
    this._initPredictBars();
  }

  /* ────────────────── GANTT ────────────────── */
  _initGantt() {
    const canvas = document.getElementById('ganttCanvas');
    this.ganttCtx = canvas.getContext('2d');
    this.ganttData = [];
    this._drawGantt();
  }

  updateGantt(ganttSlices, totalTime) {
    this.ganttData = ganttSlices;
    this._drawGantt(totalTime);
  }

  _drawGantt(totalTime = 0) {
    const canvas = this.ganttCtx.canvas;
    const outer  = document.getElementById('ganttOuter');
    const tasks  = [...new Set(this.ganttData.filter(s => s.taskId >= 0).map(s => s.taskId))];
    const ROW_H  = 36, LABEL_W = 80, PADDING = 16;
    const rows   = Math.max(tasks.length, 1);
    const maxT   = Math.max(totalTime, ...this.ganttData.map(s => s.end), 50);
    const outerW = outer.clientWidth || 800;
    const PX_PER_MS = Math.max(4, Math.min(14, (outerW - LABEL_W - PADDING * 2) / maxT));

    canvas.width  = Math.min(8000, LABEL_W + maxT * PX_PER_MS + PADDING * 2);
    canvas.height = Math.min(2000, PADDING + rows * (ROW_H + 6) + 30);

    const ctx = this.ganttCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    for (let t = 0; t <= maxT; t += 10) {
      const x = LABEL_W + t * PX_PER_MS;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }

    // Time axis labels
    ctx.fillStyle  = 'rgba(148,163,184,0.6)';
    ctx.font       = '10px JetBrains Mono, monospace';
    ctx.textAlign  = 'center';
    for (let t = 0; t <= maxT; t += 10) {
      const x = LABEL_W + t * PX_PER_MS;
      ctx.fillText(t + 'ms', x, canvas.height - 4);
    }

    // Draw each task row
    const taskMap = {};
    tasks.forEach((id, i) => { taskMap[id] = i; });

    this.ganttData.forEach(slice => {
      if (slice.taskId < 0) return; // Skip IDLE for row-based gantt
      const row = taskMap[slice.taskId];
      if (row === undefined) return;
      const y = PADDING + row * (ROW_H + 6);
      const x = LABEL_W + slice.start * PX_PER_MS;
      const w = Math.max(2, (slice.end - slice.start) * PX_PER_MS);

      // Task bar
      const grad = ctx.createLinearGradient(x, y, x, y + ROW_H);
      grad.addColorStop(0, slice.color + 'cc');
      grad.addColorStop(1, slice.color + '55');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w - 1, ROW_H, 5);
      ctx.fill();

      // Thermal throttle indicator
      if (slice.thermal) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth   = 2;
        ctx.strokeRect(x, y, w - 1, ROW_H);
      }

      // Freq badge
      if (w > 30) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${slice.freq}GHz`, x + w / 2, y + ROW_H - 6);
        if (w > 50) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.fillText(slice.name, x + w / 2, y + ROW_H / 2 - 2);
        }
      }
    });

    // Row labels
    ctx.textAlign = 'right';
    tasks.forEach((id, i) => {
      const slice = this.ganttData.find(s => s.taskId === id);
      if (!slice) return;
      const y = PADDING + i * (ROW_H + 6) + ROW_H / 2 + 4;
      ctx.fillStyle  = slice.color;
      ctx.font       = 'bold 11px Inter, sans-serif';
      ctx.fillText(`P${id}`, LABEL_W - 8, y);
    });

    // Now-line
    if (totalTime > 0) {
      const nowX = LABEL_W + totalTime * PX_PER_MS;
      ctx.strokeStyle = 'rgba(0,245,196,0.7)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, canvas.height - 20); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Legend
    this._renderGanttLegend(tasks);
  }

  _renderGanttLegend(taskIds) {
    const container = document.getElementById('ganttLegend');
    container.innerHTML = '';
    taskIds.forEach(id => {
      const slice = this.ganttData.find(s => s.taskId === id);
      if (!slice) return;
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<div class="legend-dot" style="background:${slice.color}"></div>P${id}: ${slice.name}`;
      container.appendChild(item);
    });
  }

  /* ────────────────── LINE CHARTS ────────────────── */
  _chartDefaults() {
    return {
      responsive: true, maintainAspectRatio: false,
      animation:  { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,18,35,0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor:  '#e2e8f0',
          padding: 10,
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: { color: '#475569', font: { size: 9, family: 'JetBrains Mono' } },
        },
        y: {
          grid:  { color: 'rgba(255,255,255,0.06)', drawBorder: false },
          ticks: { color: '#475569', font: { size: 9, family: 'JetBrains Mono' } },
        }
      }
    };
  }

  _initEnergyChart() {
    const ctx = document.getElementById('energyChart').getContext('2d');
    this.energyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'EcoSched', data: [],
            borderColor: '#00f5c4', backgroundColor: 'rgba(0,245,196,0.08)',
            fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
          },
          {
            label: 'Baseline (RR)', data: [],
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)',
            fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
            borderDash: [5, 3],
          }
        ]
      },
      options: {
        ...this._chartDefaults(),
        plugins: {
          ...this._chartDefaults().plugins,
          legend: {
            display: true,
            labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 }
          }
        },
        scales: {
          ...this._chartDefaults().scales,
          y: { ...this._chartDefaults().scales.y, title: { display: true, text: 'Energy (J)', color: '#475569', font: { size: 10 } } }
        }
      }
    });
  }

  _initThermalChart() {
    const ctx = document.getElementById('thermalChart').getContext('2d');
    this.thermalChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperature', data: [],
            borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
            fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
          },
          {
            label: 'Throttle Limit', data: [],
            borderColor: '#ef4444', backgroundColor: 'transparent',
            borderDash: [6, 3], tension: 0, pointRadius: 0, borderWidth: 1.5,
          }
        ]
      },
      options: {
        ...this._chartDefaults(),
        plugins: {
          ...this._chartDefaults().plugins,
          legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } }
        },
        scales: {
          ...this._chartDefaults().scales,
          y: {
            ...this._chartDefaults().scales.y,
            min: 25,
            title: { display: true, text: 'Temp (°C)', color: '#475569', font: { size: 10 } }
          }
        }
      }
    });
  }

  _initFreqChart() {
    const ctx = document.getElementById('freqChart').getContext('2d');
    this.freqChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'CPU Freq (GHz)', data: [],
            borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)',
            fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
            stepped: 'after',
          },
          {
            label: 'Max Freq', data: [],
            borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'transparent',
            borderDash: [6,3], tension: 0, pointRadius: 0, borderWidth: 1.5,
          }
        ]
      },
      options: {
        ...this._chartDefaults(),
        plugins: {
          ...this._chartDefaults().plugins,
          legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } }
        },
        scales: {
          ...this._chartDefaults().scales,
          y: {
            ...this._chartDefaults().scales.y,
            min: 0, max: 3.5,
            title: { display: true, text: 'GHz', color: '#475569', font: { size: 10 } }
          }
        }
      }
    });
  }

  _initCompareChart() {
    const ctx = document.getElementById('compareChart').getContext('2d');
    this.compareChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['EcoSched', 'Round Robin', 'EDF', 'SJF'],
        datasets: [
          {
            label: 'Energy (J)', data: [0, 0, 0, 0],
            backgroundColor: [
              'rgba(0,245,196,0.7)', 'rgba(239,68,68,0.7)',
              'rgba(59,130,246,0.7)', 'rgba(245,158,11,0.7)'
            ],
            borderRadius: 6, borderWidth: 0,
          }
        ]
      },
      options: {
        ...this._chartDefaults(),
        indexAxis: 'y',
        layout: { padding: { top: 0, bottom: 0, left: 0, right: 10 } },
        scales: {
          x: {
            ...this._chartDefaults().scales.x,
            title: { display: false }
          },
          y: { 
            ...this._chartDefaults().scales.y,
            ticks: { ...this._chartDefaults().scales.y.ticks, font: { size: 8 } }
          }
        }
      }
    });
  }

  /* ────────────────── PREDICTION BARS ────────────────── */
  _initPredictBars() {
    const container = document.getElementById('predictBars');
    container.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'predict-bar-wrap';
      wrap.innerHTML = `
        <div class="predict-bar predicted" id="pbar-pred-${i}" style="height:2px"></div>
        <div class="predict-bar actual"    id="pbar-act-${i}"  style="height:2px"></div>
      `;
      container.appendChild(wrap);
    }
  }

  updatePredictBars(window) {
    const maxH = 60;
    window.forEach((pair, i) => {
      const predEl = document.getElementById(`pbar-pred-${i}`);
      const actEl  = document.getElementById(`pbar-act-${i}`);
      if (predEl) predEl.style.height = `${Math.max(2, (pair.predicted ?? 0) * maxH)}px`;
      if (actEl)  actEl.style.height  = `${Math.max(2, (pair.actual    ?? 0) * maxH)}px`;
    });
  }

  /* ────────────────── LIVE DATA UPDATE ────────────────── */
  pushDataPoint(time, ecoEnergy, baselineEnergy, temp, freq, maxTemp) {
    const label = `${time}ms`;
    const MAX   = this.MAX_POINTS;

    // Energy chart
    this.energyChart.data.labels.push(label);
    this.energyChart.data.datasets[0].data.push(+ecoEnergy.toFixed(4));
    this.energyChart.data.datasets[1].data.push(+baselineEnergy.toFixed(4));
    if (this.energyChart.data.labels.length > MAX) {
      this.energyChart.data.labels.shift();
      this.energyChart.data.datasets.forEach(d => d.data.shift());
    }
    this.energyChart.update('none');

    // Thermal chart
    this.thermalChart.data.labels.push(label);
    this.thermalChart.data.datasets[0].data.push(+temp.toFixed(1));
    this.thermalChart.data.datasets[1].data.push(maxTemp);
    if (this.thermalChart.data.labels.length > MAX) {
      this.thermalChart.data.labels.shift();
      this.thermalChart.data.datasets.forEach(d => d.data.shift());
    }
    this.thermalChart.update('none');

    // Freq chart
    this.freqChart.data.labels.push(label);
    this.freqChart.data.datasets[0].data.push(freq);
    this.freqChart.data.datasets[1].data.push(3.2);
    if (this.freqChart.data.labels.length > MAX) {
      this.freqChart.data.labels.shift();
      this.freqChart.data.datasets.forEach(d => d.data.shift());
    }
    this.freqChart.update('none');
  }

  updateCompareChart(values) {
    // values: [ecosched, rr, edf, sjf]
    this.compareChart.data.datasets[0].data = values;
    this.compareChart.update('none');
  }

  /* ────────────────── SPARKLINES ────────────────── */
  updateSparkline(id, points, max) {
    const el = document.getElementById(id);
    if (!el) return;
    const W = 80, H = 30;
    const norm = points.map(p => p / (max || 1));
    const pts  = norm.map((v, i) => `${(i / (norm.length - 1 || 1)) * W},${H - v * (H - 4) - 2}`).join(' ');
    el.setAttribute('points', pts);
  }

  /* ────────────────── CPU DIE ────────────────── */
  updateCPUDie(cores) {
    // cores: [{taskName, freq, active, thermal}]
    cores.forEach((core, i) => {
      const coreEl  = document.getElementById(`core${i}`);
      const taskEl  = document.getElementById(`core${i}Task`);
      const freqEl  = document.getElementById(`core${i}Freq`);
      if (!coreEl) return;
      coreEl.className = 'cpu-core' +
        (core.active ? ' active' : '') +
        (core.thermal ? ' thermal-throttle' : '');
      taskEl.textContent = core.taskName || 'IDLE';
      freqEl.textContent = core.active ? `${core.freq} GHz` : '—';
    });
  }

  /* ────────────────── DVFS PANEL ────────────────── */
  updateDVFSPanel(freq, voltage, voltPct) {
    const freqs = [0.8, 1.2, 1.8, 2.4, 3.2];
    freqs.forEach((f, i) => {
      const el = document.getElementById(`dvfsL${i + 1}`);
      if (!el) return;
      el.classList.toggle('active', Math.abs(f - freq) < 0.01);
    });
    const bar = document.getElementById('voltageBar');
    const val = document.getElementById('voltageVal');
    if (bar) bar.style.width = voltPct + '%';
    if (val) val.textContent = voltage.toFixed(2) + 'V';
  }

  /* ────────────────── THERMAL RING ────────────────── */
  updateThermalRing(temp, pct, color) {
    const arc     = document.getElementById('tempArc');
    const val     = document.getElementById('tempCenterVal');
    const card    = document.getElementById('kpiTempState');
    if (!arc) return;
    const circumference = 201;
    const offset = circumference - (pct / 100) * circumference;
    arc.setAttribute('stroke-dashoffset', offset.toFixed(1));
    arc.setAttribute('stroke', color);
    if (val) { val.textContent = temp.toFixed(1) + '°C'; val.style.color = color; }
    if (card) card.style.color = color;
  }
}

window.VisualizationEngine = VisualizationEngine;
