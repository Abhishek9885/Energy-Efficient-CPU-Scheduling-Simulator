/**
 * EcoSched — DVFS (Dynamic Voltage & Frequency Scaling) Module
 * Power model: P = C_eff * V^2 * f
 * Energy = P * t
 */

class DVFSController {
  constructor() {
    // Available P-states (freq in GHz, voltage in V, power base in W)
    this.pStates = [
      { freq: 0.8,  voltage: 0.80, activePower: 4.0,  idlePower: 0.5 },
      { freq: 1.2,  voltage: 0.90, activePower: 7.5,  idlePower: 0.8 },
      { freq: 1.8,  voltage: 1.00, activePower: 13.0, idlePower: 1.2 },
      { freq: 2.4,  voltage: 1.10, activePower: 22.0, idlePower: 1.8 },
      { freq: 3.2,  voltage: 1.25, activePower: 38.0, idlePower: 2.5 },
    ];

    this.currentStateIdx = 0;  // Start at lowest P-state
    this.util            = 0;
    this.freqHistory     = [];
    this.utilHistory     = [];
    this._transitionOverhead = 0.001; // 1ms transition energy cost
  }

  get currentState() { return this.pStates[this.currentStateIdx]; }
  get freq()         { return this.currentState.freq; }
  get voltage()      { return this.currentState.voltage; }
  get activePower()  { return this.currentState.activePower; }

  setUtil(util) {
    this.util = Math.max(0, Math.min(1, util));
    this.utilHistory.push(util);
  }

  
  decideFreq({ util, predictedUtil, slack, taskType, isThermalThrottle }) {
    const prevIdx = this.currentStateIdx;

  
    const blendedUtil = 0.6 * util + 0.4 * predictedUtil;

   
    let targetIdx;
    if      (blendedUtil < 0.20) targetIdx = 0;  // 0.8 GHz
    else if (blendedUtil < 0.40) targetIdx = 1;  // 1.2 GHz
    else if (blendedUtil < 0.60) targetIdx = 2;  // 1.8 GHz
    else if (blendedUtil < 0.80) targetIdx = 3;  // 2.4 GHz
    else                         targetIdx = 4;  // 3.2 GHz


    if (slack > 30) {
      targetIdx = Math.max(0, targetIdx - 2);
    } else if (slack > 15) {
      targetIdx = Math.max(0, targetIdx - 1);
    } else if (slack < 5) {
      // Urgent — boost frequency
      targetIdx = Math.min(4, targetIdx + 1);
    }

    
    if (taskType === 'io') {
      targetIdx = Math.max(0, targetIdx - 1);
    } else if (taskType === 'cpu') {
      // cpu specific adjustment can go here
    }

    if (isThermalThrottle) {
      targetIdx = Math.max(0, Math.min(1, targetIdx));
    }


    if (targetIdx > this.currentStateIdx) {
      this.currentStateIdx = targetIdx;
    } else if (targetIdx < this.currentStateIdx) {
      this.currentStateIdx = Math.max(targetIdx, this.currentStateIdx - 1);
    }

    this.freqHistory.push(this.freq);
    return this.freq;
  }

 
  calcEnergy(util, timeMs) {
    const s = this.currentState;
    const activeFraction = util;
    const idleFraction   = 1 - util;
    const power = s.activePower * activeFraction + s.idlePower * idleFraction;
    const energyJ = power * (timeMs / 1000);
    // Add transition overhead if state changed
    return energyJ + this._transitionOverhead;
  }

  /**
   * Calculate baseline energy (max frequency, no DVFS)
   */
  calcBaselineEnergy(util, timeMs) {
    const s = this.pStates[4]; // Max P-state
    const power = s.activePower * util + s.idlePower * (1 - util);
    return power * (timeMs / 1000);
  }

  get voltagePercent() {
    const min = this.pStates[0].voltage;
    const max = this.pStates[4].voltage;
    return ((this.voltage - min) / (max - min)) * 100;
  }

  getStateLabel() {
    const labels = ['Power-Saver', 'Efficient', 'Balanced', 'Performance', 'Turbo'];
    return labels[this.currentStateIdx];
  }
}

window.DVFSController = DVFSController;
