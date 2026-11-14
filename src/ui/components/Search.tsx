import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { formatCoord, parseCoordinate, type LngLat } from '../../geo/mars';
import { flyTo } from '../../state/actions';
import { IconClose, IconSearch, IconTarget } from '../icons/Icons';

interface Result {
  key: string;
  title: string;
  subtitle: string;
  lngLat: LngLat;
  poiId?: string;
}

export function SearchBox() {
  const pois = useStore((s) => s.pois);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<Result[]>(() => {
    const query = q.trim();
    if (!query) return [];
    const out: Result[] = [];
    const coord = parseCoordinate(query);
    if (coord) out.push({ key: 'coord', title: formatCoord(coord), subtitle: 'Go to Martian coordinate (planetocentric, °E)', lngLat: coord });
    const lc = query.toLowerCase();
    for (const p of pois) {
      const hay = `${p.name} ${(p.samples ?? []).map((s) => s.name).join(' ')}`.toLowerCase();
      if (hay.includes(lc)) {
        const sample = p.samples?.find((s) => s.name.toLowerCase().includes(lc));
        out.push({
          key: p.id,
          title: p.name,
          subtitle: sample ? `Sample #${sample.no} “${sample.name}” · sol ${sample.sol}` : p.category === 'sample' ? 'Sample site' : 'Landmark',
          lngLat: [p.lon, p.lat],
          poiId: p.id,
        });
      }
    }
    return out.slice(0, 8);
  }, [q, pois]);

  const choose = (r: Result) => {
    const s = useStore.getState();
    const poi = r.poiId ? s.pois.find((p) => p.id === r.poiId) ?? null : null;
    flyTo(r.lngLat, poi?.category === 'landmark' && poi.id === 'jezero-center' ? 10.8 : 13.6);
    if (s.appMode === 'planning') {
      if (s.tool === 'route') s.setPoint(r.lngLat, poi?.name ?? null);
      else if (poi) useStore.setState({ selectedPoi: poi, inspect: null });
    }
    setOpen(false);
    setQ(poi ? poi.name : r.title);
    inputRef.current?.blur();
  };

  return (
    <div className="gm-search" role="search">
      <IconSearch className="gm-search-icon" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active]);
          else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Search sites, samples or 18.44N 77.45E"
        aria-label="Search places, scientific sites or Martian coordinates"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
      />
      {q && (
        <button className="gm-icon-btn gm-search-clear" onClick={() => setQ('')} aria-label="Clear search">
          <IconClose size={16} />
        </button>
      )}
      {open && q.trim() && (
        <ul className="gm-search-results glass" role="listbox">
          {results.length === 0 && <li className="gm-search-empty">No known place or valid coordinate. Try “Cheyava Falls” or “18.45, 77.40”.</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <IconTarget size={16} />
              <div>
                <div className="gm-sr-title">{r.title}</div>
                <div className="gm-sr-sub">{r.subtitle}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
