export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
}

export class ToastManager {
  private container: HTMLElement | null = null;

  constructor() {
    this.ensureContainer();
  }

  private ensureContainer(): void {
    if (typeof document === 'undefined') return;

    let el = document.getElementById('strut-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'strut-toast-container';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(el);
    }
    this.container = el;
  }

  show(options: ToastOptions): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    this.ensureContainer();
    if (!this.container) return null;

    const { type = 'info', title, message, durationMs = 4500 } = options;

    const toast = document.createElement('div');
    toast.className = `strut-toast strut-toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

    toast.innerHTML = `
      <div style="font-weight: 700; font-size: 1.1rem; line-height: 1;">${icon}</div>
      <div>
        <div style="font-weight: 600; font-size: 0.88rem;">${title}</div>
        ${message ? `<div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">${message}</div>` : ''}
      </div>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.2s ease';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 200);
      }
    }, durationMs);

    return toast;
  }
}

export const toast = new ToastManager();
