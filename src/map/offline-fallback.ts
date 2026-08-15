import type { Map as MapLibreMap } from 'maplibre-gl';

export interface OfflineStatusListener {
  (isOffline: boolean): void;
}

export class OfflineFallbackManager {
  private map: MapLibreMap;
  private isOffline = false;
  private listeners: Set<OfflineStatusListener> = new Set();
  private bannerElement: HTMLElement | null = null;

  constructor(map: MapLibreMap) {
    this.map = map;
    this.initNetworkListeners();
    this.initMapErrorListener();
  }

  private initNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    this.isOffline = !navigator.onLine;

    window.addEventListener('online', () => {
      this.setOfflineState(false);
    });

    window.addEventListener('offline', () => {
      this.setOfflineState(true);
    });
  }

  private initMapErrorListener(): void {
    this.map.on('error', (event) => {
      // If a tile load fails due to network outage, degrade gracefully
      const errorMsg = event.error ? event.error.message : '';
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('offline')) {
        this.setOfflineState(true);
      }
    });
  }

  private setOfflineState(offline: boolean): void {
    if (this.isOffline === offline) return;
    this.isOffline = offline;

    this.updateBannerUI();
    for (const listener of this.listeners) {
      listener(this.isOffline);
    }
  }

  subscribe(listener: OfflineStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.isOffline);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get offline(): boolean {
    return this.isOffline;
  }

  private updateBannerUI(): void {
    if (typeof document === 'undefined') return;

    if (this.isOffline) {
      if (!this.bannerElement) {
        this.bannerElement = document.createElement('div');
        this.bannerElement.id = 'strut-offline-banner';
        this.bannerElement.className = 'strut-offline-banner';
        this.bannerElement.setAttribute('role', 'status');
        this.bannerElement.setAttribute('aria-live', 'polite');
        this.bannerElement.innerHTML = `
          <span class="strut-offline-icon">📡</span>
          <span>Offline Map Mode — Exploring cached local tiles</span>
        `;
        document.body.appendChild(this.bannerElement);
      }
      this.bannerElement.style.display = 'flex';
    } else if (this.bannerElement) {
      this.bannerElement.style.display = 'none';
    }
  }

  destroy(): void {
    if (this.bannerElement && this.bannerElement.parentNode) {
      this.bannerElement.parentNode.removeChild(this.bannerElement);
      this.bannerElement = null;
    }
    this.listeners.clear();
  }
}
