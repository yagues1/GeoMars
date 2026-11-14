import { useStore } from '../../state/store';
import { backToPlanning } from '../../state/actions';
import { Brand } from './Chrome';
import { SearchBox } from './Search';
import { PlanningPanel, ToolSwitch } from './PlanningPanel';
import { IconBack, IconInfo, IconLayers, IconSidebar } from '../icons/Icons';

/**
 * Floating Liquid-Glass sidebar: one glass shell with a fixed head (brand, search, mode) and a
 * collapsible, scrollable body. Secondary scientific controls live in a quiet footer.
 */
export function Sidebar() {
  const hidden = useStore((s) => s.panelsHidden);
  const layersOpen = useStore((s) => s.layersOpen);
  const set = useStore((s) => s.set);
  return (
    <aside className={`gm-sidebar ${hidden ? 'collapsed' : ''}`} aria-label="Mission planning">
      <div className="gm-shell glass" data-map-obstacle>
        <header className="gm-head">
          <Brand compact />
          <div className="gm-head-meta">
            <span>Jezero Crater</span>
            <span className="gm-mono">18.4°N · 77.5°E</span>
          </div>
          <button className="gm-icon-btn gm-collapse-btn" onClick={() => set({ panelsHidden: !hidden })} aria-label={hidden ? 'Expand panel' : 'Collapse panel'} aria-expanded={!hidden} title="Collapse / expand (H)">
            <IconSidebar size={18} />
          </button>
        </header>
        <SearchBox />
        <div className="gm-side-body" data-open={!hidden} inert={hidden}>
          <div className="gm-side-inner">
            <ToolSwitch />
            <div className="gm-panel-body">
              <PlanningPanel />
            </div>
            <footer className="gm-side-foot">
              <button className={`gm-foot-btn ${layersOpen ? 'on' : ''}`} onClick={() => set({ layersOpen: !layersOpen })} title="Map styles & scientific layers (L)">
                <IconLayers size={15} /> Layers & data
              </button>
              <button className="gm-foot-btn" onClick={() => set({ sourcesOpen: true })}>
                <IconInfo size={15} /> Sources
              </button>
            </footer>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Compact top bar during Astronaut Navigation: way back to planning + where we're heading. */
export function NavTopBar() {
  const dest = useStore((s) => s.destinationLabel);
  const status = useStore((s) => s.navStatus);
  return (
    <div className="gm-navbar glass" data-map-obstacle>
      <button className="gm-navbar-back" onClick={backToPlanning} aria-label="Return to mission planning">
        <IconBack size={18} />
        <span>Planning</span>
      </button>
      <div className="gm-navbar-sep" />
      <div className="gm-navbar-text">
        <span className={`gm-live ${status}`} aria-hidden="true" />
        <span className="gm-navbar-kicker">{status === 'arrived' ? 'Arrived' : status === 'running' ? 'Navigating to' : 'Route to'}</span>
        <span className="gm-navbar-dest">{dest ?? 'Destination'}</span>
      </div>
    </div>
  );
}
