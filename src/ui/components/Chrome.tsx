import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { getMap, marsMetersPerPixel, withMap } from '../../map/mapRef';
import { formatCoord } from '../../geo/mars';
import { DATASETS } from '../../data/datasets';
import { skipIntro } from '../../map/MapView';
import { enterNavigationPaused } from '../../state/actions';
import { GeoMarsLogo, LOGO_SRC, IconChevron, IconClose, IconCompass, IconCube, IconInfo, IconLayers, IconMinus, IconNav, IconPlus } from '../icons/Icons';
import { StatusTag } from './StatusTag';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`gm-brand ${compact ? 'compact' : ''}`}>
      <GeoMarsLogo size={compact ? 30 : 34} />
      <span className="gm-wordmark">
        Geo<span>Mars</span>
      </span>
    </div>
  );
}

/** Intro lockup: the approved logo image itself (it already contains the GeoMars wordmark). */
export function BrandLockup() {
  return (
    <div className="gm-lockup">
      <img src={LOGO_SRC} alt="GeoMars" className="gm-lockup-img" draggable={false} />
    </div>
  );
}

export function ModeSwitch() {
  const mode = useStore((s) => s.appMode);
  const hasRoute = useStore((s) => !!s.route);
  return (
    <div className="gm-mode" role="tablist" aria-label="Mission mode">
      <button role="tab" aria-selected={mode === 'planning'} className={mode === 'planning' ? 'on' : ''} onClick={() => mode !== 'planning' && useStore.getState().set({ appMode: 'planning', navStatus: useStore.getState().navStatus === 'running' ? 'paused' : useStore.getState().navStatus })}>
        Mission Planning
      </button>
      <button
        role="tab"
        aria-selected={mode === 'navigation'}
        className={mode === 'navigation' ? 'on' : ''}
        disabled={!hasRoute}
        title={hasRoute ? 'Follow the calculated route' : 'Calculate a route first'}
        onClick={() => mode !== 'navigation' && enterNavigationPaused()}
      >
        <IconNav size={14} /> Astronaut Navigation
      </button>
      <span className="gm-seg-thumb" style={{ transform: `translateX(${mode === 'planning' ? 0 : 100}%)` }} />
    </div>
  );
}

export function MapControls() {
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const view3d = useStore((s) => s.view3d);
  const layersOpen = useStore((s) => s.layersOpen);
  useEffect(() => {
    let off = () => {};
    withMap((m) => {
      const fn = () => {
        setBearing(m.getBearing());
        setPitch(m.getPitch());
      };
      m.on('rotate', fn);
      m.on('pitch', fn);
      off = () => {
        m.off('rotate', fn);
        m.off('pitch', fn);
      };
    });
    return () => off();
  }, []);
  return (
    <div className="gm-controls">
      <button className={`gm-ctl glass ${layersOpen ? 'on' : ''}`} onClick={() => useStore.getState().set({ layersOpen: !layersOpen })} aria-label="Map styles and layers" title="Map styles & layers (L)">
        <IconLayers size={20} />
      </button>
      <button className={`gm-ctl glass ${view3d ? 'on' : ''}`} onClick={() => useStore.getState().set({ view3d: !view3d })} aria-label="Toggle 3D terrain" title="2D / 3D (also in Layers)">
        <IconCube size={19} />
        <span className="gm-ctl-tag">{view3d ? '3D' : '2D'}</span>
      </button>
      <div className="gm-ctl-stack glass">
        <button className="gm-ctl" onClick={() => getMap()?.zoomIn({ duration: 350 })} aria-label="Zoom in"><IconPlus size={18} /></button>
        <span className="gm-ctl-sep" />
        <button className="gm-ctl" onClick={() => getMap()?.zoomOut({ duration: 350 })} aria-label="Zoom out"><IconMinus size={18} /></button>
      </div>
      {(Math.abs(bearing) > 0.5 || pitch > 0.5) && (
        <button className="gm-ctl glass" onClick={() => getMap()?.easeTo({ bearing: 0, pitch: view3d ? pitch : 0, duration: 700 })} aria-label="Reset north" title="Reset north">
          <IconCompass size={20} style={{ transform: `rotate(${-bearing}deg)`, color: '#ff9a52' }} />
        </button>
      )}
    </div>
  );
}

export function BottomBar() {
  const [coord, setCoord] = useState<string>('');
  const [scale, setScale] = useState<{ w: number; label: string }>({ w: 80, label: '' });
  const set = useStore((s) => s.set);
  useEffect(() => {
    let off = () => {};
    withMap((m) => {
      const move = (e: { lngLat: { lng: number; lat: number } }) => setCoord(formatCoord([e.lngLat.lng, e.lngLat.lat], 4));
      const upd = () => {
        const c = m.getCenter();
        const mpp = marsMetersPerPixel(m.getZoom(), c.lat);
        const maxM = mpp * 110;
        const pow = 10 ** Math.floor(Math.log10(maxM));
        const nice = [5, 2, 1].map((k) => k * pow).find((v) => v <= maxM) ?? pow;
        setScale({ w: nice / mpp, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` });
      };
      m.on('mousemove', move);
      m.on('move', upd);
      upd();
      off = () => {
        m.off('mousemove', move);
        m.off('move', upd);
      };
    });
    return () => off();
  }, []);
  return (
    <div className="gm-bottom">
      <div className="gm-scale glass-lite" aria-label={`Scale ${scale.label} on Mars`}>
        <span className="gm-scale-bar" style={{ width: scale.w }} />
        <span>{scale.label}</span>
      </div>
      {coord && <div className="gm-coord glass-lite">{coord}</div>}
      <button className="gm-credits glass-lite" onClick={() => set({ sourcesOpen: true })}>
        <IconInfo size={14} /> Data: NASA · USGS · JPL — sources
      </button>
    </div>
  );
}

export function SourcesModal() {
  const open = useStore((s) => s.sourcesOpen);
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="gm-modal-backdrop" onClick={() => set({ sourcesOpen: false })}>
      <div className="gm-modal glass gm-pop-in" role="dialog" aria-modal="true" aria-label="Data and sources" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && set({ sourcesOpen: false })}>
        <div className="gm-card-head">
          <h3>Data & sources</h3>
          <button className="gm-icon-btn" onClick={() => set({ sourcesOpen: false })} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        <p className="gm-fine">
          Coordinates: Mars planetocentric latitude, east-positive longitude (−180…180), Mars 2000 sphere R = 3,396,190 m. Distances are computed on that sphere along
          the actual route geometry (3D surface length). Map tiles use a Mercator tiling scheme for display only.
        </p>
        <div className="gm-ds-list">
          {DATASETS.map((d) => (
            <article key={d.id} className="gm-ds">
              <header>
                <strong>{d.title}</strong> <StatusTag s={d.status} />
              </header>
              <dl className="gm-kv small">
                <dt>Source</dt><dd>{d.source}</dd>
                <dt>Product</dt><dd>{d.product}</dd>
                <dt>Instrument</dt><dd>{d.instrument} · {d.mission}</dd>
                <dt>Date</dt><dd>{d.date}</dd>
                <dt>Resolution</dt><dd>{d.resolution}</dd>
                <dt>Coverage</dt><dd>{d.coverage}</dd>
                <dt>Role</dt><dd>{d.role}</dd>
                <dt>Limitations</dt><dd>{d.limitations}</dd>
              </dl>
              {d.url && (
                <a href={d.url} target="_blank" rel="noreferrer" className="gm-link">
                  {d.url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </article>
          ))}
        </div>
        <p className="gm-fine">
          GeoMars routes are estimates for exploration planning and education. They are not astronaut-grade or safety-certified traverse plans.
        </p>
      </div>
    </div>
  );
}

export function IntroOverlay() {
  const phase = useStore((s) => s.phase);
  const dataReady = useStore((s) => s.dataReady);
  const skipped = useStore((s) => s.introSkipped);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (phase === 'ready') {
      const t = window.setTimeout(() => setGone(true), 650);
      return () => window.clearTimeout(t);
    }
  }, [phase]);
  useEffect(() => {
    if (phase !== 'intro') return;
    // Esc skips from anywhere; Enter/Space work on the (Tab-reachable) button natively
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skipIntro();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);
  if (gone) return null;
  const status = skipped ? 'Opening Jezero Crater…' : dataReady ? 'Descending to Jezero · 18.4° N, 77.5° E' : 'Loading NASA & USGS data…';
  return (
    <div className={`gm-intro ${phase === 'ready' ? 'out' : ''} ${skipped ? 'skipped' : ''}`} aria-hidden={phase === 'ready'}>
      <div className="gm-intro-stage">
        <BrandLockup />
        <p className="gm-intro-sub">Terrain-aware navigation · Jezero Crater, Mars</p>
      </div>
      <div className="gm-intro-foot">
        <div className="gm-intro-status" role="status" aria-live="polite">
          <span className={`gm-intro-dot ${dataReady ? 'live' : ''}`} aria-hidden="true" />
          {status}
        </div>
        {phase === 'intro' && (
          <button type="button" className="gm-btn gm-skip glass-lite" onClick={skipIntro} aria-label="Skip intro and open the Jezero map (Esc)">
            Skip intro <IconChevron size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => useStore.setState({ toast: null }), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className="gm-toast glass gm-pop-in" role="status">{toast}</div>;
}
