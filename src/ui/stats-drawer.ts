import { getExplorationMetrics, getYearBreakdowns, type ExplorationSummaryMetrics } from '../metrics/metrics-engine.ts';
import type { TemporalFilterConfig } from '../metrics/temporal-filter.ts';
import { exportCanonicalBackup, triggerBackupDownload } from '../data-controls/backup.ts';
import { restoreCanonicalBackup } from '../data-controls/restore.ts';
import { PurgeDialog } from './purge-dialog.ts';
import { toast } from './toast.ts';
import { db as defaultDb, StrutDB } from '../db/strut-db.ts';

export interface StatsDrawerOptions {
  onFilterChange?: (config: TemporalFilterConfig) => void;
  onImportClick?: () => void;
  onGoToRandomArea?: () => void;
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
      background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px);
      z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
    `;
    this.overlayElement.onclick = () => this.close();
    document.body.appendChild(this.overlayElement);

    // Drawer container
    this.drawerElement = document.createElement('aside');
    this.drawerElement.className = 'strut-stats-drawer';
    this.drawerElement.setAttribute('role', 'dialog');
    this.drawerElement.setAttribute('aria-modal', 'true');
    this.drawerElement.setAttribute('aria-label', 'reStrut Menu');
    this.drawerElement.style.cssText = `
      position: fixed; top: 0; right: 0; width: 100%; max-width: 390px; height: 100vh;
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
    const recentImports = await this.database.imports.reverse().limit(3).toArray();

    const formattedArea =
      metrics.totalGridAreaKm2 >= 100
        ? Math.round(metrics.totalGridAreaKm2).toLocaleString()
        : metrics.totalGridAreaKm2.toFixed(1);

    this.drawerElement.innerHTML = `
      <!-- Header -->
      <div style="padding: 18px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
            <polygon points="16,2 24,7 24,17 16,22 8,17 8,7" fill="#2dd4bf" opacity="0.95"/>
            <polygon points="24,12 32,17 32,27 24,32 16,27 16,17" fill="#38bdf8" opacity="0.8"/>
            <polygon points="8,12 16,17 16,27 8,32 0,27 0,17" fill="#818cf8" opacity="0.8"/>
          </svg>
          <span style="font-weight: 700; font-size: 1.15rem; color: var(--text-primary);">reStrut Menu</span>
        </div>
        <button id="btn-close-drawer" class="strut-btn" style="padding: 4px 10px; font-size: 1.1rem;" aria-label="Close Menu">✕</button>
      </div>

      <div style="padding: 20px; display: flex; flex-direction: column; gap: 24px; flex: 1;">

        <!-- 1. Import Location History (First) -->
        <div>
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
            1. Import Location History
          </div>
          <button id="btn-menu-import" class="strut-btn strut-btn-primary" style="width: 100%; justify-content: center; padding: 10px 14px; font-weight: 600;">
            📥 Import JSON File (Takeout / Timeline)
          </button>

          ${
            recentImports.length > 0
              ? `
              <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                ${recentImports
                  .map(
                    (imp) => `
                  <div style="font-size: 0.76rem; background: var(--bg-surface-elevated); padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${imp.filename}</span>
                    <span style="color: var(--accent-cyan); font-weight: 600;">+${imp.newHexCount} hexes</span>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            `
              : ''
          }
        </div>

        <!-- 2. Exploration Stats (Second) -->
        <div>
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
            2. Exploration Stats
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="background: var(--bg-surface-elevated); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <div style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Grid Area</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: var(--accent-cyan); margin-top: 2px;">
                ${formattedArea} <span style="font-size: 0.76rem; font-weight: 500; color: var(--text-secondary);">km²</span>
              </div>
            </div>

            <div style="background: var(--bg-surface-elevated); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <div style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Discovered Hexes</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-top: 2px;">
                ${metrics.totalUniqueHexes.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Go to Random Discovered Area (Third) -->
        <div>
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
            3. Explore Map
          </div>
          <button id="btn-random-area" class="strut-btn" style="width: 100%; justify-content: center; padding: 10px 14px; background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); color: var(--text-primary); font-weight: 600;" ${metrics.totalUniqueHexes === 0 ? 'disabled' : ''}>
            🎲 Go to Random Discovered Area
          </button>
        </div>

        <!-- 4. Time Filters (Fourth) -->
        <div>
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
            4. Time Filters
          </div>
          <div id="filter-pills" style="display: flex; flex-wrap: wrap; gap: 8px;">
            <button class="strut-btn filter-pill ${this.activeFilter.mode === 'all-time' ? 'strut-btn-primary' : ''}" data-mode="all-time" style="font-size: 0.78rem; padding: 5px 11px;">
              All-Time
            </button>
            <button class="strut-btn filter-pill ${this.activeFilter.mode === 'latest-sync' ? 'strut-btn-primary' : ''}" data-mode="latest-sync" style="font-size: 0.78rem; padding: 5px 11px;">
              Latest Sync
            </button>
            ${years
              .map(
                (y) => `
              <button class="strut-btn filter-pill ${this.activeFilter.mode === 'year' && this.activeFilter.year === y.year ? 'strut-btn-primary' : ''}" data-mode="year" data-year="${y.year}" style="font-size: 0.78rem; padding: 5px 11px;">
                ${y.year} (${y.hexCount})
              </button>
            `,
              )
              .join('')}
          </div>
        </div>

        <!-- 5. Data Controls (Fifth / End) -->
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 18px; margin-top: auto;">
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
            5. Data Controls
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="btn-export-backup" class="strut-btn" style="width: 100%; justify-content: center; font-size: 0.82rem;">
              💾 Export JSON Backup
            </button>

            <button id="btn-restore-backup" class="strut-btn" style="width: 100%; justify-content: center; font-size: 0.82rem;">
              📥 Restore JSON Backup
            </button>

            <button id="btn-purge-data" class="strut-btn strut-btn-danger" style="width: 100%; justify-content: center; margin-top: 4px; font-size: 0.82rem;">
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

    // Import button inside menu
    const importBtn = this.drawerElement.querySelector('#btn-menu-import') as HTMLElement | null;
    if (importBtn) {
      importBtn.onclick = () => {
        this.close();
        this.options.onImportClick?.();
      };
    }

    // Go to Random Area
    const randomBtn = this.drawerElement.querySelector('#btn-random-area') as HTMLElement | null;
    if (randomBtn) {
      randomBtn.onclick = () => {
        this.close();
        this.options.onGoToRandomArea?.();
      };
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
