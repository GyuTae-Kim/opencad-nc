/**
 * 단추 그림(인라인 SVG, 20×20, currentColor 선). 이 앱에서 새로 그렸다.
 */

const svg = (body: string): string =>
  `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  open: svg('<path d="M2.5 5.5v9a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V7.5a1 1 0 0 0-1-1H9.5L8 4.5H3.5a1 1 0 0 0-1 1z"/>'),
  sample: svg('<path d="M7.5 2.5h5M8.5 2.5v5L4 15.2a1.2 1.2 0 0 0 1 1.8h10a1.2 1.2 0 0 0 1-1.8L11.5 7.5v-5"/><path d="M6 12.5h8"/>'),
  sun: svg('<circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>'),
  moon: svg('<path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8z"/>'),
  apps: svg('<rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/>'),
  code: svg('<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11.2 4.5l-2.4 11"/>'),
  fit: svg('<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/><rect x="7" y="7" width="6" height="6" rx="0.5"/>'),
  views: svg('<path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2z"/><path d="M3.5 6.2L10 10l6.5-3.8M10 10v7.5"/>'),
  perspective: svg('<path d="M3 5.5l14-2.5v14l-14-2.5z"/><path d="M3 10h14"/>'),
  ortho: svg('<rect x="3" y="4" width="14" height="12" rx="0.5"/><path d="M3 10h14"/>'),
  render: svg('<circle cx="10" cy="10" r="6.8"/><path d="M10 3.2a6.8 6.8 0 0 1 0 13.6z" fill="currentColor" stroke="none"/>'),
  grid: svg('<path d="M3 7h14M3 13h14M7 3v14M13 3v14"/><rect x="3" y="3" width="14" height="14" rx="1"/>'),
  cube: svg('<path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2z"/><path d="M3.5 6.2L10 10l6.5-3.8M10 10v7.5"/><path d="M6.7 4.4l6.6 3.8" stroke-dasharray="1.5 1.5"/>'),
  axes: svg('<path d="M4 16V4M4 16h12M4 16l7-7"/><path d="M2.5 5.5L4 4l1.5 1.5M14.5 14.5L16 16l-1.5 1.5"/>'),
  measure: svg('<path d="M2.8 13.5l10.7-10.7 3.7 3.7L6.5 17.2z"/><path d="M6 10.3l1.6 1.6M8.2 8.1l1 1M10.4 5.9l1.6 1.6"/>'),
  image: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="1.2"/><circle cx="7" cy="8" r="1.5"/><path d="M17.5 13.5l-4.5-4.5-7.5 7.5"/>'),
  panel: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="1.2"/><path d="M12 3.5v13M13.8 7h2M13.8 9.5h2M13.8 12h2"/>'),
  play: svg('<path d="M6 4l10 6-10 6z" fill="currentColor"/>'),
  pause: svg('<path d="M6.5 4v12M13.5 4v12" stroke-width="2.6"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  eye: svg('<path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/>'),
  eyeOff: svg('<path d="M3 3l14 14M8.2 4.8A8 8 0 0 1 10 4.5c5.2 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.3 3M5.4 6.2A14 14 0 0 0 1.8 10s3 5.5 8.2 5.5a7.7 7.7 0 0 0 3.6-.9"/>'),
  chevron: svg('<path d="M5.5 8l4.5 4.5L14.5 8"/>'),
  drop: svg('<path d="M10 2.5v10M6 8.5l4 4 4-4"/><path d="M3 13.5v2a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  lock: svg('<rect x="4" y="9" width="12" height="8.5" rx="1.2"/><path d="M6.8 9V6.5a3.2 3.2 0 0 1 6.4 0V9"/>'),
  first: svg('<path d="M5 4v12M15 4l-7 6 7 6z" fill="currentColor"/>'),
  all: svg('<path d="M3 15c3-8 5-9 7-5s4 3 7-5"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name];
}
