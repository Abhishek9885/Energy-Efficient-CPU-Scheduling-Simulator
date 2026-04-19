/**
 * EcoSched — Core CPU Scheduling Engine
 * Supports: EcoSched (DVFS + Thermal + Prediction), Round Robin, EDF, SJF
 */

class Task {
  constructor({ id, name, arrivalTime, burstTime, priority, deadline, type }) {
    this.id          = id;
    this.name        = name;
    this.arrivalTime = arrivalTime;
    this.burstTime   = burstTime;       // original burst
    this.remaining   = burstTime;       // remaining burst
    this.priority    = priority;        // 1=highest, 5=lowest
    this.deadline    = deadline;
    this.type        = type;            // 'cpu' | 'io' | 'mixed'

    this.startTime     = null;
    this.finishTime    = null;
    this.waitingTime   = 0;
    this.turnaround    = 0;
    this.deadlineMet   = null;
    this.energyConsumed= 0;     // Track energy per task
    this.execFreqSum   = 0;     // To calculate avg freq
    this.execTicks     = 0;

    // Unique visual color
    this.color = Task.COLORS[id % Task.COLORS.length];
  }

  get isComplete() { return this.remaining <= 0; }

  get completionRatio() {
    return (this.burstTime - this.remaining) / this.burstTime;
  }
}

Task.COLORS = [
  '#00f5c4', '#7c3aed', '#3b82f6', '#f59e0b', '#ef4444',
  '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316',
  '#84cc16', '#e879f9', '#38bdf8', '#fb923c', '#a3e635',
];

/* =============================================
   Scheduler Base Class
   ============================================= */
class Scheduler {
  constructor(tasks, quantum, dvfs, thermal, predictor) {
    this.tasks    = tasks.map(t => new Task(t));
    this.quantum  = quantum;
    this.dvfs     = dvfs;
    this.thermal  = thermal;
    this.predictor= predictor;
    this.time     = 0;
    this.gantt    = [];          // [{taskId, start, end, freq, color}]
    this.completed= [];
    this.readyQueue = [];
    this.log      = [];
    this.done     = false;
    this._nextCheckArrival();
  }

  _nextCheckArrival() {
    // Pull tasks that have arrived
    for (const t of this.tasks) {
      if (!t._queued && t.arrivalTime <= this.time) {
        this.readyQueue.push(t);
        t._queued = true;
        this._log('info', `P${t.id} [${t.name}] arrived at T=${t.arrivalTime}`);
      }
    }
  }

  _log(level, msg) {
    this.log.push({ time: this.time, level, msg });
  }

  _completeTask(task) {
    task.finishTime  = this.time;
    task.turnaround  = task.finishTime - task.arrivalTime;
    task.waitingTime = task.turnaround - task.burstTime;
    task.deadlineMet = task.finishTime <= task.deadline;
    this.completed.push(task);
    this._log(task.deadlineMet ? 'success' : 'warning',
      `P${task.id} [${task.name}] finished. WT=${task.waitingTime}ms, TAT=${task.turnaround}ms, Deadline: ${task.deadlineMet ? 'MET ✓' : 'MISSED ✗'}`
    );
  }

  get stats() {
    const c = this.completed;
    if (!c.length) return {};
    const avgWT  = c.reduce((s,t) => s + t.waitingTime, 0) / c.length;
    const avgTAT = c.reduce((s,t) => s + t.turnaround, 0) / c.length;
    const met    = c.filter(t => t.deadlineMet).length;
    return { avgWT, avgTAT, met, total: this.tasks.length, completed: c.length };
  }

  // To be overridden / extended by subclasses
  step() {}
}

/* =============================================
   Round Robin Scheduler (Baseline)
   ============================================= */
class RoundRobinScheduler extends Scheduler {
  constructor(...args) { super(...args); }

  step() {
    if (this.done) return null;
    this._nextCheckArrival();

    if (!this.readyQueue.length) {
      // Idle
      const nextArrival = this.tasks.filter(t => !t._queued).sort((a,b) => a.arrivalTime - b.arrivalTime)[0];
      if (!nextArrival && !this.readyQueue.length) { this.done = true; return null; }
      const slice = nextArrival ? nextArrival.arrivalTime - this.time : this.quantum;
      const freq = 0.8;
      this.thermal.update(0, freq, slice);
      const energy = this.dvfs.calcEnergy(0.05, slice);
      this.gantt.push({ taskId: -1, name: 'IDLE', start: this.time, end: this.time + slice, freq, color: '#1e293b' });
      this.time += slice;
      this._nextCheckArrival();
      return { idle: true, duration: slice, energy };
    }

    const task = this.readyQueue.shift();
    if (task.startTime === null) task.startTime = this.time;

    const slice = Math.min(this.quantum, task.remaining);
    const freq  = 3.2; // RR always runs at max freq (baseline)
    const util  = task.type === 'io' ? 0.4 : 0.85;
    
    this.thermal.update(util, freq, slice);
    const energy = this.dvfs.calcEnergy(util, slice);

    this.gantt.push({ taskId: task.id, name: task.name, start: this.time, end: this.time + slice, freq, color: task.color });
    this.time     += slice;
    task.remaining -= slice;
    task.energyConsumed += energy;
    task.execFreqSum += freq;
    task.execTicks += 1;

    this._nextCheckArrival();

    if (task.isComplete) {
      this._completeTask(task);
    } else {
      this.readyQueue.push(task);
    }

    if (!this.tasks.some(t => !t.isComplete) && !this.readyQueue.length) this.done = true;
    return { task, slice, freq, energy, reason: `Baseline RR. Max perf Freq=${freq}GHz.` };
  }
}

/* =============================================
   EDF Scheduler
   ============================================= */
class EDFScheduler extends Scheduler {
  step() {
    if (this.done) return null;
    this._nextCheckArrival();

    if (!this.readyQueue.length) {
      const nextArrival = this.tasks.filter(t => !t._queued).sort((a,b) => a.arrivalTime - b.arrivalTime)[0];
      if (!nextArrival && !this.readyQueue.length) { this.done = true; return null; }
      const slice = nextArrival ? nextArrival.arrivalTime - this.time : this.quantum;
      const freq = 0.8;
      this.thermal.update(0, freq, slice);
      const energy = this.dvfs.calcEnergy(0.05, slice);
      this.gantt.push({ taskId: -1, name: 'IDLE', start: this.time, end: this.time + slice, freq, color: '#1e293b' });
      this.time += slice;
      this._nextCheckArrival();
      return { idle: true, duration: slice, energy };
    }

    // Sort by earliest deadline
    this.readyQueue.sort((a,b) => a.deadline - b.deadline);
    const task = this.readyQueue.shift();
    if (task.startTime === null) task.startTime = this.time;

    const slack = task.deadline - this.time - task.remaining;
    const freq  = slack > 10 ? 1.8 : 3.2;
    const util  = task.type === 'io' ? 0.4 : 0.85;
    const slice = Math.min(this.quantum, task.remaining);

    this.thermal.update(util, freq, slice);
    const energy = this.dvfs.calcEnergy(util, slice);

    this.gantt.push({ taskId: task.id, name: task.name, start: this.time, end: this.time + slice, freq, color: task.color });
    this.time     += slice;
    task.remaining -= slice;
    task.energyConsumed += energy;
    task.execFreqSum += freq;
    task.execTicks += 1;
    this._nextCheckArrival();

    if (task.isComplete) { this._completeTask(task); }
    else { this.readyQueue.push(task); }
    if (!this.tasks.some(t => !t.isComplete) && !this.readyQueue.length) this.done = true;
    return { task, slice, freq, energy, reason: `EDF Scheduling. Slack=${slack}ms. Freq=${freq}GHz.` };
  }
}

/* =============================================
   SJF Scheduler (Non-preemptive)
   ============================================= */
class SJFScheduler extends Scheduler {
  step() {
    if (this.done) return null;
    this._nextCheckArrival();

    if (!this.readyQueue.length) {
      const nextArrival = this.tasks.filter(t => !t._queued).sort((a,b) => a.arrivalTime - b.arrivalTime)[0];
      if (!nextArrival && !this.readyQueue.length) { this.done = true; return null; }
      const slice = nextArrival ? nextArrival.arrivalTime - this.time : this.quantum;
      const freq = 0.8;
      this.thermal.update(0, freq, slice);
      const energy = this.dvfs.calcEnergy(0.05, slice);
      this.gantt.push({ taskId: -1, name: 'IDLE', start: this.time, end: this.time + slice, freq, color: '#1e293b' });
      this.time += slice;
      this._nextCheckArrival();
      return { idle: true, duration: slice, energy };
    }

    this.readyQueue.sort((a,b) => a.remaining - b.remaining);
    const task = this.readyQueue.shift();
    if (task.startTime === null) task.startTime = this.time;

    const freq  = task.type === 'io' ? 1.2 : 2.4;
    const util  = task.type === 'io' ? 0.4 : 0.85;
    const slice = task.remaining; // non-preemptive

    this.thermal.update(util, freq, slice);
    const energy = this.dvfs.calcEnergy(util, slice);

    this.gantt.push({ taskId: task.id, name: task.name, start: this.time, end: this.time + slice, freq, color: task.color });
    this.time     += slice;
    task.remaining = 0;
    task.energyConsumed += energy;
    task.execFreqSum += freq;
    task.execTicks += 1;
    this._nextCheckArrival();
    this._completeTask(task);
    if (!this.tasks.some(t => !t.isComplete) && !this.readyQueue.length) this.done = true;
    return { task, slice, freq, energy, reason: `SJF (Non-preemptive). Task Type=${task.type}. Freq=${freq}GHz.` };
  }
}

/* =============================================
   EcoSched — Energy Efficient Scheduler
   Integrates: DVFS + Thermal-Aware + Workload Prediction
   ============================================= */
class EcoScheduler extends Scheduler {
  constructor(tasks, quantum, dvfs, thermal, predictor) {
    super(tasks, quantum, dvfs, thermal, predictor);
    this.energyLog = [];    // [{time, energy}]
    this.thermalLog= [];    // [{time, temp}]
    this.freqLog   = [];    // [{time, freq}]
    this._thermalThrottleCount = 0;
  }

  step() {
    if (this.done) return null;
    this._nextCheckArrival();

    if (!this.readyQueue.length) {
      const nextArrival = this.tasks.filter(t => !t._queued).sort((a,b) => a.arrivalTime - b.arrivalTime)[0];
      if (!nextArrival && !this.readyQueue.length) { this.done = true; return null; }
      const slice = nextArrival ? nextArrival.arrivalTime - this.time : this.quantum;
      
      // CPU in idle — cool down, low freq
      this.dvfs.setUtil(0);
      this.thermal.update(0, this.dvfs.freq, slice);
      const energy = this.dvfs.calcEnergy(0.05, slice);
      this.energyLog.push({ time: this.time, energy });
      this.thermalLog.push({ time: this.time, temp: this.thermal.temp });
      this.freqLog.push({ time: this.time, freq: this.dvfs.freq });

      this.gantt.push({ taskId: -1, name: 'IDLE', start: this.time, end: this.time + slice, freq: this.dvfs.freq, color: '#1e293b' });
      this.time += slice;
      this._log('info', `CPU idle for ${slice}ms — T=${this.thermal.temp.toFixed(1)}°C`);
      this._nextCheckArrival();
      return { idle: true, duration: slice };
    }

    // --- Priority Selection with Thermal Awareness ---
    // Sort by: (1) priority, (2) earliest deadline, (3) smallest remaining
    this.readyQueue.sort((a,b) => {
      // If thermal throttle is active, prefer I/O bound tasks
      if (this.thermal.isThrottling) {
        if (a.type === 'io' && b.type !== 'io') return -1;
        if (b.type === 'io' && a.type !== 'io') return  1;
      }
      // Primary: priority (lower number = higher priority)
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Secondary: deadline urgency
      const slackA = a.deadline - this.time - a.remaining;
      const slackB = b.deadline - this.time - b.remaining;
      if (Math.abs(slackA - slackB) > 5) return slackA - slackB;
      // Tertiary: burst remaining
      return a.remaining - b.remaining;
    });

    const task = this.readyQueue.shift();
    if (task.startTime === null) task.startTime = this.time;

    // --- Workload Prediction ---
    const predictedUtil = this.predictor.predict(this.readyQueue.length + 1, task.type);
    const actualUtil    = this._calcUtil(task);

    // --- DVFS Decision ---
    const slack = task.deadline - this.time - task.remaining;
    const freq  = this.dvfs.decideFreq({
      util: actualUtil,
      predictedUtil,
      slack,
      taskType: task.type,
      isThermalThrottle: this.thermal.isThrottling
    });

    // Quantum with thermal consideration
    let slice = Math.min(this.quantum, task.remaining);
    let reason = '';
    if (this.thermal.isThrottling) {
      slice = Math.min(slice, Math.max(1, Math.floor(slice * 0.6)));
      this._thermalThrottleCount++;
      reason = `Thermal T=${this.thermal.temp.toFixed(1)}°C. Qt↓. `;
      this._log('warning', `THERMAL THROTTLE! T=${this.thermal.temp.toFixed(1)}°C — reduced quantum for P${task.id}`);
    } else {
      reason = `T=${this.thermal.temp.toFixed(1)}°C OK. `;
    }

    // Update thermal model
    this.thermal.update(actualUtil, freq, slice);

    // Calculate energy for this slice
    const energy = this.dvfs.calcEnergy(actualUtil, slice);
    this.energyLog.push({ time: this.time, energy });
    this.thermalLog.push({ time: this.time, temp: this.thermal.temp });
    this.freqLog.push({ time: this.time, freq });

    // Track task specifics
    task.energyConsumed += energy;
    task.execFreqSum += freq;
    task.execTicks += 1;

    // Update predictor
    this.predictor.update(actualUtil);

    this.gantt.push({
      taskId: task.id, name: task.name,
      start: this.time, end: this.time + slice,
      freq, color: task.color,
      thermal: this.thermal.isThrottling
    });

    reason += `PredUtil=${(predictedUtil*100).toFixed(0)}%. Set Freq=${freq}GHz.`;

    this._log('dvfs', `DVFS: P${task.id} @ ${freq.toFixed(1)}GHz, Util=${(actualUtil*100).toFixed(0)}%, T=${this.thermal.temp.toFixed(1)}°C`);

    this.time      += slice;
    task.remaining -= slice;
    this._nextCheckArrival();

    if (task.isComplete) {
      this._completeTask(task);
      reason += ' Task Finished ✓';
    } else {
      this.readyQueue.push(task);
    }

    if (!this.tasks.some(t => !t.isComplete) && !this.readyQueue.length) this.done = true;
    return { task, slice, freq, energy, temp: this.thermal.temp, predictedUtil, actualUtil, reason };
  }

  _calcUtil(task) {
    // CPU-bound tasks drive high utilization, I/O less so
    const base = { cpu: 0.85, io: 0.35, mixed: 0.6 }[task.type] || 0.7;
    // Add variance
    return Math.min(1, Math.max(0.1, base + (Math.random() - 0.5) * 0.2));
  }

  get totalEnergy() {
    return this.energyLog.reduce((s, e) => s + e.energy, 0);
  }
}

// Export
window.Task          = Task;
window.EcoScheduler  = EcoScheduler;
window.RoundRobinScheduler = RoundRobinScheduler;
window.EDFScheduler  = EDFScheduler;
window.SJFScheduler  = SJFScheduler;
