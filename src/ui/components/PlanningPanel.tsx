import { useState } from 'react';
import { useStore } from '../../state/store';
import { calculateRoute, flyTo, startNavigation } from '../../state/actions';
import { formatCoord, formatDistance, formatDuration } from '../../geo/mars';
import { DEFAULT_VEHICLE } from '../../routing/vehicle';
import { GEO_UNITS } from '../../data/geology';
import { DATASETS } from '../../data/datasets';
import { IconChevron, IconClose, IconExplore, IconFlag, IconInfo, IconNav, IconRoute, IconSample, IconWarning } from '../icons/Icons';
import { StatusTag } from './StatusTag';

export function ToolSwitch() {
  const tool = useStore((s) => s.tool);
  const set = useStore((s) => s.set);
  return (
    <div className="gm-seg" role="tablist" aria-label="Planning tool">
      <button role="tab" aria-selected={tool === 'explore'} className={tool === 'explore' ? 'on' : ''} onClick={() => set({ tool: 'explore' })}>
        <IconExplore size={16} /> Explore
      </button>
      <button role="tab" aria-selected={tool === 'route'} className={tool === 'route' ? 'on' : ''} onClick={() => set({ tool: 'route', inspect: null, selectedPoi: null })}>
        <IconRoute size={16} /> Route
      </button>
      <span className="gm-seg-thumb" style={{ transform: `translateX(${tool === 'explore' ? 0 : 100}%)` }} />
    </div>
  );
}

export function PlanningPanel() {
  const tool = useStore((s) => s.tool);
  return (
    <div className="gm-panel-body">
      <ToolSwitch />
      <div key={tool} className="gm-fade-in">
        {tool === 'route' ? <RouteTool /> : <ExploreTool />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Route tool */
function RouteTool() {
  const s = useStore();
  const [details, setDetails] = useState(false);
  const step = !s.origin ? 1 : !s.destination ? 2 : 3;
  return (
    <div className="gm-route">
      <div className="gm-stops">
        <div className={`gm-stop ${step === 1 ? 'pending' : ''}`}>
          <span className="gm-stop-dot origin" />
          <div className="gm-stop-text">
            <div className="gm-stop-label">Origin</div>
            <div className="gm-stop-value">{s.origin ? s.originLabel ?? formatCoord(s.origin, 4) : 'Click the map to set the start'}</div>
          </div>
        </div>
        <div className="gm-stop-line" />
        <div className={`gm-stop ${step === 2 ? 'pending' : ''}`}>
          <span className="gm-stop-dot dest" />
          <div className="gm-stop-text">
            <div className="gm-stop-label">Destination</div>
            <div className="gm-stop-value">
              {s.destination ? s.destinationLabel ?? formatCoord(s.destination, 4) : s.origin ? 'Click the map to set the destination' : '—'}
            </div>
          </div>
        </div>
      </div>

      {s.origin && s.destination && s.routeStatus !== 'done' && (
        <button className="gm-btn primary block" onClick={() => void calculateRoute()} disabled={s.routeStatus === 'computing'}>
          {s.routeStatus === 'computing' ? (
            <>
              <span className="gm-spinner" /> Optimising route over terrain…
            </>
          ) : (
            <>
              <IconRoute size={18} /> Calculate route
            </>
          )}
        </button>
      )}

      {s.routeStatus === 'failed' && s.routeError && (
        <div className="gm-alert" role="alert">
          <IconWarning size={18} />
          <div>
            <strong>No defensible route</strong>
            <p>{s.routeError.message}</p>
          </div>
        </div>
      )}

      {s.route && s.routeStatus === 'done' && (
        <div className="gm-route-result gm-pop-in">
          <div className="gm-route-main">
            <div>
              <div className="gm-big">{formatDuration(s.route.timeS)}</div>
              <div className="gm-sub">{formatDistance(s.route.distanceM)} · estimated</div>
            </div>
            <button className="gm-btn primary round" onClick={startNavigation} aria-label="Start navigation">
              <IconNav size={20} />
              <span>Start</span>
            </button>
          </div>
          {(s.route.snappedStartM > 0 || s.route.snappedEndM > 0) && (
            <p className="gm-note">Endpoint moved {Math.round(Math.max(s.route.snappedStartM, s.route.snappedEndM))} m to the nearest safe, observed terrain.</p>
          )}
          {s.route.cautionFraction > 0.02 && (
            <p className="gm-note warn">
              <IconWarning size={14} /> {Math.round(s.route.cautionFraction * 100)}% of the route crosses 15–20° slopes.
            </p>
          )}
          <button className="gm-disclosure" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            <IconChevron size={14} style={{ transform: details ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} /> Route details
          </button>
          {details && <RouteDetails />}
        </div>
      )}

      <div className="gm-row gap">
        {(s.origin || s.destination) && (
          <button className="gm-btn ghost" onClick={s.clearRoute}>
            <IconClose size={16} /> Clear route
          </button>
        )}
      </div>
      {!s.origin && (
        <p className="gm-hint">
          Routes are computed on the 20 m CTX elevation model (Jezero and surroundings). Areas steeper than {DEFAULT_VEHICLE.maxSlopeDeg}° and areas without
          elevation data are excluded.
        </p>
      )}
    </div>
  );
}

function RouteDetails() {
  const r = useStore((s) => s.route)!;
  const v = DEFAULT_VEHICLE;
  return (
    <div className="gm-details">
      <dl className="gm-kv">
        <dt>Surface distance</dt><dd>{formatDistance(r.distanceM)} <StatusTag s="derived" /></dd>
        <dt>Straight line</dt><dd>{formatDistance(r.straightLineM)}</dd>
        <dt>Travel time</dt><dd>{formatDuration(r.timeS)} <StatusTag s="estimated" /></dd>
        <dt>Traction energy</dt><dd>{r.energyKWh.toFixed(1)} kWh <StatusTag s="estimated" /></dd>
        <dt>Ascent / descent</dt><dd>+{Math.round(r.ascentM)} m / −{Math.round(r.descentM)} m</dd>
        <dt>Max slope crossed</dt><dd>{r.maxSlopeDeg.toFixed(1)}° (limit {v.maxSlopeDeg}°)</dd>
        <dt>Mean slope</dt><dd>{r.meanSlopeDeg.toFixed(1)}°</dd>
        <dt>Near DEM gaps</dt><dd>{(r.lowConfidenceFraction * 100).toFixed(1)}% of route</dd>
        <dt>Search</dt><dd>A* · {r.expanded.toLocaleString('en')} cells · {Math.round(r.computeMs)} ms</dd>
      </dl>
      <p className="gm-fine">
        Vehicle model (estimated, not a real vehicle specification): {Math.round(v.nominalSpeedMs * 3.6)} km/h nominal, {v.massKg} kg, rolling resistance{' '}
        {v.rollingResistance}, drivetrain η {v.drivetrainEfficiency}, Mars g 3.71 m/s². Slopes from the 20 m CTX DEM; obstacles smaller than ~40–60 m are not
        resolved. Not a safety-certified traverse plan.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- Explore tool */
function ExploreTool() {
  const inspect = useStore((s) => s.inspect);
  const poi = useStore((s) => s.selectedPoi);
  if (poi) return <PoiCard />;
  if (inspect) return <InspectCard />;
  return (
    <div className="gm-explore-empty">
      <p className="gm-hint">Click anywhere on the map to inspect terrain, geology and thermal data. Click a site marker to read about it.</p>
      <FeaturedSites />
    </div>
  );
}

function FeaturedSites() {
  const pois = useStore((s) => s.pois);
  const featured = ['cheyava-falls', 'western-fan', 'landing', 'wildcat-ridge', 'bunsen-peak', 'three-forks-depot']
    .map((id) => pois.find((p) => p.id === id || p.id === `sample-${id}`))
    .filter(Boolean);
  return (
    <div className="gm-featured">
      <div className="gm-section-title">Scientific destinations</div>
      {featured.map((p) => (
        <button
          key={p!.id}
          className="gm-list-item"
          onClick={() => {
            useStore.setState({ selectedPoi: p!, inspect: null });
            flyTo([p!.lon, p!.lat], 13.6);
          }}
        >
          <span className={`gm-li-icon ${p!.category}`}>{p!.category === 'sample' ? <IconSample size={15} /> : <IconFlag size={15} />}</span>
          <span className="gm-li-text">
            <span className="gm-li-title">{p!.name}</span>
            <span className="gm-li-sub">{p!.category === 'sample' ? (p!.samples?.length ? `Sample site · ${p!.samples[0].rock}` : 'Sample depot') : 'Landmark'}</span>
          </span>
          <IconChevron size={14} />
        </button>
      ))}
    </div>
  );
}

export function PoiCard() {
  const poi = useStore((s) => s.selectedPoi)!;
  const [more, setMore] = useState(false);
  return (
    <div className="gm-card gm-pop-in">
      <div className="gm-card-head">
        <span className={`gm-li-icon ${poi.category}`}>{poi.category === 'sample' ? <IconSample size={15} /> : <IconFlag size={15} />}</span>
        <div>
          <h3>{poi.name}</h3>
          <div className="gm-sub">{formatCoord([poi.lon, poi.lat], 4)}</div>
        </div>
        <button className="gm-icon-btn" onClick={() => useStore.setState({ selectedPoi: null })} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <p className="gm-desc">{poi.description}</p>
      {poi.category === 'sample' && <div className="gm-chip-row"><span className="gm-chip copper">Sampling interest</span></div>}
      <div className="gm-row gap">
        <button
          className="gm-btn primary"
          onClick={() => {
            const s = useStore.getState();
            useStore.setState({ tool: 'route', selectedPoi: null });
            if (s.origin && !s.destination) s.setPoint([poi.lon, poi.lat], poi.name);
            else {
              useStore.setState({ destination: null, destinationLabel: null, route: null, routeStatus: 'idle', routeError: null });
              useStore.getState().setPoint([poi.lon, poi.lat], poi.name);
            }
          }}
        >
          <IconRoute size={16} /> Route from/to here
        </button>
      </div>
      <button className="gm-disclosure" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <IconChevron size={14} style={{ transform: more ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} /> Source & location method
      </button>
      {more && (
        <div className="gm-details">
          {poi.samples && (
            <ul className="gm-samples">
              {poi.samples.map((x) => (
                <li key={x.no}>
                  #{x.no} <strong>{x.name}</strong> — {x.type}, sealed sol {x.sol} ({x.date}), {x.rock}
                </li>
              ))}
            </ul>
          )}
          <p className="gm-fine">
            <StatusTag s={poi.status} /> {poi.location_method}
          </p>
          <ul className="gm-sources">
            {poi.sources.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, '')}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InspectCard() {
  const i = useStore((s) => s.inspect)!;
  const t = i.terrain;
  const unit = i.geologyUnit ? GEO_UNITS[i.geologyUnit] : null;
  const [more, setMore] = useState(false);
  return (
    <div className="gm-card gm-pop-in">
      <div className="gm-card-head">
        <span className="gm-li-icon landmark"><IconInfo size={15} /></span>
        <div>
          <h3>Surface point</h3>
          <div className="gm-sub">{formatCoord(i.lngLat, 4)}</div>
        </div>
        <button className="gm-icon-btn" onClick={() => useStore.setState({ inspect: null })} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <dl className="gm-kv">
        <dt>Elevation</dt>
        <dd>{t?.covered && t.elevation !== undefined ? <>{Math.round(t.elevation).toLocaleString('en')} m <StatusTag s="observed" /></> : <Unavailable />}</dd>
        <dt>Slope</dt>
        <dd>
          {t?.covered && t.slope !== undefined ? (
            <>
              {t.slope.toFixed(1)}° <StatusTag s="derived" />
              {t.slope >= DEFAULT_VEHICLE.maxSlopeDeg ? <span className="gm-chip red">no-go</span> : t.slope >= DEFAULT_VEHICLE.cautionSlopeDeg ? <span className="gm-chip amber">caution</span> : null}
            </>
          ) : (
            <Unavailable />
          )}
        </dd>
        <dt>Geologic unit</dt>
        <dd>{unit ? <><span className="gm-swatch" style={{ background: unit.color }} />{unit.name} ({i.geologyUnit})</> : <Unavailable text="Outside geologic map" />}</dd>
        <dt>THEMIS night IR</dt>
        <dd>{i.themisNight !== null ? <>DN {i.themisNight} <span className="gm-dim">relative</span></> : <Unavailable />}</dd>
      </dl>
      {unit && <p className="gm-desc small">{unit.summary}</p>}
      {i.nearestPoi && (
        <button className="gm-list-item compact" onClick={() => useStore.setState({ selectedPoi: i.nearestPoi!.poi, inspect: null })}>
          <span className={`gm-li-icon ${i.nearestPoi.poi.category}`}>{i.nearestPoi.poi.category === 'sample' ? <IconSample size={14} /> : <IconFlag size={14} />}</span>
          <span className="gm-li-text">
            <span className="gm-li-title">{i.nearestPoi.poi.name}</span>
            <span className="gm-li-sub">Nearest site · {formatDistance(i.nearestPoi.distanceM)}</span>
          </span>
          <IconChevron size={14} />
        </button>
      )}
      <button className="gm-disclosure" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <IconChevron size={14} style={{ transform: more ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} /> Data details
      </button>
      {more && (
        <div className="gm-details">
          <p className="gm-fine">
            Elevation: {DATASETS[1].product} (CTX stereo, {DATASETS[1].resolution}), sampled from the 40 m routing grid, relative to the MOLA areoid.
            {t?.lowConfidence ? ' This point is next to a gap in the elevation model (lower confidence).' : ''}
          </p>
          <p className="gm-fine">Slope: steepest 20 m slope within the 40 m cell (derived).</p>
          <p className="gm-fine">Geology: USGS SIM 3464 (Sun & Stack 2020), 1:75,000, positional offsets of ~100–200 m possible.</p>
          <p className="gm-fine">THEMIS: 8-bit stretched brightness (USGS controlled mosaic, 100 m). Not a calibrated temperature.</p>
          <p className="gm-fine">Historical weather (MEDA): not integrated in V1.0 — rover measurements are local to the rover and are not extrapolated.</p>
        </div>
      )}
    </div>
  );
}

function Unavailable({ text = 'No data here' }: { text?: string }) {
  return <span className="gm-unavail">{text}</span>;
}
