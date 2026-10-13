/**
 * LiveSense AI - Edge-AI Mastitis Detection Dashboard
 * Client-Side Interactive Engine & Dynamic Telemetry
 */

// State
let allCows = [];
let currentFilter = 'all';
let currentBreed = null;
let searchQuery = '';
let currentSort = 'risk-desc';
let isCompactView = false;
let selectedCowData = null;

// Oscilloscope state & buffers
const BUFFER_SIZE = 140;
let waveBuffer = [];
let phase = 0;
let isStreamingActive = true;
let animFrameId = null;
let streamSpeed = 1.0;
let currentScenario = 'rumination'; // 'rumination', 'mastitis', 'resting', 'walking'
let activeAxes = { x: true, y: true, z: true, mag: true };

// System Uptime & Clock
let uptimeSeconds = 14 * 86400 + 8 * 3600 + 22 * 60; // 14d 8h 22m

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initLiveClock();
  initNavigation();
  initControls();
  initOscilloscope();
  initCvaePlayground();
  initModalInteractions();
  fetchStatusAndHerd();
});

/* ==========================================================================
   Toast Notification System
   ========================================================================== */
function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'alert') icon = '🚨';
  if (type === 'success') icon = '✅';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

/* ==========================================================================
   Live System Clock & Edge Uptime
   ========================================================================== */
function initLiveClock() {
  const clockEl = document.getElementById('liveClockDisplay');
  const uptimeEl = document.getElementById('uptimeDisplay');

  function updateClock() {
    const now = new Date();
    // Format in IST
    const timeStr = now.toLocaleTimeString('en-IN', { hour12: false });
    if (clockEl) clockEl.textContent = `IST ${timeStr}`;

    uptimeSeconds++;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    if (uptimeEl) uptimeEl.textContent = `Uptime: ${days}d ${hours}h ${mins}m`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}

/* ==========================================================================
   Navigation Tabs
   ========================================================================== */
function initNavigation() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const sections = document.querySelectorAll('.view-section');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      
      tabBtns.forEach(b => b.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));

      btn.classList.add('active');
      const targetSection = document.getElementById(targetId);
      if (targetSection) targetSection.classList.add('active');

      if (targetId === 'tab-telemetry') {
        resizeOscilloscope();
      }
    });
  });

  // Modal Close
  const closeBtn = document.getElementById('closeModalBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  const modal = document.getElementById('cowDetailModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'cowDetailModal') closeModal();
    });
  }
}

/* ==========================================================================
   Smooth Counter Animation (countUp)
   ========================================================================== */
function animateCountUp(element, target, prefix = '', suffix = '', duration = 1200) {
  if (!element) return;
  const start = 0;
  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Easing out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentVal = Math.round(start + (target - start) * easeProgress);

    element.textContent = `${prefix}${currentVal.toLocaleString()}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

/* ==========================================================================
   Fetch Initial Status & Herd Telemetry
   ========================================================================== */
async function fetchStatusAndHerd() {
  try {
    // 1. Fetch System Status
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    
    // Animate KPI Numbers
    animateCountUp(document.getElementById('kpiTotalCows'), statusData.herd_metrics.total_cows);
    animateCountUp(document.getElementById('kpiMastitisCount'), statusData.herd_metrics.mastitis_detected);
    animateCountUp(document.getElementById('kpiHealthyCount'), statusData.herd_metrics.healthy);
    animateCountUp(document.getElementById('kpiSavings'), statusData.herd_metrics.loss_prevented_inr, '₹');
    
    document.getElementById('latencyDisplay').textContent = statusData.system.inference_latency_ms + ' ms';
    document.getElementById('badgeTotalHerd').textContent = statusData.herd_metrics.total_cows;

    // 2. Fetch Cattle Roster
    const herdRes = await fetch('/api/cows');
    allCows = await herdRes.json();
    renderHerdGrid();

  } catch (err) {
    console.error('Failed to load herd telemetry:', err);
    showToast('Failed to connect to edge node telemetry', 'alert');
  }
}

/* ==========================================================================
   Herd Filters, Search & Sort
   ========================================================================== */
function initControls() {
  // Filter chips
  const filterChips = document.querySelectorAll('.filter-chip[data-filter], .filter-chip[data-breed]');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      if (chip.dataset.filter) {
        currentFilter = chip.dataset.filter;
        currentBreed = null;
        if (currentFilter === 'mastitis_detected') {
          showToast('Filtering for flagged Subclinical Mastitis alerts (32 cows)', 'alert');
        }
      } else if (chip.dataset.breed) {
        currentFilter = 'all';
        currentBreed = chip.dataset.breed;
        showToast(`Filtered by ${currentBreed} cattle breed`, 'info');
      }
      renderHerdGrid();
    });
  });

  // Search input
  const searchInput = document.getElementById('herdSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';
      renderHerdGrid();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearBtn.style.display = 'none';
      renderHerdGrid();
    });
  }

  // Sort dropdown
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderHerdGrid();
    });
  }

  // Toggle View Density (Compact vs Detailed)
  const densityBtn = document.getElementById('viewDensityBtn');
  if (densityBtn) {
    densityBtn.addEventListener('click', () => {
      isCompactView = !isCompactView;
      const grid = document.getElementById('herdCardsContainer');
      const icon = document.getElementById('densityIcon');
      const label = document.getElementById('densityLabel');

      if (isCompactView) {
        grid.classList.add('compact-view');
        icon.textContent = '▦';
        label.textContent = 'Detailed';
        showToast('Switched to Compact View', 'info', 2000);
      } else {
        grid.classList.remove('compact-view');
        icon.textContent = '⊞';
        label.textContent = 'Compact';
        showToast('Switched to Detailed View', 'info', 2000);
      }
    });
  }
}

function renderHerdGrid() {
  const container = document.getElementById('herdCardsContainer');
  container.innerHTML = '';

  let filtered = allCows.filter(cow => {
    // Status filter
    if (currentFilter !== 'all' && cow.status !== currentFilter) return false;
    // Breed filter
    if (currentBreed && cow.breed !== currentBreed) return false;
    // Search filter
    if (searchQuery) {
      const match = cow.name.toLowerCase().includes(searchQuery) ||
                    cow.tag.toLowerCase().includes(searchQuery) ||
                    cow.collar_id.toLowerCase().includes(searchQuery) ||
                    cow.breed.toLowerCase().includes(searchQuery) ||
                    cow.pen.toLowerCase().includes(searchQuery);
      if (!match) return false;
    }
    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    if (currentSort === 'risk-desc') return b.probability - a.probability;
    if (currentSort === 'risk-asc') return a.probability - b.probability;
    if (currentSort === 'yield-asc') return a.daily_yield_liters - b.daily_yield_liters;
    if (currentSort === 'yield-desc') return b.daily_yield_liters - a.daily_yield_liters;
    if (currentSort === 'tag-asc') return a.id - b.id;
    return 0;
  });

  // Update match count badge
  const matchBadge = document.getElementById('matchBadge');
  if (matchBadge) {
    matchBadge.textContent = `Showing ${filtered.length} of ${allCows.length} cows`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔍</div>
        <div style="font-size: 1.1rem; font-weight: 700;">No cattle matched your search</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.35rem;">Try clearing your query "${searchQuery}" or adjusting filter chips.</div>
      </div>
    `;
    return;
  }

  filtered.forEach((cow, idx) => {
    const isAlert = cow.status === 'mastitis_detected';
    const card = document.createElement('div');
    card.className = `cow-card ${isAlert ? 'alert-card' : 'healthy-card'}`;
    card.style.animationDelay = `${Math.min(idx * 0.03, 0.4)}s`;

    const probPct = Math.round(cow.probability * 100);
    const riskColor = probPct >= 50 ? '#f43f5e' : (probPct >= 20 ? '#fb7185' : '#10b981');
    const badgeHtml = isAlert 
      ? `<span class="status-badge status-alert">⚠️ SCM Alert (${probPct}%)</span>`
      : `<span class="status-badge status-healthy">🟢 Healthy</span>`;

    // Generate mini sparkline SVG for rumination trend
    const sparklineSvg = generateMiniSparkline(isAlert, cow.id);

    card.innerHTML = `
      <div>
        <div class="card-top">
          <div class="cow-identity">
            <div class="cow-avatar ${isAlert ? 'avatar-alert' : ''}">
              ${isAlert ? '<span class="avatar-pulse-ring"></span>' : ''}
              ${isAlert ? '🚨' : '🐄'}
            </div>
            <div>
              <div class="cow-name">${cow.name} <span style="font-size: 0.8rem; font-weight: 600; color: var(--accent-cyan); font-family: var(--font-mono);">#${cow.tag}</span></div>
              <div class="cow-meta">${cow.breed} • ${cow.pen} • Collar ${cow.collar_id}</div>
            </div>
          </div>
          <div>${badgeHtml}</div>
        </div>

        <div class="risk-meter-container">
          <div class="risk-label-row">
            <span class="risk-title">Subclinical Mastitis Risk</span>
            <span class="risk-pct" style="color: ${riskColor};">${(cow.probability * 100).toFixed(1)}%</span>
          </div>
          <div class="risk-track">
            <div class="risk-fill" style="width: ${Math.max(6, probPct)}%; background: ${riskColor};"></div>
          </div>
        </div>

        <!-- 7-Day Rumination Sparkline -->
        <div class="card-sparkline-row">
          <span>7-Day Rumination Curve:</span>
          ${sparklineSvg}
        </div>

        <div class="behavior-stats-row">
          <div>
            <div class="stat-item-label">Rumination</div>
            <div class="stat-item-val">${cow.rumination_avg_min_hr} m/h</div>
          </div>
          <div>
            <div class="stat-item-label">Lying Time</div>
            <div class="stat-item-val">${cow.lying_avg_min_hr} m/h</div>
          </div>
          <div>
            <div class="stat-item-label">Milk Yield</div>
            <div class="stat-item-val" style="${isAlert ? 'color: #fb7185; font-weight: 800;' : ''}">${cow.daily_yield_liters} L/d</div>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <div>🔋 ${cow.battery}% • ${cow.signal_rssi} dBm</div>
        <div class="card-actions-group">
          <button class="quick-stream-btn" title="Simulate 10Hz collar waveform for this cow" onclick="event.stopPropagation(); simulateCowStream('${cow.name}', ${isAlert})">
            📡 Live Wave
          </button>
          <button class="view-detail-btn" onclick="event.stopPropagation(); openCowDetail(${cow.id})">
            <span>7-Day Kinetics</span>
            <span>→</span>
          </button>
        </div>
      </div>
    `;

    card.onclick = () => openCowDetail(cow.id);
    container.appendChild(card);
  });
}

// Generate inline mini SVG sparkline
function generateMiniSparkline(isAlert, seed) {
  const points = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    let val;
    if (isAlert) {
      // Steady at first, then sharp dip in last few days (classic mastitis rumination drop)
      val = i < 6 ? 16 + Math.sin(i + seed) * 3 : 5 + Math.sin(i) * 2;
    } else {
      // Normal stable diurnal oscillation
      val = 14 + Math.sin((i + seed) * 1.5) * 4;
    }
    points.push(val);
  }

  const w = 110;
  const h = 22;
  const max = 22;
  const min = 2;
  const coords = points.map((p, i) => {
    const x = (i / (count - 1)) * w;
    const y = h - ((p - min) / (max - min)) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const strokeColor = isAlert ? '#fb7185' : '#34d399';
  return `
    <svg class="card-sparkline-svg" viewBox="0 0 ${w} ${h}">
      <polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${coords}" />
    </svg>
  `;
}

// Quick trigger from card to 10Hz Oscilloscope
function simulateCowStream(cowName, isAlert) {
  // Switch to Telemetry Tab
  const telemetryTabBtn = document.getElementById('navTelemetryBtn');
  if (telemetryTabBtn) telemetryTabBtn.click();

  // Select corresponding scenario
  const scenarioKey = isAlert ? 'mastitis' : 'rumination';
  setOscilloscopeScenario(scenarioKey);

  showToast(`Streaming 10Hz Collar feed for ${cowName} (${isAlert ? 'SCM Flagged' : 'Healthy'})`, isAlert ? 'alert' : 'info');
}

/* ==========================================================================
   10Hz Collar Telemetry Oscilloscope (Tab 2)
   ========================================================================== */
function initOscilloscope() {
  const toggleBtn = document.getElementById('toggleLiveStreamBtn');

  // Populate initial wave buffer
  for (let i = 0; i < BUFFER_SIZE; i++) {
    waveBuffer.push(generateKinematicPoint(i * 0.1));
  }

  // Toggle Stream Button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isStreamingActive = !isStreamingActive;
      const statusText = document.getElementById('streamStatusText');
      
      toggleBtn.textContent = isStreamingActive ? '⏸️ Pause Stream' : '▶️ Resume Stream';
      toggleBtn.style.color = isStreamingActive ? 'var(--accent-cyan)' : 'var(--accent-amber)';
      if (statusText) {
        statusText.textContent = isStreamingActive ? 'STREAMING 10 FPS' : 'PAUSED';
        statusText.style.color = isStreamingActive ? 'var(--accent-emerald)' : 'var(--accent-amber)';
      }
      showToast(isStreamingActive ? 'Oscilloscope stream resumed' : 'Oscilloscope stream paused', 'info', 2000);
    });
  }

  // Scenario Buttons
  const scenBtns = document.querySelectorAll('.scenario-btn[data-scenario]');
  scenBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      scenBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setOscilloscopeScenario(btn.dataset.scenario);
    });
  });

  // Speed Buttons
  const speedBtns = document.querySelectorAll('.speed-btn[data-speed]');
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      streamSpeed = parseFloat(btn.dataset.speed);
      showToast(`Stream speed set to ${streamSpeed}x`, 'info', 1800);
    });
  });

  // Trace toggles in legend
  const legendItems = document.querySelectorAll('.legend-item.toggleable[data-axis]');
  legendItems.forEach(item => {
    item.addEventListener('click', () => {
      const axis = item.dataset.axis;
      activeAxes[axis] = !activeAxes[axis];
      item.classList.toggle('active', activeAxes[axis]);
      item.style.opacity = activeAxes[axis] ? '1' : '0.4';
    });
  });

  // Render Loop
  function renderLoop() {
    if (isStreamingActive) {
      phase += 0.1 * streamSpeed;
      waveBuffer.shift();
      const newPt = generateKinematicPoint(phase);
      waveBuffer.push(newPt);
      updateOscilloscopeHud(newPt);
      drawOscilloscope();
    }
    animFrameId = requestAnimationFrame(renderLoop);
  }

  renderLoop();
}

function setOscilloscopeScenario(scenario) {
  currentScenario = scenario;
  const stateLabel = document.getElementById('liveBehaviorState');
  const scenBtns = document.querySelectorAll('.scenario-btn[data-scenario]');

  scenBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.scenario === scenario);
  });

  if (scenario === 'rumination') {
    if (stateLabel) stateLabel.textContent = 'Active Rumination (Chewing Bolus • 1.1 Hz Rhythm)';
  } else if (scenario === 'mastitis') {
    if (stateLabel) {
      stateLabel.textContent = '🚨 SCM Acute Pain Agitation (Chaotic Lateral Jerks & Incline Shifts)';
      stateLabel.style.color = '#fb7185';
    }
  } else if (scenario === 'resting') {
    if (stateLabel) {
      stateLabel.textContent = '💤 Stable Resting / Lying Sternal Posture (Low Dynamic Acceleration)';
      stateLabel.style.color = 'var(--accent-emerald)';
    }
  } else if (scenario === 'walking') {
    if (stateLabel) {
      stateLabel.textContent = '🚶 Active Grazing & Herd Locomotion (1.8 Hz Periodic Strides)';
      stateLabel.style.color = '#fbbf24';
    }
  }
}

function generateKinematicPoint(t) {
  let ax = 0, ay = 0.82, az = 0.32;

  if (currentScenario === 'rumination') {
    // Regular cyclic chewing (1.1 Hz) + gentle neck sway
    const chew = Math.sin(t * 6.9) * 0.42;
    const sway = Math.cos(t * 1.3) * 0.25;
    ax = sway + chew + (Math.random() - 0.5) * 0.08;
    ay = 0.82 + Math.sin(t * 0.8) * 0.1 + (Math.random() - 0.5) * 0.05;
    az = 0.32 + Math.cos(t * 6.9) * 0.22 + (Math.random() - 0.5) * 0.06;

  } else if (currentScenario === 'mastitis') {
    // Sporadic chaotic jerks (pain twitches) + restless posture shifts
    const jerk = (Math.sin(t * 14.5) > 0.6 ? 1.2 : 0) * (Math.random() * 0.6);
    const instability = Math.sin(t * 3.2) * 0.55;
    ax = instability + jerk + (Math.random() - 0.5) * 0.35;
    ay = 0.65 + Math.cos(t * 2.1) * 0.35 + (Math.random() - 0.5) * 0.2;
    az = 0.45 + jerk * 1.3 + (Math.random() - 0.5) * 0.3;

  } else if (currentScenario === 'resting') {
    // Very flat baseline, mainly static gravity vector
    ax = 0.08 + (Math.random() - 0.5) * 0.03;
    ay = 0.96 + (Math.random() - 0.5) * 0.02; // Gravitational vertical
    az = 0.12 + (Math.random() - 0.5) * 0.03;

  } else if (currentScenario === 'walking') {
    // Periodic stride peaks (1.8 Hz)
    const stride = Math.sin(t * 11.3) * 0.75;
    ax = stride + (Math.random() - 0.5) * 0.12;
    ay = 0.85 + Math.abs(Math.sin(t * 11.3)) * 0.4 + (Math.random() - 0.5) * 0.08;
    az = 0.3 + Math.cos(t * 11.3) * 0.4 + (Math.random() - 0.5) * 0.1;
  }

  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  return { ax, ay, az, mag };
}

function updateOscilloscopeHud(pt) {
  const hudRms = document.getElementById('hudRmsValue');
  const hudFreq = document.getElementById('hudFreqValue');
  const hudTemp = document.getElementById('hudTempValue');

  if (hudRms) hudRms.textContent = pt.mag.toFixed(2) + ' g';
  
  if (hudFreq) {
    if (currentScenario === 'rumination') hudFreq.textContent = '1.12 Hz (Cud)';
    else if (currentScenario === 'mastitis') hudFreq.textContent = '3.84 Hz (Agitated)';
    else if (currentScenario === 'resting') hudFreq.textContent = '0.04 Hz (Rest)';
    else if (currentScenario === 'walking') hudFreq.textContent = '1.81 Hz (Stride)';
  }

  if (hudTemp) {
    const temp = currentScenario === 'mastitis' ? 39.4 : 38.6;
    hudTemp.textContent = `${temp.toFixed(1)} °C`;
  }
}

function resizeOscilloscope() {
  const canvas = document.getElementById('accelCanvas');
  if (canvas && canvas.parentElement) {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight || 380;
  }
}

function drawOscilloscope() {
  const canvas = document.getElementById('accelCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Clear with phosphor persistence trail
  ctx.fillStyle = 'rgba(3, 7, 18, 0.28)';
  ctx.fillRect(0, 0, w, h);

  // High-Tech Cyber Grid
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.07)';
  ctx.lineWidth = 1;
  const gridStep = 40;
  for (let x = 0; x < w; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Zero-Centerline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const centerY = h / 2;
  const scaleY = h * 0.35;

  function plotWave(color, getter) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();

    waveBuffer.forEach((pt, i) => {
      const x = (i / (BUFFER_SIZE - 1)) * w;
      const y = centerY - getter(pt) * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (activeAxes.x) plotWave('#38bdf8', pt => pt.ax);         // Axis X
  if (activeAxes.y) plotWave('#34d399', pt => pt.ay - 0.8);   // Axis Y
  if (activeAxes.z) plotWave('#f43f5e', pt => pt.az);         // Axis Z
  if (activeAxes.mag) plotWave('#fbbf24', pt => pt.mag - 0.9);// Magnitude
}

/* ==========================================================================
   CVAE Bi-LSTM GenAI Simulator (Tab 3)
   ========================================================================== */
function initCvaePlayground() {
  const sliderRum = document.getElementById('sliderRumination');
  const sliderLying = document.getElementById('sliderLying');
  const sliderMotion = document.getElementById('sliderMotion');
  const sliderNoise = document.getElementById('sliderNoise');

  if (sliderRum) {
    sliderRum.addEventListener('input', e => {
      document.getElementById('rumValDisplay').textContent = `${e.target.value}%`;
    });
  }
  if (sliderLying) {
    sliderLying.addEventListener('input', e => {
      document.getElementById('lyingValDisplay').textContent = `+${e.target.value}%`;
    });
  }
  if (sliderMotion) {
    sliderMotion.addEventListener('input', e => {
      document.getElementById('motionValDisplay').textContent = `+${e.target.value}.0`;
    });
  }
  if (sliderNoise) {
    sliderNoise.addEventListener('input', e => {
      document.getElementById('noiseValDisplay').textContent = `${e.target.value}.0%`;
    });
  }

  // Presets
  const btnAcute = document.getElementById('presetAcuteBtn');
  const btnEarly = document.getElementById('presetEarlyBtn');
  const btnHealthy = document.getElementById('presetHealthyBtn');

  function setCvaePreset(rum, lying, motion, noise, activeBtn) {
    [btnAcute, btnEarly, btnHealthy].forEach(b => b && b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    sliderRum.value = rum;
    sliderLying.value = lying;
    sliderMotion.value = motion;
    sliderNoise.value = noise;

    document.getElementById('rumValDisplay').textContent = `${rum}%`;
    document.getElementById('lyingValDisplay').textContent = `+${lying}%`;
    document.getElementById('motionValDisplay').textContent = `+${motion}.0`;
    document.getElementById('noiseValDisplay').textContent = `${noise}.0%`;

    showToast('Applied clinical CVAE scenario preset', 'info', 2000);
  }

  if (btnAcute) btnAcute.addEventListener('click', () => setCvaePreset(-65, 80, 85, 12, btnAcute));
  if (btnEarly) btnEarly.addEventListener('click', () => setCvaePreset(-35, 45, 50, 5, btnEarly));
  if (btnHealthy) btnHealthy.addEventListener('click', () => setCvaePreset(0, 0, 0, 2, btnHealthy));

  const synthBtn = document.getElementById('runSynthesisBtn');
  if (synthBtn) synthBtn.addEventListener('click', runCvaeSynthesis);
}

async function runCvaeSynthesis() {
  const btn = document.getElementById('runSynthesisBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="synth-sparkle">⏳</span> Sampling Latent Space z ~ N(μ, σ)...';

  const rumVal = parseFloat(document.getElementById('sliderRumination').value);
  const lyingVal = parseFloat(document.getElementById('sliderLying').value);
  const motionVal = parseFloat(document.getElementById('sliderMotion').value);
  const noiseVal = parseFloat(document.getElementById('sliderNoise').value);

  try {
    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_cow_id: 0,
        rumination_delta_pct: rumVal,
        lying_restlessness_pct: lyingVal,
        motion_agitation: motionVal,
        noise_level: noiseVal
      })
    });

    const result = await res.json();
    const probPct = Math.round(result.probability * 100);
    const isDetected = result.status === 'mastitis_detected';

    // Update Result UI
    const badge = document.getElementById('cvaeResultBadge');
    badge.className = `status-badge ${isDetected ? 'status-alert' : 'status-healthy'}`;
    badge.textContent = isDetected ? `⚠️ SCM FLAGGED (${probPct}%)` : '🟢 NOMINAL HEALTHY';

    document.getElementById('cvaeProbDisplay').textContent = `${(result.probability * 100).toFixed(1)}%`;
    const probFill = document.getElementById('cvaeProbFill');
    probFill.style.width = `${Math.max(5, probPct)}%`;
    probFill.style.background = isDetected ? 'var(--accent-rose)' : 'var(--accent-emerald)';

    document.getElementById('cvaeXgbProb').textContent = `${(result.xgb_prob * 100).toFixed(1)}%`;
    document.getElementById('cvaeRfProb').textContent = `${(result.rf_prob * 100).toFixed(1)}%`;
    document.getElementById('cvaeMetaProb').textContent = `${(result.probability * 100).toFixed(1)}%`;

    // Draw preview curve on cvaeCanvas
    drawCvaeCanvas(result.timeline);

    showToast(isDetected 
      ? `Stacking Ensemble Flagged SCM with ${(result.probability * 100).toFixed(1)}% Risk` 
      : 'Synthesized Cattle Window evaluated as Nominal Healthy', 
      isDetected ? 'alert' : 'success'
    );

  } catch (err) {
    console.error('Synthesis error:', err);
    showToast('CVAE synthesis computation failed', 'alert');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="synth-sparkle">✨</span> Synthesize &amp; Run AI Ensemble Inference';
  }
}

function drawCvaeCanvas(timeline) {
  const canvas = document.getElementById('cvaeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);

  // Background Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Draw Rumination profile with filled gradient area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  ctx.beginPath();
  timeline.forEach((pt, i) => {
    const x = (i / 167) * w;
    const y = h - (pt.rumination_sec / 3600) * (h * 0.75) - 20;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Rumination trace
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  timeline.forEach((pt, i) => {
    const x = (i / 167) * w;
    const y = h - (pt.rumination_sec / 3600) * (h * 0.75) - 20;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Motion Agitation wave
  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  timeline.forEach((pt, i) => {
    const x = (i / 167) * w;
    const norm = (pt.motion_tilt + 500) / 2000;
    const y = h - Math.min(1, Math.max(0, norm)) * (h * 0.65) - 15;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ==========================================================================
   Cow Diagnostics Deep-Dive Modal
   ========================================================================== */
function initModalInteractions() {
  const printBtn = document.getElementById('modalPrintReportBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Timeline Canvas Tooltip interactions
  const canvas = document.getElementById('timelineChartCanvas');
  const tooltip = document.getElementById('chartTooltip');

  if (canvas && tooltip) {
    canvas.addEventListener('mousemove', (e) => {
      if (!selectedCowData || !selectedCowData.timeline) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scaleX = canvas.width / rect.width;
      const chartX = mouseX * scaleX;

      const paddingLeft = 45;
      const paddingRight = 20;
      const chartWidth = canvas.width - paddingLeft - paddingRight;

      if (chartX < paddingLeft || chartX > canvas.width - paddingRight) {
        tooltip.style.display = 'none';
        return;
      }

      const ratio = (chartX - paddingLeft) / chartWidth;
      const hourIndex = Math.min(167, Math.max(0, Math.round(ratio * 167)));
      const pt = selectedCowData.timeline[hourIndex];

      const dayNum = Math.floor(hourIndex / 24) + 1;
      const dayHour = hourIndex % 24;

      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(rect.width - 150, Math.max(10, mouseX - 60))}px`;
      tooltip.style.top = `${Math.max(10, e.clientY - rect.top - 80)}px`;

      tooltip.innerHTML = `
        <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px;">Day ${dayNum} • ${dayHour}:00h</div>
        <div>Rumination: ${(pt.rumination_sec / 60).toFixed(0)} min/h</div>
        <div>Lying: ${(pt.lying_sec / 60).toFixed(0)} min/h</div>
        <div>Locomotion: ${(pt.active_sec / 60).toFixed(0)} min/h</div>
      `;
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }
}

async function openCowDetail(cowId) {
  try {
    const res = await fetch(`/api/cows/${cowId}`);
    selectedCowData = await res.json();
    const cow = selectedCowData.cow;
    const isAlert = cow.status === 'mastitis_detected';

    // Header info
    document.getElementById('modalCowAvatar').textContent = isAlert ? '🚨' : '🐄';
    document.getElementById('modalCowTitle').textContent = `${cow.name} (${cow.tag})`;
    document.getElementById('modalCowSubtitle').textContent = `${cow.breed} Cattle • ${cow.pen} • Collar ${cow.collar_id} • Lactation Day ${cow.lactation_days}`;

    // Alert Banner
    const alertBox = document.getElementById('modalAlertBox');
    const alertLevel = document.getElementById('modalAlertLevel');
    const alertAction = document.getElementById('modalAlertAction');
    const alertBadge = document.getElementById('modalAlertBadge');

    if (isAlert) {
      alertBox.style.background = 'rgba(244, 63, 94, 0.15)';
      alertBox.style.border = '1px solid rgba(244, 63, 94, 0.45)';
      alertLevel.textContent = selectedCowData.clinical_action.level;
      alertLevel.style.color = '#fb7185';
      alertAction.textContent = selectedCowData.clinical_action.action;
      alertBadge.className = 'status-badge status-alert';
      alertBadge.textContent = `RISK: ${(cow.probability * 100).toFixed(1)}%`;
    } else {
      alertBox.style.background = 'rgba(16, 185, 129, 0.12)';
      alertBox.style.border = '1px solid rgba(16, 185, 129, 0.35)';
      alertLevel.textContent = selectedCowData.clinical_action.level;
      alertLevel.style.color = '#34d399';
      alertAction.textContent = selectedCowData.clinical_action.action;
      alertBadge.className = 'status-badge status-healthy';
      alertBadge.textContent = 'LOW RISK';
    }

    // Ensemble probabilities
    document.getElementById('modalXgbProb').textContent = (cow.xgb_prob * 100).toFixed(1) + '%';
    document.getElementById('modalRfProb').textContent = (cow.rf_prob * 100).toFixed(1) + '%';
    document.getElementById('modalMetaProb').textContent = (cow.probability * 100).toFixed(1) + '%';

    // Protocol text
    document.getElementById('modalProtocolText').textContent = selectedCowData.clinical_action.protocol;

    // Reset checkboxes
    const chk1 = document.getElementById('checkCmt');
    const chk2 = document.getElementById('checkSample');
    const chk3 = document.getElementById('checkIsolate');
    if (chk1) chk1.checked = false;
    if (chk2) chk2.checked = false;
    if (chk3) chk3.checked = false;

    // Draw 168-Hour Timeline Chart
    renderTimelineChart(selectedCowData.timeline);

    // Open Modal
    const modal = document.getElementById('cowDetailModal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

  } catch (err) {
    console.error('Error fetching cow detail:', err);
    showToast('Failed to retrieve cattle diagnostics profile', 'alert');
  }
}

function closeModal() {
  const modal = document.getElementById('cowDetailModal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   168-Hour Behavioral Kinetics Chart (Canvas)
   ========================================================================== */
function renderTimelineChart(timeline) {
  const canvas = document.getElementById('timelineChartCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = '#060a12';
  ctx.fillRect(0, 0, width, height);

  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 35;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // 7-Day division vertical lines & labels
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#64748b';

  for (let day = 1; day <= 7; day++) {
    const x = paddingLeft + (chartWidth / 7) * (day - 0.5);
    const lineX = paddingLeft + (chartWidth / 7) * day;
    
    // Day Label
    ctx.textAlign = 'center';
    ctx.fillText(`Day ${day}`, x, height - 10);

    if (day < 7) {
      ctx.beginPath();
      ctx.moveTo(lineX, paddingTop);
      ctx.lineTo(lineX, height - paddingBottom);
      ctx.stroke();
    }
  }

  // Horizontal Grid lines (0 to 60 mins/hr)
  ctx.textAlign = 'right';
  for (let m = 0; m <= 60; m += 15) {
    const y = height - paddingBottom - (m / 60) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();
    ctx.fillText(`${m}m`, paddingLeft - 8, y + 3);
  }

  // Draw Channel lines
  function drawChannel(color, extractVal) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.9;
    ctx.beginPath();

    timeline.forEach((pt, i) => {
      const val = Math.min(60, Math.max(0, extractVal(pt)));
      const x = paddingLeft + (i / 167) * chartWidth;
      const y = height - paddingBottom - (val / 60) * chartHeight;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Draw Rumination (blue), Lying (green), Locomotion (amber)
  drawChannel('#38bdf8', pt => pt.rumination_sec / 60);
  drawChannel('#34d399', pt => pt.lying_sec / 60);
  drawChannel('#fbbf24', pt => pt.active_sec / 60);

  // Draw Motion Tilt Deviation
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  timeline.forEach((pt, i) => {
    const val = (pt.motion_tilt + 500) / 2500;
    const clamped = Math.min(1, Math.max(0, val));
    const x = paddingLeft + (i / 167) * chartWidth;
    const y = height - paddingBottom - clamped * (chartHeight * 0.4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ==========================================================================
   Lightbox for Architecture Diagrams
   ========================================================================== */
function openLightbox(src, title) {
  const overlay = document.getElementById('lightboxOverlay');
  const img = document.getElementById('lightboxImg');
  if (img) {
    img.src = src;
    img.alt = title;
  }
  if (overlay) overlay.classList.add('active');
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (overlay) overlay.classList.remove('active');
}
