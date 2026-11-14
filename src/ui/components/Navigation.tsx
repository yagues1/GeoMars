import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { positionAtTime, TIME_WARP } from '../../navigation/simulator';
import { angleDelta, bearing, formatCoord, formatDistance, formatDuration } from '../../geo/mars';
import { backToPlanning, continueFromDestination, restartNavigation } from '../../state/actions';
import { DEFAULT_VEHICLE } from '../../routing/vehicle';
import { IconClose, IconPause, IconPlay, IconRestart, IconRoute, IconTurnLeft, IconTurnRight, IconWarning, IconFlag, IconSample } from '../icons/Icons';
import type { RouteSuccess } from '../../routing/astar';
import { marsDistance } from '../../geo/mars';

interface Instruction {
  kind: 'left' | 'right' | 'slope' | 'arrive';
  text: string;
  inM: number;
}

/** Contextual instruction, only when relevant (turn within 250 m, steep stretch within 400 m, arrival). */
function nextInstruction(route: RouteSuccess, distanceM: number, destLabel: string | null): Instruction | null {
  const remaining = route.distanceM - distanceM;
  if (remaining < 250) return { kind: 'arrive', text: `Arriving at ${destLabel ?? 'destination'}`, inM: remaining };
  const { cumDist, coordinates, segSlope } = route;
  let k = 0;
  while (k < cumDist.length - 1 && cumDist[k + 1] <= distanceM) k++;
  for (let j = k; j < coordinates.length - 2 && cumDist[j] - distanceM < 400; j++) {
    if (segSlope[j] > DEFAULT_VEHICLE.cautionSlopeDeg && cumDist[j] > distanceM) {
      return { kind: 'slope', text: `Steep section ahead · ${segSlope[j].toFixed(0)}°`, inM: cumDist[j] - distanceM };
    }
  }
  for (let j = Math.max(1, k + 1); j < coordinates.length - 1 && cumDist[j] - distanceM < 250; j++) {
    // compare headings over ~80 m either side of vertex j
    let a = j;
    while (a > 0 && cumDist[j] - cumDist[a] < 80) a--;
    let b = j;
    while (b < coordinates.length - 1 && cumDist[b] - cumDist[j] < 80) b++;
    const d = angleDelta(bearing(coordinates[a], coordinates[j]), bearing(coordinates[j], coordinates[b]));
    if (Math.abs(d) > 38 && cumDist[j] > distanceM + 15) {
      return { kind: d < 0 ? 'left' : 'right', text: `${Math.abs(d) > 100 ? 'Sharp ' : ''}${d < 0 ? 'left' : 'right'}`, inM: cumDist[j] - distanceM };
    }
  }
  return null;
}

export function NavHUD() {
  const route = useStore((s) => s.route);
  const t = useStore((s) => s.navSimTime);
  const status = useStore((s) => s.navStatus);
  const destLabel = useStore((s) => s.destinationLabel);
  const set = useStore((s) => s.set);
  const pos = useMemo(() => (route ? positionAtTime(route, t) : null), [route, t]);
  if (!route || !pos) return null;
  const progress = route.distanceM > 0 ? pos.distanceM / route.distanceM : 0;
  const instr = status === 'running' || status === 'paused' ? nextInstruction(route, pos.distanceM, destLabel) : null;

  return (
    <div className="gm-nav">
      {instr && (
        <div key={instr.kind + instr.text} className={`gm-instr glass gm-pop-in ${instr.kind}`} role="status" aria-live="polite">
          <span className="gm-instr-icon">
            {instr.kind === 'left' ? <IconTurnLeft size={26} /> : instr.kind === 'right' ? <IconTurnRight size={26} /> : instr.kind === 'slope' ? <IconWarning size={24} /> : <IconFlag size={24} />}
          </span>
          <div>
            <div className="gm-instr-dist">{formatDistance(instr.inM)}</div>
            <div className="gm-instr-text">{instr.text}</div>
          </div>
        </div>
      )}
      <div className="gm-nav-card glass">
        <div className="gm-nav-top">
          <div>
            <div className="gm-big">{status === 'arrived' ? 'Arrived' : formatDuration(pos.remainingS)}</div>
            <div className="gm-sub">
              {formatDistance(pos.remainingM)} remaining · simulation ×{TIME_WARP}
            </div>
          </div>
          <button className="gm-icon-btn lg" onClick={backToPlanning} aria-label="Exit navigation and return to planning" title="Return to planning">
            <IconClose size={20} />
          </button>
        </div>
        <div className="gm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Route progress">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="gm-nav-controls">
          {status === 'idle' && (
            <button className="gm-btn primary" onClick={() => set({ navStatus: 'running' })}>
              <IconPlay size={16} /> Start
            </button>
          )}
          {status === 'running' && (
            <button className="gm-btn" onClick={() => set({ navStatus: 'paused' })}>
              <IconPause size={16} /> Pause
            </button>
          )}
          {status === 'paused' && (
            <button className="gm-btn primary" onClick={() => set({ navStatus: 'running' })}>
              <IconPlay size={16} /> Resume
            </button>
          )}
          <button className="gm-btn ghost" onClick={restartNavigation} disabled={status === 'idle' && t === 0}>
            <IconRestart size={16} /> Restart
          </button>
          <button className="gm-btn ghost" onClick={backToPlanning}>
            <IconRoute size={16} /> Planning
          </button>
        </div>
        <p className="gm-fine center">Estimated visualisation — not live rover telemetry.</p>
      </div>
    </div>
  );
}

export function ArrivalCard() {
  const open = useStore((s) => s.arrivalOpen);
  const route = useStore((s) => s.route);
  const pois = useStore((s) => s.pois);
  const label = useStore((s) => s.destinationLabel);
  if (!open || !route) return null;
  const end = route.coordinates[route.coordinates.length - 1];
  let poi = pois.find((p) => p.name === label) ?? null;
  if (!poi) {
    let best = Infinity;
    for (const p of pois) {
      const d = marsDistance(end, [p.lon, p.lat]);
      if (d < 300 && d < best) {
        best = d;
        poi = p;
      }
    }
  }
  return (
    <div className="gm-arrival glass gm-arrival-in" role="dialog" aria-label="Arrived at destination">
      <div className="gm-arrival-kicker">Destination reached · {formatDistance(route.distanceM)} in {formatDuration(route.timeS)} (est.)</div>
      <h2>{poi?.name ?? label ?? 'Surface destination'}</h2>
      <div className="gm-sub">{formatCoord(poi ? [poi.lon, poi.lat] : end, 4)}</div>
      <p className="gm-desc">
        {poi
          ? poi.description
          : 'No catalogued scientific site at this point. Switch to Explore and click the map to inspect elevation, slope, geology and thermal data here.'}
      </p>
      {poi?.category === 'sample' && (
        <div className="gm-chip-row">
          <span className="gm-chip copper">
            <IconSample size={13} /> Potential sampling interest
          </span>
        </div>
      )}
      <div className="gm-row gap wrap">
        <button className="gm-btn primary" onClick={continueFromDestination}>
          <IconRoute size={16} /> Plan next route from here
        </button>
        <button
          className="gm-btn ghost"
          onClick={() => {
            useStore.setState({ arrivalOpen: false, appMode: 'planning', tool: 'explore', selectedPoi: poi, navStatus: 'arrived' });
          }}
        >
          Keep exploring
        </button>
        <button className="gm-btn ghost" onClick={restartNavigation}>
          <IconRestart size={16} /> Replay
        </button>
      </div>
    </div>
  );
}
