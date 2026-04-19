/**
 * EcoSched — Workload Prediction Module
 * Uses EWMA (Exponentially Weighted Moving Average) for utilization prediction
 * Also maintains a lightweight history window for burst pattern detection
 */

class WorkloadPredictor {
  constructor() {
    this.alpha         = 0.3;    // EWMA smoothing factor (0=slow, 1=reactive)
    this.ewma          = 0.5;    // Initial prediction
    this.history       = [];     // Raw utilization history
    this.predictions   = [];     // Predicted values
    this.windowSize    = 10;     // Window for pattern detection

    // Task-type biases (I/O tasks have more bursty patterns)
    this.typeBias = { cpu: 0.0, io: -0.15, mixed: -0.05 };
  }

  /**
   * Predict next utilization
   * @param {number} queueLen — current ready queue length
   * @param {string} taskType — 'cpu' | 'io' | 'mixed'
   */
  predict(queueLen, taskType = 'cpu') {
    // Base EWMA prediction
    let pred = this.ewma;

    // Queue pressure adjustment
    const queuePressure = Math.min(0.3, queueLen * 0.05);
    pred = Math.min(1, pred + queuePressure);

    // Task type adjustment
    pred = Math.max(0.05, pred + (this.typeBias[taskType] || 0));

    // Pattern detection: detect periodic bursts in window
    if (this.history.length >= this.windowSize) {
      const window = this.history.slice(-this.windowSize);
      const trend  = this._linearTrend(window);
      pred = Math.min(1, Math.max(0.05, pred + trend * 0.1));
    }

    this.predictions.push(pred);
    return pred;
  }

  /**
   * Update predictor with actual observed utilization
   */
  update(actualUtil) {
    // EWMA update: S_t = α * x_t + (1-α) * S_{t-1}
    this.ewma = this.alpha * actualUtil + (1 - this.alpha) * this.ewma;
    this.history.push(actualUtil);

    // Trim history to prevent memory unbounded growth
    if (this.history.length > 100) {
      this.history.shift();
      this.predictions.shift();
    }
  }

  /**
   * Calculate linear trend slope over window
   */
  _linearTrend(window) {
    const n = window.length;
    if (n < 2) return 0;
    const xMean = (n - 1) / 2;
    const yMean = window.reduce((a,b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (window[i] - yMean);
      den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  /**
   * Get recent prediction pairs for visualization
   */
  getRecentWindow(size = 8) {
    const len = Math.max(this.history.length, this.predictions.length);
    const start = Math.max(0, len - size);
    const result = [];
    for (let i = start; i < len; i++) {
      result.push({
        actual:    this.history[i]     ?? null,
        predicted: this.predictions[i] ?? null,
      });
    }
    return result;
  }

  get accuracy() {
    const pairs = this.history.map((actual, i) => ({
      actual, predicted: this.predictions[i] ?? this.ewma
    })).filter(p => p.predicted !== null);
    if (!pairs.length) return 100;
    const mse = pairs.reduce((s, p) => s + (p.actual - p.predicted) ** 2, 0) / pairs.length;
    return Math.max(0, Math.round((1 - Math.sqrt(mse)) * 100));
  }
}

window.WorkloadPredictor = WorkloadPredictor;
