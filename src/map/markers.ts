/** DOM factories for map markers (simple, rounded, Google-Maps-inspired). */

export function originMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-marker gm-origin';
  el.innerHTML = '<span class="gm-origin-dot"></span>';
  el.setAttribute('aria-label', 'Route origin');
  return el;
}

export function destinationMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-marker gm-dest';
  el.innerHTML = `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
    <defs><linearGradient id="gmPin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a52"/><stop offset="1" stop-color="#d9531c"/></linearGradient></defs>
    <path d="M17 43C17 43 3 26.5 3 16.5A14 14 0 0 1 31 16.5C31 26.5 17 43 17 43Z" fill="url(#gmPin)" stroke="#fff3e8" stroke-width="2"/>
    <circle cx="17" cy="16.5" r="5.2" fill="#fff6ee"/></svg>`;
  el.setAttribute('aria-label', 'Route destination');
  return el;
}

export function navArrowEl() {
  const el = document.createElement('div');
  el.className = 'gm-nav-arrow';
  el.innerHTML = `<div class="gm-nav-halo"></div><svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
    <defs><linearGradient id="gmArrow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd0a6"/><stop offset="1" stop-color="#ff7a2e"/></linearGradient></defs>
    <circle cx="27" cy="27" r="22" fill="#1a0e08" fill-opacity=".55" stroke="#fff2e6" stroke-width="2.5"/>
    <path d="M27 9 L40 39 L27 32 L14 39 Z" fill="url(#gmArrow)" stroke="#fff7ef" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return el;
}

export function inspectMarkerEl() {
  const el = document.createElement('div');
  el.className = 'gm-inspect-pin';
  return el;
}

export function arrivalPulseEl() {
  const el = document.createElement('div');
  el.className = 'gm-arrival-pulse';
  el.innerHTML = '<span></span><span></span><span></span>';
  return el;
}

export function poiMarkerEl(name: string, category: 'sample' | 'landmark') {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `gm-poi gm-poi-${category}`;
  el.setAttribute('aria-label', name);
  el.innerHTML =
    category === 'sample'
      ? `<span class="gm-poi-icon"><svg viewBox="0 0 16 16" width="12" height="12"><rect x="5.5" y="1.5" width="5" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6.8" y="8" width="2.4" height="5.2" rx="1.2" fill="currentColor"/></svg></span><span class="gm-poi-label">${name}</span>`
      : `<span class="gm-poi-icon"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor"/></svg></span><span class="gm-poi-label">${name}</span>`;
  return el;
}
