import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, STYLE_LAYERS } from './style';
import { setMap } from './mapRef';
import { destinationMarkerEl, inspectMarkerEl, originMarkerEl, poiMarkerEl } from './markers';
import { useStore, type LayerState } from '../state/store';
import { LOCAL_VIEW, TRUE_SCALE_EXAGGERATION } from '../config/constants';
import { NavigationController, easeInOutCubic } from '../navigation/controller';
import { routing } from '../routing/client';
import { geologyAt } from '../data/geology';
import { themisAt, type Poi } from '../data/loaders';
import { marsDistance, type LngLat } from '../geo/mars';
import { cancelReveal, showRoute } from './routeReveal';
import { routePadding } from '../state/actions';
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

/** Intro: Mars from space → planetary rotation → cinematic descent onto Jezero. */
function runIntro(map: MlMap, onDone: () => void) {
  let cancelled = false;
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    onDone();
  };
  (map as unknown as { __skipIntro?: () => void }).__skipIntro = () => {
    if (cancelled) return;
    map.stop();
    map.jumpTo({ center: LOCAL_VIEW.center, zoom: LOCAL_VIEW.zoom, pitch: 0, bearing: 0 });
    finish();
  };
  // 1. slow planetary rotation (≈ 5 s)
  map.easeTo({ center: [52, 14], zoom: 1.75, duration: 5200, easing: (t) => t, essential: true });
  map.once('moveend', () => {
    if (cancelled) return;
    // 2. descent: fly into Jezero with a slight cinematic tilt, then settle top-down
    map.flyTo({
      center: [77.55, 18.43],
      zoom: 10.4,
      pitch: 38,
      bearing: -12,
      curve: 1.55,
      speed: 0.62,
      essential: true,
      easing: easeInOutCubic,
    });
    map.once('moveend', () => {
      if (cancelled) return;
      map.easeTo({ center: LOCAL_VIEW.center, zoom: LOCAL_VIEW.zoom, pitch: 0, bearing: 0, duration: 2200, easing: easeInOutCubic });
      map.once('moveend', finish);
    });
  });
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
      const done = () => useStore.setState({ phase: 'ready' });
      if (reduceMotion) {
        map.jumpTo({ center: LOCAL_VIEW.center, zoom: LOCAL_VIEW.zoom });
        done();
      } else window.setTimeout(() => runIntro(map, done), 700);
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
            const b = new maplibregl.LngLatBounds();
            r.coordinates.forEach((c) => b.extend(c));
            map.fitBounds(b, { padding: routePadding(), pitch: s.view3d ? 50 : 0, bearing: 0, duration: 1600, maxZoom: 15 });
          } else map.easeTo({ pitch: s.view3d ? 50 : 0, bearing: 0, duration: 1200 });
        }
      }
    });

    return () => {
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

export function skipIntro() {
  const m = (window as unknown as { __geomarsMap?: MlMap }).__geomarsMap as unknown as { __skipIntro?: () => void } | undefined;
  m?.__skipIntro?.();
}
