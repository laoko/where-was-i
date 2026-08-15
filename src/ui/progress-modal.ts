import type { IngestionProgress, IngestionStage } from '../types/domain.ts';

export interface ProgressModalOptions {
  onCancel?: () => void;
}

const DISPLAY_STAGES: { id: IngestionStage; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'parsing', label: 'Parsing' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'deduplicating', label: 'Deduplicating' },
  { id: 'persisting', label: 'Persisting' },
  { id: 'complete', label: 'Complete' },
];

export class ProgressModal {
  private overlay: HTMLElement | null = null;
  private fillBar: HTMLElement | null = null;
  private percentLabel: HTMLElement | null = null;
  private messageLabel: HTMLElement | null = null;
  private subMessageLabel: HTMLElement | null = null;
  private countLabel: HTMLElement | null = null;
  private hexCountLabel: HTMLElement | null = null;
  private gridAreaLabel: HTMLElement | null = null;
  private speedLabel: HTMLElement | null = null;
  private etaLabel: HTMLElement | null = null;
  private stageElements: Map<IngestionStage, HTMLElement> = new Map();
  private onCancel?: (() => void) | undefined;

  constructor(options: ProgressModalOptions = {}) {
    this.onCancel = options.onCancel;
  }

  show(filename = 'Location History'): void {
    if (typeof document === 'undefined') return;
    this.dismiss();

    this.overlay = document.createElement('div');
    this.overlay.className = 'strut-modal-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'progress-title');

    const card = document.createElement('div');
    card.className = 'strut-progress-card';
    card.style.maxWidth = '520px';

    // Header
    const header = document.createElement('div');
    header.className = 'strut-progress-header';
    header.innerHTML = `
      <div id="progress-title" class="strut-progress-title">Importing ${filename}</div>
      <span id="progress-percent" style="font-weight: 700; font-size: 1.05rem; color: var(--accent-cyan);">0%</span>
    `;

    // Stepper Pills
    const stepper = document.createElement('div');
    stepper.className = 'strut-stages-stepper';
    for (const item of DISPLAY_STAGES) {
      const pill = document.createElement('span');
      pill.className = 'strut-stage-pill';
      pill.textContent = item.label;
      this.stageElements.set(item.id, pill);
      stepper.appendChild(pill);
    }

    // Progress Bar Track
    const track = document.createElement('div');
    track.className = 'strut-progress-track';
    track.style.height = '6px';
    this.fillBar = document.createElement('div');
    this.fillBar.className = 'strut-progress-fill';
    this.fillBar.style.width = '0%';
    track.appendChild(this.fillBar);

    // Primary & Sub Message
    const messageContainer = document.createElement('div');
    messageContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 12px 0 16px;';
    messageContainer.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <span id="progress-msg" style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary);">Initializing...</span>
        <span id="progress-count" style="font-size: 0.8rem; color: var(--text-muted);">0 points</span>
      </div>
      <span id="progress-submsg" style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4;">Preparing data structures</span>
    `;

    // Live Metrics Grid
    const liveMetricsGrid = document.createElement('div');
    liveMetricsGrid.style.cssText = `
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
      background: var(--bg-surface-elevated); padding: 10px 12px;
      border-radius: var(--radius-md); border: 1px solid var(--border-subtle);
      margin-bottom: 18px;
    `;
    liveMetricsGrid.innerHTML = `
      <div>
        <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Hexagons</div>
        <div id="stat-hexes" style="font-size: 0.95rem; font-weight: 700; color: var(--accent-cyan); margin-top: 2px;">+0</div>
      </div>
      <div>
        <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Grid Area</div>
        <div id="stat-area" style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-top: 2px;">0 km²</div>
      </div>
      <div>
        <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Throughput</div>
        <div id="stat-speed" style="font-size: 0.95rem; font-weight: 700; color: var(--text-secondary); margin-top: 2px;">--</div>
      </div>
      <div>
        <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Remaining</div>
        <div id="stat-eta" style="font-size: 0.95rem; font-weight: 700; color: var(--text-secondary); margin-top: 2px;">--</div>
      </div>
    `;

    // Cancel Button
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'strut-btn strut-btn-danger';
    cancelBtn.textContent = 'Cancel Import';
    cancelBtn.onclick = () => {
      cancelBtn.textContent = 'Cancelling...';
      cancelBtn.setAttribute('disabled', 'true');
      this.onCancel?.();
    };
    actions.appendChild(cancelBtn);

    card.appendChild(header);
    card.appendChild(stepper);
    card.appendChild(track);
    card.appendChild(messageContainer);
    card.appendChild(liveMetricsGrid);
    card.appendChild(actions);
    this.overlay.appendChild(card);

    document.body.appendChild(this.overlay);

    this.percentLabel = header.querySelector('#progress-percent');
    this.messageLabel = messageContainer.querySelector('#progress-msg');
    this.subMessageLabel = messageContainer.querySelector('#progress-submsg');
    this.countLabel = messageContainer.querySelector('#progress-count');
    this.hexCountLabel = liveMetricsGrid.querySelector('#stat-hexes');
    this.gridAreaLabel = liveMetricsGrid.querySelector('#stat-area');
    this.speedLabel = liveMetricsGrid.querySelector('#stat-speed');
    this.etaLabel = liveMetricsGrid.querySelector('#stat-eta');
  }

  update(progress: IngestionProgress): void {
    if (!this.overlay) return;

    if (this.fillBar) {
      this.fillBar.style.width = `${Math.min(100, Math.max(0, progress.progressPercent))}%`;
    }
    if (this.percentLabel) {
      this.percentLabel.textContent = `${Math.round(progress.progressPercent)}%`;
    }
    if (this.messageLabel && progress.message) {
      this.messageLabel.textContent = progress.message;
    }
    if (this.subMessageLabel && progress.subMessage) {
      this.subMessageLabel.textContent = progress.subMessage;
    }
    if (this.countLabel) {
      this.countLabel.textContent =
        progress.totalPoints > 0
          ? `${progress.pointsProcessed.toLocaleString()} / ${progress.totalPoints.toLocaleString()} pts`
          : `${progress.pointsProcessed.toLocaleString()} pts`;
    }

    // Live Metrics
    if (this.hexCountLabel && progress.discoveredHexCount !== undefined) {
      this.hexCountLabel.textContent = `+${progress.discoveredHexCount.toLocaleString()}`;
    }
    if (this.gridAreaLabel && progress.gridAreaKm2 !== undefined) {
      this.gridAreaLabel.textContent = `${progress.gridAreaKm2.toFixed(1)} km²`;
    }
    if (this.speedLabel && progress.pointsPerSec !== undefined && progress.pointsPerSec > 0) {
      this.speedLabel.textContent =
        progress.pointsPerSec >= 1000
          ? `${(progress.pointsPerSec / 1000).toFixed(1)}k/s`
          : `${progress.pointsPerSec}/s`;
    }
    if (this.etaLabel) {
      if (progress.etaSeconds !== undefined && progress.etaSeconds > 0) {
        this.etaLabel.textContent = `~${progress.etaSeconds}s`;
      } else if (progress.progressPercent >= 100) {
        this.etaLabel.textContent = 'Done';
      }
    }

    // Stage Stepper mapping
    let activeStage: IngestionStage = progress.stage;
    if (activeStage === 'filtering') activeStage = 'connecting';
    if (activeStage === 'aggregating') activeStage = 'deduplicating';

    const stageIds = DISPLAY_STAGES.map((s) => s.id);
    const currentStageIndex = stageIds.indexOf(activeStage);

    for (let i = 0; i < stageIds.length; i++) {
      const stage = stageIds[i];
      if (!stage) continue;
      const el = this.stageElements.get(stage);
      if (!el) continue;

      el.classList.remove('active', 'complete');
      if (i < currentStageIndex || progress.progressPercent >= 100) {
        el.classList.add('complete');
      } else if (i === currentStageIndex) {
        el.classList.add('active');
      }
    }
  }

  dismiss(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
      this.stageElements.clear();
    }
  }
}
