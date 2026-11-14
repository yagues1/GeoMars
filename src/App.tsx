import { useEffect } from 'react';
import { MapView } from './map/MapView';
import { useStore } from './state/store';
import { loadGeologyIndex, loadPois, loadThemis } from './data/loaders';
import { routing } from './routing/client';
import { ArrivalCard, NavHUD } from './ui/components/Navigation';
import { LayersMenu } from './ui/components/LayersMenu';
import { BottomBar, IntroOverlay, MapControls, SourcesModal, Toast } from './ui/components/Chrome';
import { NavTopBar, Sidebar } from './ui/components/Sidebar';

function RouteBanner() {
  const origin = useStore((s) => s.origin);
  const dest = useStore((s) => s.destination);
  if (origin && dest) return null;
  return (
    <div className="gm-mode-banner glass-lite" key={origin ? 'd' : 'o'}>
      <span className={`gm-banner-dot ${origin ? 'dest' : 'origin'}`} />
      Click the map to place the {origin ? 'destination' : 'start'}
    </div>
  );
}

export default function App() {
  const phase = useStore((s) => s.phase);
  const mode = useStore((s) => s.appMode);
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
          {mode === 'planning' && <Sidebar />}
          {mode === 'navigation' && (
            <>
              <NavTopBar />
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
