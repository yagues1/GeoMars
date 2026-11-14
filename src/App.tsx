import { useEffect } from 'react';
import { MapView } from './map/MapView';
import { useStore } from './state/store';
import { loadGeologyIndex, loadPois, loadThemis } from './data/loaders';
import { routing } from './routing/client';
import { PlanningPanel } from './ui/components/PlanningPanel';
import { ArrivalCard, NavHUD } from './ui/components/Navigation';
import { LayersMenu } from './ui/components/LayersMenu';
import { BottomBar, Brand, IntroOverlay, MapControls, ModeSwitch, SourcesModal, Toast } from './ui/components/Chrome';
import { SearchBox } from './ui/components/Search';
import { IconChevron } from './ui/icons/Icons';

function RouteBanner() {
  const origin = useStore((s) => s.origin);
  const dest = useStore((s) => s.destination);
  if (origin && dest) return null;
  return <div className="gm-mode-banner glass-lite">Route mode · click the map to place {origin ? 'the destination' : 'the origin'}</div>;
}

export default function App() {
  const phase = useStore((s) => s.phase);
  const mode = useStore((s) => s.appMode);
  const hidden = useStore((s) => s.panelsHidden);
  const tool = useStore((s) => s.tool);

  useEffect(() => {
    loadPois().then((pois) => useStore.setState({ pois }));
    void loadGeologyIndex();
    void loadThemis();
    routing()
      .ready.then(() => useStore.setState({ routingReady: true }))
      .catch((e) => useStore.setState({ toast: `Routing grid failed to load: ${e}` }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useStore.getState();
      if (e.key === 'l' || e.key === 'L') s.set({ layersOpen: !s.layersOpen });
      else if (e.key === 'h' || e.key === 'H') s.set({ panelsHidden: !s.panelsHidden });
      else if (e.key === 'Escape') s.set({ layersOpen: false, inspect: null, selectedPoi: null });
      else if (e.key === ' ' && s.appMode === 'navigation') {
        e.preventDefault();
        if (s.navStatus === 'running') s.set({ navStatus: 'paused' });
        else if (s.navStatus === 'paused' || s.navStatus === 'idle') s.set({ navStatus: 'running' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ready = phase === 'ready';
  return (
    <div className={`gm-app ${ready ? 'ready' : 'intro'} mode-${mode} tool-${tool}`}>
      <MapView />
      <div className="gm-vignette" aria-hidden="true" />
      <IntroOverlay />
      {ready && (
        <>
          <header className="gm-top">
            <div className="gm-top-left glass">
              <Brand compact />
              <SearchBox />
            </div>
          </header>
          {mode === 'planning' && (
            <aside className={`gm-side glass ${hidden ? 'collapsed' : ''}`} aria-label="Mission planning">
              <ModeSwitch />
              {!hidden && <PlanningPanel />}
              <button className="gm-collapse" onClick={() => useStore.getState().set({ panelsHidden: !hidden })} aria-label={hidden ? 'Show panel' : 'Hide panel'} title="Hide/show panel (H)">
                <IconChevron size={16} style={{ transform: hidden ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
              </button>
            </aside>
          )}
          {mode === 'navigation' && (
            <>
              <div className="gm-nav-mode glass">
                <ModeSwitch />
              </div>
              <NavHUD />
            </>
          )}
          <MapControls />
          <LayersMenu />
          <ArrivalCard />
          <BottomBar />
          <SourcesModal />
          <Toast />
          {mode === 'planning' && tool === 'route' && <RouteBanner />}
        </>
      )}
    </div>
  );
}
