import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteResult } from '../src/routing/astar';
import type { MobilityProfile } from '../src/routing/vehicle';

/** Controllable fake routing worker: each request resolves only when the test says so. */
const calls: { profile: MobilityProfile; resolve: (r: RouteResult) => void }[] = [];
vi.mock('../src/routing/client', () => ({
  routing: () => ({
    ready: Promise.resolve(),
    route: (_from: [number, number], _to: [number, number], profile: MobilityProfile) =>
      new Promise<RouteResult>((resolve) => calls.push({ profile, resolve })),
  }),
}));

const { useStore } = await import('../src/state/store');
const { calculateRoute, setTravelMode } = await import('../src/state/actions');

const A: [number, number] = [77.45, 18.44];
const B: [number, number] = [77.5, 18.45];

function fakeRoute(mode: 'rover' | 'walking', timeS: number): RouteResult {
  return {
    ok: true, mode, nominalSpeedMs: mode === 'rover' ? 10 / 3.6 : 3 / 3.6,
    coordinates: [A, B], elevations: [0, 0], cumDist: [0, 1000], cumTime: [0, timeS], segSlope: [1],
    distanceM: 1000, timeS, energyKWh: mode === 'rover' ? 0.5 : null, maxSlopeDeg: 1, meanSlopeDeg: 1,
    ascentM: 0, descentM: 0, cautionFraction: 0, lowConfidenceFraction: 0, straightLineM: 1000,
    expanded: 10, computeMs: 1, snappedStartM: 0, snappedEndM: 0,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  useStore.getState().clearRoute();
  useStore.setState({ travelMode: 'rover', origin: A, destination: B, originLabel: 'A', destinationLabel: 'B' });
});

describe('travel mode state', () => {
  it('defaults to Rover and sends the selected mobility profile to the engine', async () => {
    const p = calculateRoute();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].profile.mode).toBe('rover');
    calls[0].resolve(fakeRoute('rover', 360));
    await p;
    expect(useStore.getState().route?.mode).toBe('rover');
    expect(useStore.getState().routeStatus).toBe('done');
  });

  it('switching mode keeps the endpoints, invalidates the old result and recalculates with the new profile', async () => {
    const p = calculateRoute();
    await flush();
    calls[0].resolve(fakeRoute('rover', 360));
    await p;

    setTravelMode('walking');
    const s = useStore.getState();
    expect(s.origin).toEqual(A);
    expect(s.destination).toEqual(B);
    expect(s.travelMode).toBe('walking');
    expect(s.route).toBeNull(); // the rover result is never shown as a walking result
    expect(s.routeStatus).toBe('computing');
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].profile.mode).toBe('walking');
    calls[1].resolve(fakeRoute('walking', 1200));
    await flush();
    expect(useStore.getState().route?.mode).toBe('walking');
    expect(useStore.getState().route?.timeS).toBe(1200);
  });

  it('a late Rover result never overwrites a newer Walking result (and vice versa)', async () => {
    void calculateRoute(); // rover request #1 in flight
    await flush();
    setTravelMode('walking'); // walking request #2
    await flush();
    expect(calls.map((c) => c.profile.mode)).toEqual(['rover', 'walking']);
    calls[1].resolve(fakeRoute('walking', 1200));
    await flush();
    calls[0].resolve(fakeRoute('rover', 360)); // stale, arrives last
    await flush();
    expect(useStore.getState().route?.mode).toBe('walking');
    expect(useStore.getState().route?.timeS).toBe(1200);

    setTravelMode('rover'); // request #3
    await flush();
    setTravelMode('walking'); // request #4
    await flush();
    calls[3].resolve(fakeRoute('walking', 1300));
    calls[2].resolve(fakeRoute('rover', 400));
    await flush();
    expect(useStore.getState().travelMode).toBe('walking');
    expect(useStore.getState().route?.mode).toBe('walking');
    expect(useStore.getState().route?.timeS).toBe(1300);
  });

  it('does not switch an active navigation mid-journey: returns to planning and requires a restart', async () => {
    const p = calculateRoute();
    await flush();
    calls[0].resolve(fakeRoute('rover', 360));
    await p;
    useStore.setState({ appMode: 'navigation', navStatus: 'running', navSimTime: 120 });

    setTravelMode('walking');
    const s = useStore.getState();
    expect(s.appMode).toBe('planning');
    expect(s.navStatus).toBe('idle');
    expect(s.navSimTime).toBe(0);
    expect(s.route).toBeNull();
  });

  it('selecting the same mode is a no-op, and no recalculation happens without a previous result', async () => {
    setTravelMode('rover');
    expect(calls).toHaveLength(0);
    setTravelMode('walking'); // no route computed yet → nothing to recalculate
    await flush();
    expect(calls).toHaveLength(0);
    expect(useStore.getState().travelMode).toBe('walking');
    expect(useStore.getState().routeStatus).toBe('idle');
  });

  it('ignores results when the endpoints changed meanwhile', async () => {
    void calculateRoute();
    await flush();
    useStore.getState().setPoint([77.6, 18.5]); // new origin → old request is stale
    calls[0].resolve(fakeRoute('rover', 360));
    await flush();
    expect(useStore.getState().route).toBeNull();
  });
});
