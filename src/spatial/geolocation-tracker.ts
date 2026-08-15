import type { StrutDB } from '../db/strut-db.ts';
import { db as defaultDb } from '../db/strut-db.ts';
import type { NormalizedLocationPoint } from '../types/domain.ts';
import { interpolateSegment, haversineDistanceKm } from './path-interpolator.ts';

export interface LivePosition {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly timestampMs: number;
}

export interface GeolocationTrackerOptions {
  database?: StrutDB;
  accuracyThresholdMeters?: number;
  enableInterpolation?: boolean;
  onPositionChange?: (pos: LivePosition) => void;
  onHexDiscovered?: (newHexCount: number, currentPosition: LivePosition) => void;
  onError?: (error: Error | GeolocationPositionError) => void;
}

export class GeolocationTracker {
  private database: StrutDB;
  private accuracyThresholdMeters: number;
  private enableInterpolation: boolean;
  private onPositionChange?: ((pos: LivePosition) => void) | undefined;
  private onHexDiscovered?: ((newHexCount: number, currentPosition: LivePosition) => void) | undefined;
  private onError?: ((error: Error | GeolocationPositionError) => void) | undefined;

  private watchId: number | null = null;
  private lastFix: LivePosition | null = null;
  private isRunning = false;

  constructor(options: GeolocationTrackerOptions = {}) {
    this.database = options.database ?? defaultDb;
    this.accuracyThresholdMeters = options.accuracyThresholdMeters ?? 40;
    this.enableInterpolation = options.enableInterpolation ?? true;
    this.onPositionChange = options.onPositionChange;
    this.onHexDiscovered = options.onHexDiscovered;
    this.onError = options.onError;
  }

  /**
   * Starts live position tracking using high-accuracy GPS
   */
  start(): boolean {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.onError?.(new Error('Geolocation is not supported by this browser.'));
      return false;
    }

    if (this.isRunning) return true;

    this.isRunning = true;

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          this.handleBrowserPosition(position);
        },
        (error) => {
          this.onError?.(error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 10000,
        },
      );
      return true;
    } catch (err: unknown) {
      this.isRunning = false;
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Stops live tracking
   */
  stop(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isRunning = false;
    this.lastFix = null;
  }

  /**
   * Internal handler for W3C GeolocationPosition events
   */
  private async handleBrowserPosition(position: GeolocationPosition): Promise<void> {
    const { latitude, longitude, accuracy, heading, speed } = position.coords;
    const timestampMs = position.timestamp || Date.now();

    await this.processFix(latitude, longitude, accuracy, heading, speed, timestampMs);
  }

  /**
   * Processes a GPS fix: validates accuracy, interpolates paths, and ingests into IndexedDB.
   * Returns count of new hexagons unlocked.
   */
  async processFix(
    lat: number,
    lng: number,
    accuracy = 10,
    heading: number | null = null,
    speed: number | null = null,
    timestampMs = Date.now(),
  ): Promise<number> {
    const currentLivePos: LivePosition = {
      lat,
      lng,
      accuracy,
      heading,
      speed,
      timestampMs,
    };

    // 1. Notify position change for the live map puck
    this.onPositionChange?.(currentLivePos);

    // 2. Reject fixes exceeding accuracy threshold (e.g. indoor cell tower drift)
    if (accuracy > this.accuracyThresholdMeters) {
      return 0;
    }

    // 3. Reject teleportation leaps (> 50m in < 1s)
    if (this.lastFix) {
      const distKm = haversineDistanceKm(this.lastFix.lat, this.lastFix.lng, lat, lng);
      const timeDeltaSec = Math.max(0.1, (timestampMs - this.lastFix.timestampMs) / 1000);
      const impliedSpeedKmh = (distKm / timeDeltaSec) * 3600;

      // Filter GPS jitter glitches exceeding 300 km/h
      if (impliedSpeedKmh > 300) {
        return 0;
      }
    }

    const currentPoint: NormalizedLocationPoint = {
      lat,
      lng,
      timestampMs,
      accuracy,
    };

    const pointsToIngest: NormalizedLocationPoint[] = [];

    // 4. Real-time path interpolation
    if (this.enableInterpolation && this.lastFix) {
      const prevPoint: NormalizedLocationPoint = {
        lat: this.lastFix.lat,
        lng: this.lastFix.lng,
        timestampMs: this.lastFix.timestampMs,
        accuracy: this.lastFix.accuracy,
      };

      const intermediates = interpolateSegment(prevPoint, currentPoint);
      if (intermediates.length > 0) {
        pointsToIngest.push(...intermediates);
      }
    }

    pointsToIngest.push(currentPoint);
    this.lastFix = currentLivePos;

    // 5. Ingest into IndexedDB idempotently (1 visit per cell per calendar day)
    const res = await this.database.ingestNormalizedPoints(pointsToIngest);

    if (res.newHexCount > 0) {
      // Trigger subtle haptic vibration on mobile devices
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(40);
        } catch {
          // Ignore vibration policy errors
        }
      }

      this.onHexDiscovered?.(res.newHexCount, currentLivePos);
    }

    return res.newHexCount;
  }

  isTracking(): boolean {
    return this.isRunning;
  }

  getLastPosition(): LivePosition | null {
    return this.lastFix;
  }
}
