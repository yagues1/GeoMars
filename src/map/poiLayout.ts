/**
 * Screen-space annotation layout for scientific sites (DOM markers keep Geist typography and
 * accessibility; MapLibre symbol collision would need remote glyphs).
 *
 * Each frame (rAF-throttled on map movement):
 *   1. Markers are placed greedily by priority; a marker closer than CLUSTER_PX to an already placed
 *      one is folded into it (count badge), so dense sample clusters read as one site until zoomed.
 *   2. Labels are placed by priority, only from their tier's minimum zoom, trying right → left →
 *      below → above; a candidate is rejected if it overlaps a placed label, a visible marker or the
 *      viewport edge. Unplaced labels fade out.
 */
import type { Map as MlMap } from 'maplibre-gl';
import type { Poi } from '../data/loaders';

const CLUSTER_PX = 22;
const ICON_R = 11;
const LABEL_MAX_W = 136;
const LINE_H = 15;
const PAD = 3;

/** Priority (higher first) and label tier min-zoom. */
const TIER1 = new Set(['jezero-center', 'western-fan', 'landing', 'neretva-vallis', 'sava-vallis']);
const TIER2 = new Set(['sample-cheyava-falls', 'three-forks-depot', 'sample-wildcat-ridge', 'sample-bunsen-peak', 'sample-rochette', 'sample-shallow-bay', 'sample-berea']);

function rank(p: Poi) {
  if (TIER1.has(p.id)) return { prio: 300, minZoom: 9.6 };
  if (TIER2.has(p.id)) return { prio: 200 + (p.samples?.length ?? 0), minZoom: 11.6 };
  return { prio: 100 + (p.samples?.length ?? 0), minZoom: 13 };
}

interface Entry {
  poi: Poi;
  el: HTMLElement;
  label: HTMLElement;
  badge: HTMLElement;
  prio: number;
  minZoom: number;
  w: number;
  h: number;
}

type Box = [number, number, number, number]; // x0 y0 x1 y1
const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(s: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * 6.6;
  measureCtx.font = '600 12px "Geist Variable", system-ui, sans-serif';
  return measureCtx.measureText(s).width;
}

export class PoiLayout {
  private entries: Entry[] = [];
  private raf = 0;
  private enabled = true;
  private selected: string | null = null;

  constructor(private map: MlMap) {
    map.on('move', this.schedule);
    map.on('resize', this.schedule);
    // panels open/close/collapse without moving the map
    this.ro = new ResizeObserver(this.schedule);
    this.mo = new MutationObserver(() => this.observePanels());
    this.mo.observe(document.body, { childList: true, subtree: true });
    this.observePanels();
  }

  private ro: ResizeObserver;
  private mo: MutationObserver;
  private observed = new Set<Element>();
  private observePanels() {
    document.querySelectorAll('[data-map-obstacle]').forEach((el) => {
      if (this.observed.has(el)) return;
      this.observed.add(el);
      this.ro.observe(el);
    });
    this.schedule();
  }

  dispose() {
    this.ro.disconnect();
    this.mo.disconnect();
    this.map.off('move', this.schedule);
    this.map.off('resize', this.schedule);
    cancelAnimationFrame(this.raf);
  }

  setEntries(list: { poi: Poi; el: HTMLElement }[]) {
    this.entries = list
      .map(({ poi, el }) => {
        const { prio, minZoom } = rank(poi);
        const tw = textWidth(poi.name);
        const w = Math.min(LABEL_MAX_W, Math.ceil(tw) + 2);
        const lines = tw > LABEL_MAX_W ? 2 : 1;
        return {
          poi,
          el,
          label: el.querySelector('.gm-poi-label') as HTMLElement,
          badge: el.querySelector('.gm-poi-badge') as HTMLElement,
          prio,
          minZoom,
          w,
          h: lines * LINE_H,
        };
      })
      .sort((a, b) => b.prio - a.prio || a.poi.id.localeCompare(b.poi.id));
    this.schedule();
  }

  /** The selected site is laid out first so its marker and label always win. */
  setSelected(id: string | null) {
    this.selected = id;
    this.schedule();
  }

  /** Labels hidden entirely (e.g. navigation mode); markers keep clustering. */
  setLabelsEnabled(v: boolean) {
    this.enabled = v;
    this.schedule();
  }

  schedule = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.layout();
    });
  };

  private layout() {
    const map = this.map;
    const z = map.getZoom();
    const { width: W, height: H } = map.getCanvas().getBoundingClientRect();
    const placed: { e: Entry; x: number; y: number; count: number }[] = [];
    // 1. markers + clustering
    const order = this.selected ? [...this.entries].sort((a, b) => Number(b.poi.id === this.selected) - Number(a.poi.id === this.selected)) : this.entries;
    for (const e of order) {
      const p = map.project([e.poi.lon, e.poi.lat]);
      const host = placed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < CLUSTER_PX);
      if (host) {
        host.count++;
        e.el.classList.add('folded');
        e.el.classList.remove('lbl-on');
        continue;
      }
      e.el.classList.remove('folded');
      placed.push({ e, x: p.x, y: p.y, count: 0 });
    }
    // 2. labels
    // floating panels are obstacles: no label is placed underneath them
    const obstacles: Box[] = [];
    const cr = map.getContainer().getBoundingClientRect();
    document.querySelectorAll<HTMLElement>('[data-map-obstacle]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) obstacles.push([r.left - cr.left - 6, r.top - cr.top - 6, r.right - cr.left + 6, r.bottom - cr.top + 6]);
    });
    const boxes: Box[] = placed.map((q) => [q.x - ICON_R, q.y - ICON_R - (q.count ? 8 : 0), q.x + ICON_R + (q.count ? 12 : 0), q.y + ICON_R]);
    for (const q of placed) {
      const { e } = q;
      e.el.dataset.cluster = String(q.count);
      e.badge.textContent = q.count ? `+${q.count}` : '';
      e.el.classList.toggle('clustered', q.count > 0);
      const onScreen = q.x > -40 && q.y > -40 && q.x < W + 40 && q.y < H + 40;
      let side: string | null = null;
      if (this.enabled && onScreen && z >= e.minZoom) {
        const lw = e.w;
        const rx = q.x + ICON_R + (q.count ? 16 : 4);
        const cands: [string, Box][] = [
          ['right', [rx, q.y - e.h / 2, rx + lw, q.y + e.h / 2]],
          ['left', [q.x - ICON_R - 4 - lw, q.y - e.h / 2, q.x - ICON_R - 4, q.y + e.h / 2]],
          ['below', [q.x - lw / 2, q.y + ICON_R + 3, q.x + lw / 2, q.y + ICON_R + 3 + e.h]],
          ['above', [q.x - lw / 2, q.y - ICON_R - 3 - e.h, q.x + lw / 2, q.y - ICON_R - 3]],
        ];
        for (const [name, b] of cands) {
          const bp: Box = [b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD];
          if (bp[0] < 4 || bp[1] < 4 || bp[2] > W - 4 || bp[3] > H - 4) continue;
          if (boxes.some((o) => hit(o, bp)) || obstacles.some((o) => hit(o, bp))) continue;
          boxes.push(bp);
          side = name;
          break;
        }
      }
      // markers hidden beneath a panel step back too
      const under = obstacles.some((o) => q.x > o[0] && q.x < o[2] && q.y > o[1] && q.y < o[3]);
      e.el.classList.toggle('under-panel', under);
      e.el.classList.toggle('lbl-on', side !== null && !under);
      if (side) e.el.dataset.side = side;
    }
  }
}
