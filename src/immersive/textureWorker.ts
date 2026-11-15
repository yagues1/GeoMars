/// <reference lib="webworker" />
/** Texture compositing worker: albedo and scientific-overlay bitmaps for terrain chunks. */
import type { LayerState, MapStyleId } from '../state/store';
import { composeAlbedo, composeOverlay } from './textures';

export type TexRequest =
  | { id: number; kind: 'albedo'; z: number; x: number; y: number; size: number; style: MapStyleId }
  | { id: number; kind: 'overlay'; z: number; x: number; y: number; size: number; style: MapStyleId; layers: LayerState };
export interface TexResult {
  id: number;
  bitmap: ImageBitmap | null;
}

// serialise per worker: the compositing canvas is shared
let chain: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent<TexRequest>) => {
  const m = e.data;
  chain = chain.then(async () => {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = m.kind === 'albedo' ? await composeAlbedo(m.z, m.x, m.y, m.size, m.style) : await composeOverlay(m.z, m.x, m.y, m.size, m.layers, m.style);
    } catch {
      bitmap = null;
    }
    (self as unknown as Worker).postMessage({ id: m.id, bitmap } satisfies TexResult, bitmap ? [bitmap] : []);
  });
};
