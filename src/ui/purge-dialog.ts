import { db as defaultDb, StrutDB } from '../db/strut-db.ts';

export interface PurgeDialogOptions {
  onPurgeConfirmed?: () => void;
  database?: StrutDB;
}

export class PurgeDialog {
  private overlay: HTMLElement | null = null;
  private database: StrutDB;
  private onPurgeConfirmed?: (() => void) | undefined;

  constructor(options: PurgeDialogOptions = {}) {
    this.database = options.database ?? defaultDb;
    this.onPurgeConfirmed = options.onPurgeConfirmed;
  }

  show(): void {
    if (typeof document === 'undefined') return;
    this.dismiss();

    this.overlay = document.createElement('div');
    this.overlay.className = 'strut-modal-overlay';
    this.overlay.setAttribute('role', 'alertdialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'purge-title');

    const card = document.createElement('div');
    card.className = 'strut-progress-card';
    card.style.maxWidth = '420px';

    card.innerHTML = `
      <div style="font-size: 2rem; margin-bottom: 12px; text-align: center;">⚠️</div>
      <div id="purge-title" style="font-size: 1.15rem; font-weight: 700; text-align: center; margin-bottom: 8px;">
        Purge All Exploration Data?
      </div>
      <div style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; line-height: 1.5; margin-bottom: 24px;">
        This will permanently drop all IndexedDB stores, clear the map, and reset all sync state. This action cannot be undone.
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="btn-cancel-purge" class="strut-btn" style="flex: 1;">Cancel</button>
        <button id="btn-confirm-purge" class="strut-btn strut-btn-danger" style="flex: 1;">Delete Everything</button>
      </div>
    `;

    this.overlay.appendChild(card);
    document.body.appendChild(this.overlay);

    const cancelBtn = card.querySelector('#btn-cancel-purge') as HTMLElement | null;
    const confirmBtn = card.querySelector('#btn-confirm-purge') as HTMLElement | null;

    if (cancelBtn) {
      cancelBtn.onclick = () => this.dismiss();
      cancelBtn.focus();
    }

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        confirmBtn.setAttribute('disabled', 'true');
        confirmBtn.textContent = 'Purging...';

        await this.database.purgeAllData();

        // Clear Service Worker Cache if supported
        if (typeof caches !== 'undefined') {
          try {
            const keys = await caches.keys();
            for (const key of keys) {
              if (key.includes('strut') || key.includes('tile')) {
                await caches.delete(key);
              }
            }
          } catch {
            // Ignore cache clear failures
          }
        }

        this.dismiss();
        this.onPurgeConfirmed?.();
      };
    }

    // Escape listener
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.dismiss();
        window.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('keydown', onKey);
  }

  dismiss(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  }
}
