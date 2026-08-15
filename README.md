# MyStrut 🗺️✨

> **Privacy-first, client-side exploration map & fog-of-war visualizer for your location history.**

MyStrut transforms your Google Location History (Google Takeout `Records.json` and modern `Timeline.json`) into an interactive, gamified exploration map powered by Uber H3 discrete global grid indexing and MapLibre GL JS GPU rendering.

---

## ✨ Features

- **100% Client-Side & Private:** All parsing, deduplication, spatial aggregation, and IndexedDB storage happen entirely in your browser. Zero telemetry, zero server uploads.
- **Continuous Path Discovery:** Intelligently interpolates walking and transit paths between consecutive GPS fixes into solid, continuous discovered ribbons at Uber H3 Resolution 11 (~25m edge length).
- **Modern Timeline Waypoints:** Extracts high-frequency `simplifiedRawPath`, `timelinePath`, and transit stop waypoints from modern semantic timeline exports.
- **Strut Fog-of-War Aesthetics:** Seamless inverse world mask (`polygon-clipping` Martinez-Rueda boolean difference) with crisp, daylight CARTO Voyager street views.
- **Density-Weighted Discovery Glow:** Zoom-adaptive GPU shader beacons that highlight explored cities at continent scale and smoothly dissolve at city level.
- **Exploration Analytics:** Slide-out drawer with $km^2$ explored grid area calculation, visit frequency, yearly comparisons, and temporal filtering (*All-Time*, *Specific Year*, *Latest Sync*).
- **Progressive Web App (PWA):** Installable on Mac, iOS, Android, and Windows with offline support and Web Share target integration.
- **Data Mobility:** Atomic JSON backup export, instant restoration, and double-confirmation local purge controls.

---

## 🛠️ Technology Stack

- **Framework:** TypeScript + Vite
- **Mapping:** MapLibre GL JS + CARTO Voyager GL style
- **Spatial Indexing:** Uber H3 (`h3-js` Resolution 11)
- **Geometry Operations:** `polygon-clipping`
- **Database:** Dexie.js (IndexedDB v3)
- **Architecture:** Web Workers for off-thread ingestion and viewport culling
- **Testing:** Vitest (16 test suites, 71 tests)

---

## 🚀 Local Development

```bash
# Install dependencies
npm install

# Run verification suite (TypeCheck + Vitest)
npm run verify

# Start development server
npm run dev

# Build production bundle
npm run build

# Preview production build
npm run preview
```

---

## 📄 License

MIT
