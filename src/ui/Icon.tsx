const PATHS: Record<string, string> = {
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z',
  stop: 'M4 4h8v8H4z',
  step: 'M3.5 3.5v9l6-4.5zM11 3h2v10h-2z',
  stepBack: 'M12.5 3.5v9l-6-4.5zM3 3h2v10H3z',
  reset: 'M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.5.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z',
  build: 'M2.5 4.5l3 3.5-3 3.5M7.5 12h6',
  warn: 'M8 1.8l6.5 12H1.5zM7.3 6h1.4v4H7.3zM7.3 11h1.4v1.4H7.3z',
  error: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM5.6 4.6L8 7l2.4-2.4 1 1L9 8l2.4 2.4-1 1L8 9l-2.4 2.4-1-1L7 8 4.6 5.6z',
  check: 'M2.5 8.5l3.5 3.5 7.5-8',
  bp: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3',
  moon: 'M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z',
};

const STROKED = new Set(['build', 'check', 'arrow', 'sun']);

export function Icon({ name, size = 14 }: { name: keyof typeof PATHS | string; size?: number }) {
  const d = PATHS[name];
  const stroked = STROKED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="icon">
      <path d={d} fill={stroked ? 'none' : 'currentColor'} stroke={stroked ? 'currentColor' : 'none'} strokeWidth={stroked ? 1.6 : 0} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
