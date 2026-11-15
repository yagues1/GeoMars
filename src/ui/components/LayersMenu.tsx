import { useStore, type LayerState, type MapStyleId } from '../../state/store';
import { IconClose } from '../icons/Icons';
import { DATA_BASE } from '../../config/constants';
import { GEO_UNITS } from '../../data/geology';
import { QUALITY, type QualityId } from '../../immersive/quality';
import { ENHANCED_3D_DISCLOSURE } from '../../immersive/state';

const QUALITY_IDS: QualityId[] = ['performance', 'balanced', 'cinematic'];

const STYLES: { id: MapStyleId; label: string; thumb: string }[] = [
  { id: 'satellite', label: 'Satellite', thumb: `${DATA_BASE}/tiles/ortho/11/1464/917.webp` },
  { id: 'topographic', label: 'Topographic', thumb: `${DATA_BASE}/tiles/topo/11/1464/917.webp` },
  { id: 'hybrid', label: 'Hybrid', thumb: `${DATA_BASE}/tiles/ortho/11/1464/917.webp` },
];

interface Item {
  key?: keyof LayerState;
  label: string;
  note: string;
  unavailable?: boolean;
  legend?: 'hazard' | 'slope' | 'geology' | 'themis';
}

const QUALITY_NOTES: Record<QualityId, string> = {
  performance: 'Fewer rocks, no shadows, lighter terrain mesh — most responsive',
  balanced: 'Detailed terrain, rocks and soft shadows — recommended',
  cinematic: 'Densest terrain and rocks, high-resolution shadows and extra surface detail',
};

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Surface',
    items: [
      { key: 'slope', label: 'Slope', note: 'Derived · CTX DEM 20 m', legend: 'slope' },
      { key: 'contours', label: 'Elevation contours', note: 'Derived · 100 m interval' },
    ],
  },
  {
    title: 'Geology',
    items: [
      { key: 'geology', label: 'Geologic units', note: 'USGS SIM 3464 · 1:75k', legend: 'geology' },
      { key: 'pois', label: 'Scientific sites', note: 'NASA samples · IAU names' },
      { label: 'Mineral maps (CRISM)', note: 'Not integrated in V1.0', unavailable: true },
    ],
  },
  {
    title: 'Environment',
    items: [
      { key: 'themisNight', label: 'THEMIS night IR', note: 'Observed · relative brightness', legend: 'themis' },
      { key: 'themisDay', label: 'THEMIS day IR', note: 'Observed · relative brightness', legend: 'themis' },
      { label: 'Historical weather (MEDA)', note: 'Not integrated in V1.0', unavailable: true },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { key: 'hazard', label: 'Hazard zones', note: 'Derived · ≥15° caution, ≥20° no-go', legend: 'hazard' },
      { key: 'traverse', label: 'Perseverance traverse', note: 'NASA/JPL · sols 13–2022' },
      { key: 'coverage', label: 'Routing coverage', note: 'CTX DEM footprint' },
      { key: 'landingEllipse', label: 'Mars 2020 landing ellipse', note: 'USGS SIM 3464' },
    ],
  },
];

function Legend({ kind }: { kind: NonNullable<Item['legend']> }) {
  if (kind === 'hazard')
    return (
      <div className="gm-legend">
        <span><i style={{ background: 'rgba(240,168,60,.75)' }} />15–20° caution</span>
        <span><i style={{ background: 'rgba(220,50,38,.85)' }} />≥20° excluded</span>
      </div>
    );
  if (kind === 'slope')
    return (
      <div className="gm-legend ramp">
        <i style={{ background: 'linear-gradient(90deg, rgba(250,222,160,.5), #f6b05c, #e87834, #c43c28, #78142a)' }} />
        <span>0°</span><span>15°</span><span>30°+</span>
      </div>
    );
  if (kind === 'themis')
    return (
      <div className="gm-legend ramp">
        <i style={{ background: 'linear-gradient(90deg,#140c1e,#6e2828,#d66e32,#ffe2aa)' }} />
        <span>darker</span><span>brighter (relative DN)</span>
      </div>
    );
  return (
    <div className="gm-legend units">
      {Object.entries(GEO_UNITS).map(([k, u]) => (
        <span key={k} title={u.name}><i style={{ background: u.color }} />{k}</span>
      ))}
    </div>
  );
}

export function LayersMenu() {
  const open = useStore((s) => s.layersOpen);
  const s = useStore();
  if (!open) return null;
  return (
    <aside className="gm-layers glass gm-slide-in-right" aria-label="Map styles and layers" data-map-obstacle>
      <div className="gm-card-head">
        <h3>Map & layers</h3>
        <button className="gm-icon-btn" onClick={() => s.set({ layersOpen: false })} aria-label="Close layers">
          <IconClose size={16} />
        </button>
      </div>
      <div className="gm-styles">
        {STYLES.map((st) => (
          <button key={st.id} className={`gm-style-tile ${s.mapStyle === st.id ? 'on' : ''} ${st.id}`} onClick={() => s.set({ mapStyle: st.id })} aria-pressed={s.mapStyle === st.id}>
            <span className="gm-style-img" style={{ backgroundImage: `url(${st.thumb})` }} />
            <span>{st.label}</span>
          </button>
        ))}
      </div>
      <div className="gm-viewrow">
        <div className="gm-seg small" role="radiogroup" aria-label="View">
          <button role="radio" aria-checked={!s.view3d} className={!s.view3d ? 'on' : ''} onClick={() => s.set({ view3d: false })}>2D</button>
          <button role="radio" aria-checked={s.view3d} className={s.view3d ? 'on' : ''} onClick={() => s.set({ view3d: true })}>3D terrain</button>
          <span className="gm-seg-thumb" style={{ transform: `translateX(${s.view3d ? 100 : 0}%)` }} />
        </div>
        {s.view3d && (
          <div className="gm-seg small" role="radiogroup" aria-label="Relief exaggeration">
            <button role="radio" aria-checked={s.exaggeration === 1} className={s.exaggeration === 1 ? 'on' : ''} onClick={() => s.set({ exaggeration: 1 })}>True scale</button>
            <button role="radio" aria-checked={s.exaggeration === 2} className={s.exaggeration === 2 ? 'on' : ''} onClick={() => s.set({ exaggeration: 2 })}>Relief ×2</button>
            <span className="gm-seg-thumb" style={{ transform: `translateX(${s.exaggeration === 2 ? 100 : 0}%)` }} />
          </div>
        )}
      </div>
      {s.view3d && s.render3d !== 'fallback' && (
        <div className="gm-viewrow">
          <div className="gm-seg small three" role="radiogroup" aria-label="3D visual quality">
            {QUALITY_IDS.map((q) => (
              <button key={q} role="radio" aria-checked={s.quality3d === q} className={s.quality3d === q ? 'on' : ''} onClick={() => s.set({ quality3d: q })} title={QUALITY_NOTES[q]}>
                {QUALITY[q].label}
              </button>
            ))}
            <span className="gm-seg-thumb" style={{ transform: `translateX(${QUALITY_IDS.indexOf(s.quality3d) * 100}%)` }} />
          </div>
        </div>
      )}
      {s.view3d && (
        <p className="gm-fine">
          3D relief: CTX DEM (20 m) inside the crater region, MOLA (463 m) beyond. Exaggeration and quality are visual only and never affect route calculations.
          {s.render3d !== 'fallback' ? ` ${ENHANCED_3D_DISCLOSURE}` : ' Enhanced 3D needs WebGL 2 — standard terrain shown.'}
        </p>
      )}
      <div className="gm-layer-groups">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="gm-section-title">{g.title}</div>
            {g.items.map((it) => {
              const on = it.key ? s.layers[it.key] : false;
              return (
                <div key={it.label} className={`gm-layer-item ${it.unavailable ? 'unavailable' : ''}`}>
                  <label className="gm-switch-row">
                    <span className="gm-layer-text">
                      <span className="gm-layer-label">{it.label}</span>
                      <span className="gm-layer-note">{it.note}</span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="gm-switch"
                      checked={on}
                      disabled={it.unavailable}
                      onChange={() => it.key && s.toggleLayer(it.key)}
                      aria-label={it.label}
                    />
                  </label>
                  {on && it.legend && <Legend kind={it.legend} />}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
