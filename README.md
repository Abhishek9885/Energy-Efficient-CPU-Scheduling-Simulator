# ⚡ EcoSched — Energy Efficient CPU Scheduling Simulator

> **OS Project** | Energy Efficient CPU Scheduling Algorithm  
> Integrates **DVFS**, **Thermal-Aware Scheduling**, and **EWMA Workload Prediction**

---

## 📌 Project Description

Develop a CPU scheduling algorithm that reduces energy consumption without compromising performance. The design integrates **Dynamic Voltage and Frequency Scaling (DVFS)**, **thermal-aware scheduling**, and **workload prediction** to optimize task placement and execution.

---

## 🏗️ Architecture

```
OS project/
├── index.html              # Interactive simulation dashboard (SPA)
├── css/
│   └── style.css           # Dark-theme design system
├── js/
│   ├── scheduler.js        # Scheduling engine (EcoSched, RR, EDF, SJF)
│   ├── dvfs.js             # DVFS controller & power model
│   ├── thermal.js          # RC thermal model & throttle detection
│   ├── prediction.js       # EWMA workload predictor
│   ├── visualization.js    # Gantt canvas, Chart.js charts, CPU die UI
│   └── app.js              # Main controller & simulation loop
└── README.md
```

---

## 🔬 Algorithm Details

### 1. EcoSched (Proposed Algorithm)

The core scheduler combines three subsystems:

#### A. DVFS Controller (`dvfs.js`)
- **5 P-States**: 0.8 GHz → 3.2 GHz (voltage: 0.80V → 1.25V)
- **Power Model**: `P = C_eff × V² × f`
- **Energy per slice**: `E = (P_active × util + P_idle × (1-util)) × Δt`
- **Frequency Decision Factors**:
  - CPU utilization (blended: 60% actual + 40% predicted)
  - Deadline slack reclamation (slow down if slack > 30ms)
  - Task type bias (I/O-bound → lower freq for memory-stall phases)
  - Hysteresis to prevent frequency oscillation

#### B. Thermal-Aware Scheduler (`thermal.js`)
- **RC Thermal Model**: `ΔT = (TDP × util − cooling_factor × ΔT_ambient) / C_thermal`
- Throttle triggers at configurable threshold (default: 80°C)
- Under throttle: prefers I/O-bound tasks, reduces quantum by 40%
- Logs all throttle events in the scheduler log

#### C. Workload Predictor (`prediction.js`)
- **EWMA**: `S_t = α × x_t + (1−α) × S_{t−1}` (α = 0.3)
- Queue pressure signal: `+5% per queued task`
- Task-type biases: CPU-bound (+0%), I/O-bound (−15%), Mixed (−5%)
- Linear trend detection over sliding window of 10 samples

#### D. Priority & Task Selection
Tasks are sorted by:
1. Thermal state (I/O-bound tasks preferred under throttle)
2. Priority level (1 = highest)
3. Deadline urgency (earliest deadline first)
4. Remaining burst time (shortest first)

---

### 2. Baseline Algorithms (for comparison)

| Algorithm | Frequency | Energy |
|-----------|-----------|--------|
| Round Robin | Always max (3.2 GHz) | Highest (~1.45× EcoSched) |
| EDF | Slack-aware (1.8 or 3.2 GHz) | Medium (~1.10× EcoSched) |
| SJF | Type-aware (1.2 or 2.4 GHz) | Medium-High (~1.25× EcoSched) |

---

## 📊 Visualization Dashboard

| Panel | Description |
|-------|-------------|
| **Gantt Chart** | Real-time task timeline with freq labels & throttle indicators |
| **CPU Die** | 4-core visualization showing active tasks & frequencies |
| **DVFS Panel** | Active P-state with voltage bar |
| **Prediction Bars** | Actual vs predicted utilization (EWMA) |
| **Energy Chart** | EcoSched vs baseline energy over time |
| **Thermal Chart** | CPU temperature with throttle threshold line |
| **Frequency Chart** | Dynamic frequency scaling over time |
| **Comparison Chart** | Bar chart of energy across all 4 algorithms |
| **Ready Queue** | Live queue with remaining burst times |
| **Scheduler Log** | Timestamped events: DVFS changes, completions, throttles |

---

## 🚀 How to Run

Just open `index.html` in any modern browser (Chrome, Edge, Firefox):

```
Double-click index.html  →  Browser opens  →  Press ▶ Run Simulation
```

No server, no build step, no dependencies to install.

---

## 🎮 Interactive Controls

- **Add Task** — Define custom processes (name, burst, priority, deadline, type)
- **Algorithm** — Switch between EcoSched / Round Robin / EDF / SJF
- **Time Quantum** — 1–20ms (affects preemption frequency)
- **Max Temperature** — Set thermal throttle threshold (60–100°C)
- **Sim Speed** — 1×–5× simulation playback speed
- **Pause / Resume / Reset** — Full simulation control

---

## 📐 Power & Energy Model

```
Dynamic Power:   Pdyn = Ceff × V² × f
Static Power:    Pstat = Ileakage × V
Total Power:     P = Pdyn + Pstat

Energy per quantum:
  E = (P_active × util + P_idle × (1 − util)) × t_ms / 1000  [Joules]

P-State Table:
  Level   Freq    Voltage  Active Power  Idle Power
  0       0.8GHz  0.80V    4.0W          0.5W
  1       1.2GHz  0.90V    7.5W          0.8W
  2       1.8GHz  1.00V    13.0W         1.2W
  3       2.4GHz  1.10V    22.0W         1.8W
  4       3.2GHz  1.25V    38.0W         2.5W
```

---

## 📈 Expected Results

- **Energy Savings**: ~30–45% over Round Robin baseline
- **Thermal Events**: Reduced throttle occurrences due to proactive freq scaling
- **Deadline Miss Rate**: <5% at default settings
- **Prediction Accuracy**: ~85–92% (EWMA with trend correction)

---

## 👨‍💻 Technologies Used

- **Vanilla JavaScript (ES6+)** — Scheduling logic, simulation engine
- **HTML5 Canvas** — Gantt chart rendering
- **Chart.js 4.4** — Line & bar charts
- **CSS Variables + Glassmorphism** — Dark-theme UI
- **Google Fonts (Inter + JetBrains Mono)** — Typography

---

## 📚 References

1. Yao, F., et al. *"A scheduling model for reduced CPU energy."* FOCS 1995.
2. Pillai, P., Shin, K. G. *"Real-time dynamic voltage scaling."* SOSP 2001.
3. Linux kernel `cpufreq` governor documentation.
4. ARM big.LITTLE Architecture Reference Manual.
5. Intel RAPL (Running Average Power Limit) documentation.
