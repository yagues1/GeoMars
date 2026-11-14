import { DATA_BASE } from '../config/constants';
import type { RouteResult } from './astar';
import type { MobilityProfile } from './vehicle';

export interface TerrainSample {
  covered: boolean;
  elevation?: number;
  slope?: number;
  lowConfidence?: boolean;
}

type Pending = (v: unknown) => void;

class RoutingClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') resolveReady();
      else if (m.type === 'error') rejectReady(new Error(m.message));
      else {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          p(m.result);
        }
      }
    };
    const base = new URL(DATA_BASE, window.location.href).href;
    this.worker.postMessage({ type: 'init', base });
  }

  /** Route with an explicit mobility profile (the profile object is sent to the worker as-is). */
  route(from: [number, number], to: [number, number], profile: MobilityProfile): Promise<RouteResult> {
    const id = ++this.seq;
    return new Promise((res) => {
      this.pending.set(id, res as Pending);
      this.worker.postMessage({ type: 'route', id, from, to, profile });
    });
  }

  inspect(lngLat: [number, number]): Promise<TerrainSample> {
    const id = ++this.seq;
    return new Promise((res) => {
      this.pending.set(id, res as Pending);
      this.worker.postMessage({ type: 'inspect', id, lngLat });
    });
  }
}

let client: RoutingClient | null = null;
export function routing() {
  client ??= new RoutingClient();
  return client;
}
