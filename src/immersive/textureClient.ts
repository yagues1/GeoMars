/** Main-thread client of the texture workers (round-robin pool). */
import type { LayerState, MapStyleId } from '../state/store';
import type { TexRequest, TexResult } from './textureWorker';

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class TextureClient {
  private workers: Worker[] = [];
  private next = 0;
  private id = 1;
  private jobs = new Map<number, (b: ImageBitmap | null) => void>();

  constructor(count = 2) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<TexResult>) => {
        const fn = this.jobs.get(e.data.id);
        this.jobs.delete(e.data.id);
        fn?.(e.data.bitmap);
      };
      this.workers.push(w);
    }
  }

  private send(req: NoId<TexRequest>, worker?: number): Promise<ImageBitmap | null> {
    const id = this.id++;
    return new Promise((resolve) => {
      this.jobs.set(id, resolve);
      const w = this.workers[worker ?? this.next++ % this.workers.length];
      w.postMessage({ ...req, id } as TexRequest);
    });
  }

  albedo(z: number, x: number, y: number, size: number, style: MapStyleId) {
    return this.send({ kind: 'albedo', z, x, y, size, style });
  }
  overlay(z: number, x: number, y: number, size: number, layers: LayerState, style: MapStyleId) {
    return this.send({ kind: 'overlay', z, x, y, size, layers, style });
  }

  dispose() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.jobs.forEach((fn) => fn(null));
    this.jobs.clear();
  }
}
