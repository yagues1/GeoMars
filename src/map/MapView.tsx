import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, STYLE_LAYERS } from './style';
import { setMap } from './mapRef';
import { destinationMarkerEl, inspectMarkerEl, originMarkerEl, poiMarkerEl } from './markers';
import { useStore, type LayerState } from '../state/store';
import { LOCAL_VIEW, TRUE_SCALE_EXAGGERATION } from '../config/constants';
import { NavigationController } from '../navigation/controller';
import { easeInOutCubic } from './easing';
import { routing } from '../routing/client';
import { geologyAt } from '../data/geology';
import { themisAt, type Poi } from '../data/loaders';
import { marsDistance, type LngLat } from '../geo/mars';
import { cancelReveal, showRoute } from './routeReveal';
import { boundsOf, routePadding } from '../state/actions';
import { PoiLayout } from './poiLayout';

const LAYER_IDS: Record<keyof LayerState, string[]> = {
  pois: [],
  hazard: ['hazard'],
  slope: ['slope'],
  traverse: ['traverse'],
  geology: ['geology-fill', 'geology-line', 'geology-boundary'],
  themisNight: ['themis-night'],
  themisDay: ['themis-day'],
  contours: ['contours'],
  coverage: ['coverage'],
  landingEllipse: ['landing-ellipse'],
};

let navController: NavigationController | null = null;
export function getNavController() {
  return navController;
}

function setVisible(map: MlMap, id: string, v: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
}

/**
 * Intro timeline (V1.2, ≈6.6 s of camera motion, was ≈16.8 s in V1.0):
 *   0.0 s  Mars in space, planet already turning (constant angular velocity, no idle pause)
 *   1.5 s  cinematic descent onto Jezero (flyTo, fast departure, long soft landing, slight tilt)
 *   5.3 s  settle into the top-down working view
 *   6.6 s  map ready, UI appears
 * Stages are chained with owned timers (not `moveend`), so user input, skips or unmounts can never
 * leave a stray stage running. Skip/interaction jumps straight to the working view.
 */
export const INTRO_TIMING = { rotateMs: 1500, descentMs: 3800, settleMs: 1300 } as const;
export const INTRO_TOTAL_MS = INTRO_TIMING.rotateMs + INTRO_TIMING.descentMs + INTRO_TIMING.settleMs;

interface IntroHandle {
  skip: () => void;
  dispose: () => void;
}
let activeIntro: IntroHandle | null = null;
let skipRequested = false;

function jumpToWorkingView(map: MlMap) {
  map.stop();
  map.jumpTo({ center: LOCAL_VIEW.center, zoom: LOCAL_VIEW.zoom, pitch: 0, bearing: 0 });
}

function runIntro(map: MlMap, onDone: () => void): IntroHandle {
  let finished = false;
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => !finished && fn(), ms));
  const canvas = map.getCanvasContainer();
  const onUserInput = () => handle.skip();
  const cleanup = () => {
    timers.forEach((t) => window.clearTimeout(t));
    timers.length = 0;
    canvas.removeEventListener('wheel', onUserInput);
    canvas.removeEventListener('pointerdown', onUserInput);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    onDone();
  };
  const handle: IntroHandle = {
    skip: () => {
      if (finished) return;
      jumpToWorkingView(map);
      finish();
    },
    dispose: () => {
      finished = true;
      cleanup();
    },
  };
  // Grabbing or scrolling the globe during the intro means "let me use the map": skip cleanly.
  canvas.addEventListener('wheel', onUserInput, { passive: true });
  canvas.addEventListener('pointerdown', onUserInput);

  const { rotateMs, descentMs, settleMs } = INTRO_TIMING;
  // 1. rotation at constant angular velocity — the planet is already moving when the intro opens
  map.easeTo({ center: [42, 13], zoom: 1.8, duration: rotateMs, easing: (t) => t, essential: true });
  // 2. descent: departs with momentum (matches the rotation), long soft landing over Jezero
  at(rotateMs, () =>
    map.flyTo({
      center: [77.52, 18.44],
      zoom: 10.8,
      pitch: 34,
      bearing: -10,
      duration: descentMs,
      easing: (t) => 1 - (1 - t) ** 2.4,
      essential: true,
    }),
  );
  // 3. settle into the top-down working view
  at(rotateMs + descentMs, () =>
    map.easeTo({ center: LOCAL_VIEW.center, zoom: LOCAL_VIEW.zoom, pitch: 0, bearing: 0, duration: settleMs, easing: easeInOutCubic, essential: true }),
  );
  at(rotateMs + descentMs + settleMs, finish);
  return handle;
}

/** Skip the intro at any moment — before the map has loaded, during rotation, descent or settle. */
export function skipIntro() {
  const s = useStore.getState();
  if (s.phase === 'ready') return;
  useStore.setState({ introSkipped: true });
  if (activeIntro) {
    activeIntro.skip();
    return;
  }
  // map not loaded yet: remember the request and move the camera now so Jezero tiles load first
  skipRequested = true;
  const map = (window as unknown as { __geomarsMap?: MlMap }).__geomarsMap;
  if (map) jumpToWorkingView(map);
}

async function inspectAt(lngLat: LngLat) {
  const { pois } = useStore.getState();
  const terrain = await routing().inspect(lngLat).catch(() => null);
  let nearest: { poi: Poi; distanceM: number } | null = null;
  for (const p of pois) {
    const d = marsDistance(lngLat, [p.lon, p.lat]);
    if (!nearest || d < nearest.distanceM) nearest = { poi: p, distanceM: d };
  }
  useStore.setState({
    inspect: {
      lngLat,
      terrain,
      geologyUnit: geologyAt(lngLat),
      themisNight: themisAt('themis_nightir', lngLat),
      themisDay: themisAt('themis_dayir', lngLat),
      nearestPoi: nearest && nearest.distanceM < 5000 ? nearest : null,
    },
    selectedPoi: null,
  });
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map = new maplibregl.Map({
      container: ref.current!,
      style: buildStyle(),
      center: [-30, 8],
      zoom: 1.45,
      minZoom: 0.8,
      maxZoom: 17.5,
      maxPitch: 78,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 200,
      canvasContextAttributes: { antialias: true },
      cancelPendingTileRequestsWhileZooming: true,
    } as maplibregl.MapOptions);
    map.touchZoomRotate.enableRotation();
    map.keyboard.enable();
    setMap(map);
    (window as unknown as { __geomarsMap: MlMap }).__geomarsMap = map; // debugging / verification hook

    let originMk: maplibregl.Marker | null = null;
    let destMk: maplibregl.Marker | null = null;
    let inspectMk: maplibregl.Marker | null = null;
    const poiMarkers: maplibregl.Marker[] = [];
    const poiLayout = new PoiLayout(map);

    const applyStyle = () => {
      const s = useStore.getState();
      const conf = STYLE_LAYERS[s.mapStyle];
      conf.show.forEach((id) => setVisible(map, id, true));
      conf.hide.forEach((id) => setVisible(map, id, false));
      if (s.mapStyle === 'topographic') setVisible(map, 'contours', true);
      else setVisible(map, 'contours', s.layers.contours);
      // keep overlays legible: automatic transparency when several are combined
      const active = ['slope', 'geology', 'themisNight', 'themisDay'].filter((k) => s.layers[k as keyof LayerState]).length;
      const f = active <= 1 ? 1 : active === 2 ? 0.78 : 0.62;
      if (map.getLayer('slope')) map.setPaintProperty('slope', 'raster-opacity', 0.8 * f);
      if (map.getLayer('geology-fill')) map.setPaintProperty('geology-fill', 'fill-opacity', 0.42 * f);
      if (map.getLayer('themis-night')) map.setPaintProperty('themis-night', 'raster-opacity', 0.72 * f);
      if (map.getLayer('themis-day')) map.setPaintProperty('themis-day', 'raster-opacity', 0.72 * f);
    };

    const applyLayers = () => {
      const { layers } = useStore.getState();
      for (const [k, ids] of Object.entries(LAYER_IDS)) ids.forEach((id) => setVisible(map, id, layers[k as keyof LayerState]));
      poiMarkers.forEach((m) => (m.getElement().style.display = layers.pois ? '' : 'none'));
      applyStyle();
    };

    const applyTerrain = () => {
      const { view3d, exaggeration, appMode } = useStore.getState();
      if (view3d) {
        map.setTerrain({ source: 'terrain', exaggeration: TRUE_SCALE_EXAGGERATION * exaggeration });
        if (appMode === 'planning' && map.getPitch() < 30) map.easeTo({ pitch: 58, duration: 1200, easing: easeInOutCubic });
      } else {
        map.setTerrain(null);
        if (appMode === 'planning' && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 1000, easing: easeInOutCubic });
      }
    };

    const applyRoute = (animate = false) => {
      const { route, appMode } = useStore.getState();
      showRoute(map, route, animate && appMode === 'planning');
    };

    const applyEndpoints = () => {
      const { origin, destination } = useStore.getState();
      if (origin) {
        originMk ??= new maplibregl.Marker({ element: originMarkerEl() }).setLngLat(origin).addTo(map);
        originMk.setLngLat(origin);
      } else {
        originMk?.remove();
        originMk = null;
      }
      if (destination) {
        destMk ??= new maplibregl.Marker({ element: destinationMarkerEl(), anchor: 'bottom', offset: [0, 2] }).setLngLat(destination).addTo(map);
        destMk.setLngLat(destination);
      } else {
        destMk?.remove();
        destMk = null;
      }
    };

    const applyInspect = () => {
      const { inspect, tool, appMode } = useStore.getState();
      if (inspect && tool === 'explore' && appMode === 'planning') {
        inspectMk ??= new maplibregl.Marker({ element: inspectMarkerEl() }).setLngLat(inspect.lngLat).addTo(map);
        inspectMk.setLngLat(inspect.lngLat);
      } else {
        inspectMk?.remove();
        inspectMk = null;
      }
    };

    const buildPoiMarkers = () => {
      poiMarkers.forEach((m) => m.remove());
      poiMarkers.length = 0;
      const entries: { poi: Poi; el: HTMLElement }[] = [];
      for (const p of useStore.getState().pois) {
        const el = poiMarkerEl(p.name, p.category);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const s = useStore.getState();
          if (s.appMode !== 'planning') return;
          // Explore: a marker standing for several nearby sites first zooms in to separate them.
          // Route: the marker always sets its own site (its label names it).
          if (s.tool === 'explore' && Number(el.dataset.cluster) > 0 && map.getZoom() < 14.5) {
            map.easeTo({ center: [p.lon, p.lat], zoom: Math.min(16, map.getZoom() + 1.8), duration: 800, easing: easeInOutCubic });
            return;
          }
          if (s.tool === 'route') s.setPoint([p.lon, p.lat], p.name);
          else {
            useStore.setState({ selectedPoi: p, inspect: null });
            map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13.2), duration: 900, easing: easeInOutCubic });
          }
        });
        poiMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
        entries.push({ poi: p, el });
      }
      poiLayout.setEntries(entries);
      applySelected();
      applyLayers();
    };

    const applySelected = () => {
      const { selectedPoi } = useStore.getState();
      poiMarkers.forEach((m) => {
        const el = m.getElement();
        el.classList.toggle('is-selected', !!selectedPoi && el.getAttribute('aria-label') === selectedPoi.name);
      });
      poiLayout.setSelected(selectedPoi?.id ?? null);
    };

    const onZoom = () => {
      ref.current?.classList.toggle('hide-pois', map.getZoom() < 9);
    };

    map.on('zoom', onZoom);

    // Floating panels step back while the user drags/rotates the map, and return afterwards.
    let interactT = 0;
    const startInteract = (e: { originalEvent?: Event }) => {
      if (!e.originalEvent) return;
      window.clearTimeout(interactT);
      document.body.classList.add('gm-interacting');
    };
    const endInteract = () => {
      window.clearTimeout(interactT);
      interactT = window.setTimeout(() => document.body.classList.remove('gm-interacting'), 450);
    };
    map.on('dragstart', startInteract);
    map.on('rotatestart', startInteract);
    map.on('pitchstart', startInteract);
    map.on('dragend', endInteract);
    map.on('rotateend', endInteract);
    map.on('pitchend', endInteract);

    map.on('click', (e) => {
      const s = useStore.getState();
      if (s.phase !== 'ready' || s.appMode !== 'planning') return;
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      if (s.tool === 'route') s.setPoint(p);
      else void inspectAt(p);
    });

    let styleReady = false;
    map.on('load', () => {
      styleReady = true;
      navController = new NavigationController(map);
      applyLayers();
      applyRoute();
      applyEndpoints();
      buildPoiMarkers();
      onZoom();
      useStore.setState({ dataReady: true });
      const done = () => {
        activeIntro = null;
        useStore.setState({ phase: 'ready' });
      };
      if (reduceMotion || skipRequested || useStore.getState().introSkipped) {
        // reduced motion or already skipped: no camera animation, straight to the working view
        jumpToWorkingView(map);
        done();
      } else activeIntro = runIntro(map, done);
    });

    // adaptive quality: lower pixel ratio on sustained low frame rates (performance > detail)
    let frames = 0;
    let t0 = performance.now();
    let degraded = false;
    const onRender = () => {
      frames++;
      const now = performance.now();
      if (now - t0 > 2000) {
        const fps = (frames * 1000) / (now - t0);
        if (!degraded && fps < 28 && map.isMoving() && window.devicePixelRatio > 1) {
          degraded = true;
          map.setPixelRatio(1);
        }
        frames = 0;
        t0 = now;
      }
    };
    map.on('render', onRender);

    const unsub = useStore.subscribe((s, prev) => {
      if (!styleReady) return;
      if (s.layers !== prev.layers || s.mapStyle !== prev.mapStyle) applyLayers();
      if (s.view3d !== prev.view3d || s.exaggeration !== prev.exaggeration) applyTerrain();
      if (s.route !== prev.route) applyRoute(!!s.route);
      if (s.selectedPoi !== prev.selectedPoi) applySelected();
      if (s.origin !== prev.origin || s.destination !== prev.destination) applyEndpoints();
      if (s.inspect !== prev.inspect || s.tool !== prev.tool || s.appMode !== prev.appMode) applyInspect();
      if (s.pois !== prev.pois) buildPoiMarkers();
      if (s.appMode !== prev.appMode) {
        ref.current?.classList.toggle('nav-mode', s.appMode === 'navigation');
        poiLayout.setLabelsEnabled(s.appMode !== 'navigation');
        if (s.appMode === 'navigation') {
          cancelReveal();
          navController?.enter();
        }
        else if (prev.appMode === 'navigation') {
          const r = s.route;
          if (r) {
            map.fitBounds(boundsOf(r.coordinates), { padding: routePadding(), pitch: s.view3d ? 50 : 0, bearing: 0, duration: 1600, maxZoom: 15 });
          } else map.easeTo({ pitch: s.view3d ? 50 : 0, bearing: 0, duration: 1200 });
        }
      }
    });

    return () => {
      activeIntro?.dispose();
      activeIntro = null;
      unsub();
      poiLayout.dispose();
      cancelReveal();
      navController?.dispose();
      navController = null;
      map.remove();
      setMap(null);
    };
  }, []);

  return <div ref={ref} className="gm-map" role="application" aria-label="Interactive map of Jezero Crater, Mars" />;
}

