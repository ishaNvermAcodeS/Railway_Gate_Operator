import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Persisted split fraction (0–1) for a resizable layout. */
export function useSplit(key: string, initial: number, min = 0.2, max = 0.8) {
  const [fraction, setFraction] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`raillogic.split.${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`raillogic.split.${key}`, String(fraction));
    } catch {
      /* storage unavailable */
    }
  }, [key, fraction]);
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  return { fraction, setFraction: (v: number) => setFraction(clamp(v)) };
}

interface Props {
  direction: 'vertical' | 'horizontal';
  /** Element whose box the fraction is measured against. */
  containerRef: React.RefObject<HTMLElement | null>;
  onChange(fraction: number): void;
  label: string;
}

/** A draggable divider. `vertical` splits left/right, `horizontal` splits top/bottom. */
export function Splitter({ direction, containerRef, onChange, label }: Props) {
  const dragging = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(direction === 'vertical' ? 'resizing-x' : 'resizing-y');
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    onChange(direction === 'vertical' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing-x', 'resizing-y');
  };

  return (
    <div
      className={`splitter splitter--${direction}`}
      role="separator"
      aria-orientation={direction}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
