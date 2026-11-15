/**
 * Astronaut-navigation controller: owns the animation loop, the directional arrow marker and the
 * follow camera. React only renders compact HUD state from the store (updated at ~10 Hz).
 */
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { useStore } from '../state/store';
import { playbackWarp, positionAtTime } from './simulator';
import { arrivalPulseEl, navArrowEl } from '../map/markers';
import { angleDelta } from '../geo/mars';
import { easeInOutCubic } from '../map/easing';
import { immersive, navClock } from '../immersive/state';

/** Follow-camera zoom: close to the native 5 m/px resolution of the CTX orthomosaic (z14). */
const NAV_ZOOM = 14.7;
/** Walking moves ~3× slower: a slightly closer camera keeps the motion readable. */
const NAV_ZOOM_WALK = 15.2;
const navZoom = (mode: string | undefined) => (mode === 'walking' ? NAV_ZOOM_WALK : NAV_ZOOM);

export class NavigationController {
  private map: MlMap;
  private arrow: maplibregl.Marker | null = null;
  private pulse: maplibregl.Marker | null = null;
  private raf = 0;
  private last = 0;
  private camBearing = 0;
  private arrowBearing = 0;
  private lastUi = 0;
  private simTime = 0;
  private unsub: () => void;

  constructor(map: MlMap) {
    this.map = map;
    // the enhanced 3D renderer follows the same simulated clock (no second simulation)
    navClock.get = () => (this.raf ? this.simTime : null);
    this.unsub = useStore.subscribe((s, prev) => {
      if (s.navStatus !== prev.navStatus) this.onStatus(s.navStatus, prev.navStatus);
      if (s.navSimTime !== prev.navSimTime && Math.abs(s.navSimTime - this.simTime) > 1e-6) {
        this.simTime = s.navSimTime; // external restart / scrub
        this.renderFrame(true);
      }
      if (s.appMode !== prev.appMode && s.appMode === 'planning') this.teardown();
      if (s.route !== prev.route) this.teardown();
    });
  }

  private camOffset(): [number, number] {
    return [0, Math.round(this.map.getContainer().clientHeight * 0.17)];
  }

  dispose() {
    navClock.get = () => null;
    this.unsub();
    this.teardown();
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.arrow?.remove();
    this.arrow = null;
    this.pulse?.remove();
    this.pulse = null;
    (this.map.getSource('route_done') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  }

  /** Prepare the navigation view (arrow at the start, tilted camera) without moving. */
  enter() {
    const { route } = useStore.getState();
    if (!route) return;
    this.simTime = useStore.getState().navSimTime;
    const p = positionAtTime(route, this.simTime);
    this.camBearing = p.heading;
    this.arrowBearing = p.tangent;
    this.ensureArrow(p.lngLat, p.tangent);
    if (immersive.active) return; // the 3D renderer owns its own follow camera
    this.map.easeTo({ center: p.lngLat, offset: this.camOffset(), zoom: navZoom(route.mode), pitch: 62, bearing: p.heading, duration: 1800, easing: easeInOutCubic });
  }

  private ensureArrow(lngLat: [number, number], heading: number) {
    if (!this.arrow) {
      const mode = useStore.getState().route?.mode ?? 'rover';
      // Rover: flat chevron lying on the terrain. Walking: an upright pedestrian dot facing the camera
      // (readable under the tilted follow camera), its heading beam still rotating with the map.
      this.arrow = new maplibregl.Marker({ element: navArrowEl(mode), rotationAlignment: 'map', pitchAlignment: mode === 'walking' ? 'viewport' : 'map' })
        .setLngLat(lngLat)
        .addTo(this.map);
    }
    this.arrow.setLngLat(lngLat).setRotation(heading);
  }

  private onStatus(status: string, prev: string) {
    if (status === 'running') {
      if (prev === 'idle' || prev === 'arrived') {
        this.pulse?.remove();
        this.pulse = null;
      }
      this.simTime = useStore.getState().navSimTime;
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      const { route } = useStore.getState();
      if (route && !this.arrow) {
        const p = positionAtTime(route, this.simTime);
        this.camBearing = p.heading;
        this.arrowBearing = p.tangent;
        this.ensureArrow(p.lngLat, p.tangent);
      }
      this.raf = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (status === 'paused') useStore.setState({ navSimTime: this.simTime });
      if (status === 'idle') this.teardown();
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { route } = useStore.getState();
    if (!route) return;
    this.simTime = Math.min(route.timeS, this.simTime + dt * playbackWarp(route));
    const done = this.renderFrame(false, dt);
    if (now - this.lastUi > 100 || done) {
      this.lastUi = now;
      useStore.setState({ navSimTime: this.simTime });
    }
    if (done) {
      this.arrive();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderFrame(snap: boolean, dt = 0.016) {
    const { route } = useStore.getState();
    if (!route) return false;
    const p = positionAtTime(route, this.simTime);
    // critically-damped-ish bearing smoothing (no abrupt rotations)
    const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
    this.camBearing = (this.camBearing + angleDelta(this.camBearing, p.heading) * k + 360) % 360;
    // the arrow follows the local tangent closely but never snaps between directions
    const ka = snap ? 1 : 1 - Math.exp(-dt * 9);
    this.arrowBearing = (this.arrowBearing + angleDelta(this.arrowBearing, p.tangent) * ka + 360) % 360;
    if (immersive.active) return p.done; // hidden 2D map: no per-frame camera/marker work
    this.ensureArrow(p.lngLat, this.arrowBearing);
    // traveled part of the route is dimmed
    const done = route.coordinates.slice(0, p.seg + 1);
    done.push(p.lngLat);
    (this.map.getSource('route_done') as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: done },
    });
    // vehicle sits in the lower third of the view so more of the road ahead is visible
    this.map.easeTo({ center: p.lngLat, offset: this.camOffset(), bearing: this.camBearing, pitch: 62, zoom: this.map.getZoom() < 13.5 ? navZoom(route.mode) : this.map.getZoom(), duration: 0 });
    return p.done;
  }

  private arrive() {
    const { route } = useStore.getState();
    if (!route) return;
    const end = route.coordinates[route.coordinates.length - 1];
    useStore.setState({ navStatus: 'arrived', navSimTime: route.timeS });
    this.pulse = new maplibregl.Marker({ element: arrivalPulseEl(), pitchAlignment: 'map' }).setLngLat(end).addTo(this.map);
    if (immersive.active) {
      window.setTimeout(() => useStore.setState({ arrivalOpen: true }), 2600);
      return;
    }
    // cinematic arrival: slow orbit + gentle pull-back, then reveal destination card
    this.map.easeTo({
      center: end,
      zoom: 14.3,
      pitch: 52,
      bearing: this.camBearing + 110,
      duration: 4200,
      easing: easeInOutCubic,
    });
    window.setTimeout(() => useStore.setState({ arrivalOpen: true }), 2600);
  }
}

export { easeInOutCubic };
