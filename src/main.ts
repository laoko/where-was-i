import { db } from './db/strut-db.ts';
import { MapEngine } from './map/map-engine.ts';
import { IngestionController } from './ingestion/ingestion-controller.ts';
import { UploadZone } from './ui/upload-zone.ts';
import { ProgressModal } from './ui/progress-modal.ts';
import { StatsDrawer } from './ui/stats-drawer.ts';
import { toast } from './ui/toast.ts';
import { ShareTargetManager } from './pwa/share-target-manager.ts';
import { getFilteredHexStats, type TemporalFilterConfig } from './metrics/temporal-filter.ts';
import { pickRandomDiscoveredHex } from './spatial/viewport.ts';
import { GeolocationTracker } from './spatial/geolocation-tracker.ts';
import { LocationMarker } from './map/location-marker.ts';

async function bootstrapApp(): Promise<void> {
  // 1. Initialize IndexedDB
  await db.initializeDefaults();

  // 2. Initialize Map Engine
  const mapEngine = new MapEngine({
    container: 'map-container',
  });

  let currentFilter: TemporalFilterConfig = { mode: 'all-time' };

  // 3. Load stored hex data onto map
  async function reloadMapData(autoFit = false): Promise<void> {
    const hexes = await getFilteredHexStats(currentFilter, db);
    mapEngine.updateHexData(hexes, autoFit);
  }

  mapEngine.mapInstance.on('load', async () => {
    await reloadMapData(true);
  });

  // 4. Ingestion & UI Controller
  const ingestionController = new IngestionController();

  const progressModal = new ProgressModal({
    onCancel: () => {
      ingestionController.cancel();
      toast.show({
        type: 'info',
        title: 'Import Cancelled',
        message: 'In-flight ingestion was cancelled.',
      });
    },
  });

  async function handleImportPayload(filename: string, rawJson: unknown): Promise<void> {
    progressModal.show(filename);

    try {
      const summary = await ingestionController.startIngestion(
        rawJson,
        {
          filename,
          onProgress: (progress) => {
            progressModal.update(progress);
          },
        },
        true, // Use worker if available
      );

      progressModal.dismiss();

      if (summary.status === 'completed') {
        toast.show({
          type: 'success',
          title: 'Import Complete',
          message: `Ingested ${summary.validPoints.toLocaleString()} points, unlocking ${summary.newHexCount.toLocaleString()} new hexes!`,
        });
        await reloadMapData(true);
      } else if (summary.status === 'cancelled') {
        toast.show({
          type: 'info',
          title: 'Import Cancelled',
          message: 'Historical data state was safely preserved.',
        });
      }
    } catch (err: unknown) {
      progressModal.dismiss();
      const msg = err instanceof Error ? err.message : 'Unknown import failure';
      toast.show({
        type: 'error',
        title: 'Import Failed',
        message: msg,
      });
    }
  }

  // 5. Upload Zone (Drag-and-Drop + File Picker)
  const uploadZone = new UploadZone({
    onFileSelected: (filename, rawJson) => {
      handleImportPayload(filename, rawJson);
    },
    onError: (msg) => {
      toast.show({
        type: 'error',
        title: 'File Error',
        message: msg,
      });
    },
  });

  // 6. Unified reStrut Hamburger Menu
  const menuDrawer = new StatsDrawer({
    database: db,
    onFilterChange: async (filterConfig) => {
      currentFilter = filterConfig;
      await reloadMapData(false);
    },
    onImportClick: () => {
      uploadZone.openFileDialog();
    },
    onGoToRandomArea: async () => {
      const hexes = await getFilteredHexStats(currentFilter, db);
      const targetHex = pickRandomDiscoveredHex(hexes);
      if (targetHex) {
        mapEngine.flyToCell(targetHex, 15);
        toast.show({
          type: 'info',
          title: 'Exploration Warp',
          message: 'Panning to random discovered area...',
        });
      } else {
        toast.show({
          type: 'info',
          title: 'No Areas Discovered',
          message: 'Import your location history to explore random areas.',
        });
      }
    },
    onDataReset: async () => {
      await reloadMapData(true);
    },
  });

  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) {
    btnMenu.onclick = () => {
      menuDrawer.open();
    };
  }

  // 7. Live GPS Location Tracking & Real-Time Discovery
  const locationMarker = new LocationMarker(mapEngine.mapInstance);

  const tracker = new GeolocationTracker({
    database: db,
    accuracyThresholdMeters: 40,
    enableInterpolation: true,
    onPositionChange: (pos) => {
      locationMarker.updatePosition(pos);
    },
    onHexDiscovered: async (newCount) => {
      await reloadMapData(false);
      toast.show({
        type: 'success',
        title: 'Area Discovered! 🗺️',
        message: `Unlocked +${newCount} new hexagon${newCount > 1 ? 's' : ''}!`,
      });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'GPS location unavailable';
      toast.show({
        type: 'error',
        title: 'Location Error',
        message: msg,
      });
      updateGpsButtonState(false, false);
    },
  });

  const btnGps = document.getElementById('btn-gps');

  function updateGpsButtonState(tracking: boolean, following: boolean): void {
    if (!btnGps) return;
    btnGps.classList.remove('tracking', 'following');
    if (following) {
      btnGps.classList.add('following');
      btnGps.setAttribute('title', 'Following position (Tap to stop)');
    } else if (tracking) {
      btnGps.classList.add('tracking');
      btnGps.setAttribute('title', 'Tracking active (Tap to center)');
    } else {
      btnGps.setAttribute('title', 'Start live GPS tracking');
    }
  }

  locationMarker.onFollowModeChange((following) => {
    if (tracker.isTracking()) {
      updateGpsButtonState(true, following);
    }
  });

  if (btnGps) {
    btnGps.onclick = () => {
      if (!tracker.isTracking()) {
        const started = tracker.start();
        if (started) {
          locationMarker.setFollowMode(true);
          updateGpsButtonState(true, true);
          toast.show({
            type: 'info',
            title: 'Live Tracking Active',
            message: 'Discovering hexagons as you move!',
          });
        }
      } else if (!locationMarker.isFollowMode()) {
        // Recenter and re-enable follow mode
        locationMarker.setFollowMode(true);
        updateGpsButtonState(true, true);
      } else {
        // Stop tracking
        tracker.stop();
        locationMarker.remove();
        updateGpsButtonState(false, false);
        toast.show({
          type: 'info',
          title: 'Live Tracking Paused',
          message: 'Location tracking turned off.',
        });
      }
    };
  }

  // 8. Share Target Manager (Processes background shared files on launch)
  const shareTargetManager = new ShareTargetManager(ingestionController, {
    onStartJob: (filename) => {
      progressModal.show(filename);
    },
    onProgress: (progress) => {
      progressModal.update(progress);
    },
    onJobComplete: async (summary) => {
      progressModal.dismiss();
      toast.show({
        type: 'success',
        title: 'Shared File Processed',
        message: `Unlocked ${summary.newHexCount} new hexes from ${summary.filename}`,
      });
      await reloadMapData(true);
    },
    onJobError: (filename, error) => {
      progressModal.dismiss();
      toast.show({
        type: 'error',
        title: 'Share Processing Failed',
        message: `Failed to process ${filename}: ${error.message}`,
      });
    },
  });

  await shareTargetManager.processPendingImports();
}

// Bootstrap application on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootstrapApp();
    });
  } else {
    bootstrapApp();
  }
}
