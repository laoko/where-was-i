import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import type { LivePosition } from '../spatial/geolocation-tracker.ts';

export class LocationMarker {
  private map: MapLibreMap;
  private marker: maplibregl.Marker | null = null;
  private element: HTMLElement | null = null;
  private isFollowModeActive = true;
  private headingElement: HTMLElement | null = null;

  constructor(map: MapLibreMap) {
    this.map = map;
    this.initMarker();
    this.attachMapListeners();
  }

  private initMarker(): void {
    if (typeof document === 'undefined') return;

    this.element = document.createElement('div');
    this.element.className = 'restrut-live-puck-container';
    this.element.innerHTML = `
      <div class="restrut-live-puck-halo"></div>
      <div class="restrut-live-puck-core"></div>
      <div class="restrut-live-puck-heading"></div>
    `;

    this.headingElement = this.element.querySelector('.restrut-live-puck-heading');

    this.marker = new maplibregl.Marker({
      element: this.element,
      anchor: 'center',
    });
  }

  private attachMapListeners(): void {
    // If the user manually drags or touches the map, gracefully release camera lock
    const onUserPan = () => {
      if (this.isFollowModeActive) {
        this.isFollowModeActive = false;
        this.notifyFollowModeChanged();
      }
    };

    this.map.on('dragstart', onUserPan);
    this.map.on('touchstart', onUserPan);
  }

  private onFollowModeChangeCallback?: ((active: boolean) => void) | undefined;

  onFollowModeChange(callback: (active: boolean) => void): void {
    this.onFollowModeChangeCallback = callback;
  }

  private notifyFollowModeChanged(): void {
    this.onFollowModeChangeCallback?.(this.isFollowModeActive);
  }

  updatePosition(pos: LivePosition): void {
    if (!this.marker) return;

    const coords: [number, number] = [pos.lng, pos.lat];

    if (!this.marker.getElement().parentNode) {
      this.marker.setLngLat(coords).addTo(this.map);
    } else {
      this.marker.setLngLat(coords);
    }

    // Update directional heading cone if compass data is available
    if (this.headingElement && pos.heading !== null && Number.isFinite(pos.heading)) {
      this.headingElement.style.display = 'block';
      this.headingElement.style.transform = `rotate(${pos.heading}deg)`;
    } else if (this.headingElement) {
      this.headingElement.style.display = 'none';
    }

    // Auto-center camera if follow mode is active
    if (this.isFollowModeActive) {
      this.map.easeTo({
        center: coords,
        duration: 800,
        essential: true,
      });
    }
  }

  setFollowMode(active: boolean): void {
    this.isFollowModeActive = active;
    this.notifyFollowModeChanged();

    if (active && this.marker) {
      const lngLat = this.marker.getLngLat();
      if (lngLat) {
        this.map.flyTo({
          center: [lngLat.lng, lngLat.lat],
          zoom: Math.max(this.map.getZoom(), 15),
          essential: true,
        });
      }
    }
  }

  isFollowMode(): boolean {
    return this.isFollowModeActive;
  }

  remove(): void {
    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
  }
}
