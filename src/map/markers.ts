/** DOM factories for map markers — minimalist, Google-Maps-inspired, copper identity. */

export function originMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-marker gm-origin';
  el.innerHTML = '<span class="gm-origin-ring"></span><span class="gm-origin-dot"></span>';
  el.setAttribute('aria-label', 'Route origin');
  return el;
}

export function destinationMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-marker gm-dest';
  el.innerHTML = `<span class="gm-dest-shadow"></span><svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
    <defs><linearGradient id="gmPin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa262"/><stop offset="1" stop-color="#e2581f"/></linearGradient></defs>
    <path d="M15 38.5C15 38.5 2.5 24.6 2.5 14.6A12.5 12.5 0 0 1 27.5 14.6C27.5 24.6 15 38.5 15 38.5Z" fill="url(#gmPin)" stroke="#fff6ee" stroke-width="1.8"/>
    <circle cx="15" cy="14.6" r="4.6" fill="#fff8f1"/></svg>`;
  el.setAttribute('aria-label', 'Route destination');
  return el;
}

/**
 * Navigation puck, map-aligned. Rover: minimal copper chevron with a white rim and ground halo.
 * Walking: compact copper-cored disc with a soft heading beam — a lighter, pedestrian-scale mark.
 */
export function navArrowEl(mode: 'rover' | 'walking' = 'rover') {
  const el = document.createElement('div');
  if (mode === 'walking') {
    el.className = 'gm-nav-arrow walking';
    el.setAttribute('aria-label', 'Astronaut on foot');
    el.innerHTML = `<div class="gm-nav-halo"></div><svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <radialGradient id="gmWalkBeam" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#ffd2ad" stop-opacity=".85"/><stop offset=".6" stop-color="#ffb47e" stop-opacity=".35"/><stop offset="1" stop-color="#ffb47e" stop-opacity="0"/></radialGradient>
      <linearGradient id="gmWalkCore" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb47e"/><stop offset="1" stop-color="#f06a24"/></linearGradient>
    </defs>
    <path d="M24 24 L8 1 A28 28 0 0 1 40 1 Z" fill="url(#gmWalkBeam)"/>
    <circle cx="24" cy="24" r="10.5" fill="#fff8f1"/>
    <circle cx="24" cy="24" r="7.6" fill="url(#gmWalkCore)"/></svg>`;
    return el;
  }
  el.className = 'gm-nav-arrow';
  el.setAttribute('aria-label', 'Rover');
  el.innerHTML = `<div class="gm-nav-halo"></div><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
    <defs>
      <linearGradient id="gmArrow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb47e"/><stop offset="1" stop-color="#f06a24"/></linearGradient>
    </defs>
    <path d="M22 5 L36 37 L22 29.5 L8 37 Z" fill="url(#gmArrow)" stroke="#fff8f1" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M22 9.5 L22 28" stroke="#fff3e6" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  return el;
}

export function inspectMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-inspect-pin';
  el.innerHTML = '<span></span>';
  return el;
}

export function arrivalPulseEl() {
  const el = document.createElement('div');
  el.className = 'gm-arrival-pulse';
  el.innerHTML = '<span></span><span></span><span></span>';
  return el;
}

const ICON_SAMPLE =
  '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><rect x="5.3" y="1.2" width="5.4" height="13.6" rx="2.7" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="6.9" y="8" width="2.2" height="5" rx="1.1" fill="currentColor"/></svg>';
const ICON_LANDMARK = '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><path d="M8 1.2 14.8 8 8 14.8 1.2 8Z" fill="currentColor"/></svg>';

/** POI marker: fixed-size icon (stable anchor); the label is positioned by the collision layout. */
export function poiMarkerEl(name: string, category: 'sample' | 'landmark') {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `gm-poi gm-poi-${category}`;
  el.setAttribute('aria-label', name);
  el.innerHTML = `<span class="gm-poi-icon">${category === 'sample' ? ICON_SAMPLE : ICON_LANDMARK}</span><span class="gm-poi-badge"></span><span class="gm-poi-label"></span>`;
  (el.querySelector('.gm-poi-label') as HTMLElement).textContent = name;
  return el;
}
