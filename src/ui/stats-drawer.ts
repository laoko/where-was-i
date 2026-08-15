import { getExplorationMetrics, getYearBreakdowns, type ExplorationSummaryMetrics } from '../metrics/metrics-engine.ts';
import type { TemporalFilterConfig } from '../metrics/temporal-filter.ts';
import { exportCanonicalBackup, triggerBackupDownload } from '../data-controls/backup.ts';
import { restoreCanonicalBackup } from '../data-controls/restore.ts';
import { PurgeDialog } from './purge-dialog.ts';
import { toast } from './toast.ts';
import { db as defaultDb, StrutDB } from '../db/strut-db.ts';

export interface StatsDrawerOptions {
  onFilterChange?: (config: TemporalFilterConfig) => void;
  onHighContrastToggle?: (enabled: boolean) => void;
  onDataReset?: () => void;
  database?: StrutDB;
}

export class StatsDrawer {
  private drawerElement: HTMLElement | null = null;
  private overlayElement: HTMLElement | null = null;
  private isOpen = false;
  private database: StrutDB;
  private options: StatsDrawerOptions;
  private activeFilter: TemporalFilterConfig = { mode: 'all-time' };
  private isHighContrast = false;

  constructor(options: StatsDrawerOptions = {}) {
    this.options = options;
    this.database = options.database ?? defaultDb;
    this.initDOM();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;

    // Overlay backdrop
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'strut-drawer-backdrop';
    this.overlayElement.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);
      z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
    `;
    this.overlayElement.onclick = () => this.close();
    document.body.appendChild(this.overlayElement);

    // Drawer container
    this.drawerElement = document.createElement('aside');
    this.drawerElement.className = 'strut-stats-drawer';
    this.drawerElement.setAttribute('role', 'dialog');
    this.drawerElement.setAttribute('aria-modal', 'true');
    this.drawerElement.setAttribute('aria-label', 'Exploration Statistics and Settings');
    this.drawerElement.style.cssText = `
      position: fixed; top: 0; right: 0; width: 100%; max-width: 380px; height: 100vh;
      background: var(--bg-surface); border-left: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-modal); z-index: 95; transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; flex-direction: column; overflow-y: auto;
    `;

    document.body.appendChild(this.drawerElement);

    // Escape listener
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  async open(): Promise<void> {
    if (!this.drawerElement || !this.overlayElement) return;
    this.isOpen = true;

    await this.renderContent();

    this.overlayElement.style.opacity = '1';
    this.overlayElement.style.pointerEvents = 'auto';
    this.drawerElement.style.transform = 'translateX(0)';
  }

  close(): void {
    if (!this.drawerElement || !this.overlayElement) return;
    this.isOpen = false;

    this.overlayElement.style.opacity = '0';
    this.overlayElement.style.pointerEvents = 'none';
    this.drawerElement.style.transform = 'translateX(100%)';
  }

  private async renderContent(): Promise<void> {
    if (!this.drawerElement) return;

    const metrics: ExplorationSummaryMetrics = await getExplorationMetrics(this.database);
    const years = await getYearBreakdowns(this.database);

    const formattedArea = metrics.totalGridAreaKm2 >= 100
      ? Math.round(metrics.totalGridAreaKm2).toLocaleString()
      : metrics.totalGridAreaKm2.toFixed(1);

    this.drawerElement.innerHTML = `
      <div style="padding: 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
        <h2 style="font-size: 1.1rem; font-weight: 700;">Exploration & Stats</h2>
        <button id="btn-close-drawer" class="strut-btn" style="padding: 4px 10px; font-size: 1.1rem;" aria-label="Close Drawer">✕</button>
      </div>

      <div style="padding: 20px; display: flex; flex-direction: column; gap: 20px; flex: 1;">
        <!-- Metrics Cards -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Grid Area</div>
            <div style="font-size: 1.35rem; font-weight: 700; color: var(--accent-cyan); margin-top: 4px;">
              ${formattedArea} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">km²</span>
            </div>
          </div>

          <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Hexagons</div>
            <div style="font-size: 1.35rem; font-weight: 700; color: var(--text-primary); margin-top: 4px;">
              ${metrics.totalUniqueHexes.toLocaleString()}
            </div>
          </div>
        </div>

        <div style="background: var(--bg-surface-elevated); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.82rem; color: var(--text-secondary);">Total Visit Days:</span>
          <strong style="font-size: 0.95rem; color: var(--text-primary);">${metrics.totalVisitDays.toLocaleString()}</strong>
        </div>

        <!-- Temporal Filter Section -->
        <div>
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">
            Map Filter View
          </div>
          <div id="filter-pills" style="display: flex; flex-wrap: wrap; gap: 8px;">
            <button class="strut-btn filter-pill ${this.activeFilter.mode === 'all-time' ? 'strut-btn-primary' : ''}" data-mode="all-time" style="font-size: 0.78rem; padding: 5px 10px;">
              All-Time
            </button>
            <button class="strut-btn filter-pill ${this.activeFilter.mode === 'latest-sync' ? 'strut-btn-primary' : ''}" data-mode="latest-sync" style="font-size: 0.78rem; padding: 5px 10px;">
              Latest Sync
            </button>
            ${years.map((y) => `
              <button class="strut-btn filter-pill ${this.activeFilter.mode === 'year' && this.activeFilter.year === y.year ? 'strut-btn-primary' : ''}" data-mode="year" data-year="${y.year}" style="font-size: 0.78rem; padding: 5px 10px;">
                ${y.year} (${y.hexCount})
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Data Controls Section -->
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 18px;">
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase;">
            Data Controls & Settings
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <label style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem; padding: 8px 0; cursor: pointer;">
              <span>High-Contrast Map Colors</span>
              <input type="checkbox" id="check-high-contrast" ${this.isHighContrast ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
            </label>

            <button id="btn-export-backup" class="strut-btn" style="width: 100%; justify-content: center;">
              💾 Export JSON Backup
            </button>

            <button id="btn-restore-backup" class="strut-btn" style="width: 100%; justify-content: center;">
              📥 Restore JSON Backup
            </button>

            <button id="btn-purge-data" class="strut-btn strut-btn-danger" style="width: 100%; justify-content: center; margin-top: 8px;">
              🗑️ Purge All Data
            </button>
          </div>
        </div>
      </div>
    `;

    // Attach Event Listeners
    const closeBtn = this.drawerElement.querySelector('#btn-close-drawer') as HTMLElement | null;
    if (closeBtn) {
      closeBtn.onclick = () => this.close();
    }

    // Filter pills
    const pills = this.drawerElement.querySelectorAll('.filter-pill');
    pills.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as TemporalFilterConfig['mode'];
        const yearAttr = btn.getAttribute('data-year');
        const year = yearAttr ? Number(yearAttr) : undefined;

        this.activeFilter = { mode, year };
        this.options.onFilterChange?.(this.activeFilter);
        this.renderContent();
      });
    });

    // High contrast toggle
    const highContrastCheck = this.drawerElement.querySelector('#check-high-contrast') as HTMLInputElement | null;
    if (highContrastCheck) {
      highContrastCheck.onchange = () => {
        this.isHighContrast = highContrastCheck.checked;
        this.options.onHighContrastToggle?.(this.isHighContrast);
      };
    }

    // Export backup
    const exportBtn = this.drawerElement.querySelector('#btn-export-backup') as HTMLElement | null;
    if (exportBtn) {
      exportBtn.onclick = async () => {
        try {
          const json = await exportCanonicalBackup(this.database);
          triggerBackupDownload(json);
          toast.show({ type: 'success', title: 'Backup Exported', message: 'Saved strut-backup.json successfully.' });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Export failed';
          toast.show({ type: 'error', title: 'Export Failed', message: msg });
        }
      };
    }

    // Restore backup
    const restoreBtn = this.drawerElement.querySelector('#btn-restore-backup') as HTMLElement | null;
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          try {
            const text = await file.text();
            const res = await restoreCanonicalBackup(text, this.database);
            toast.show({
              type: 'success',
              title: 'Backup Restored',
              message: `Restored ${res.restoredVisits} daily visits in ${Math.round(res.durationMs)}ms!`,
            });
            this.options.onDataReset?.();
            this.renderContent();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Invalid backup format';
            toast.show({ type: 'error', title: 'Restore Failed', message: msg });
          }
        };
        input.click();
      };
    }

    // Purge Data
    const purgeBtn = this.drawerElement.querySelector('#btn-purge-data') as HTMLElement | null;
    if (purgeBtn) {
      purgeBtn.onclick = () => {
        const purgeDialog = new PurgeDialog({
          database: this.database,
          onPurgeConfirmed: () => {
            toast.show({ type: 'info', title: 'Data Purged', message: 'All local exploration records have been wiped.' });
            this.options.onDataReset?.();
            this.close();
          },
        });
        purgeDialog.show();
      };
    }
  }

  destroy(): void {
    if (this.drawerElement && this.drawerElement.parentNode) {
      this.drawerElement.parentNode.removeChild(this.drawerElement);
    }
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }
  }
}
