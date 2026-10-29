/* Draggable bottom sheet with snap points (peek / half / full) for the Live overlay. */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '@/i18n/core';
import { haptic } from '@/telegram/sdk';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

interface DragState {
  y0: number;
  h0: number;
  lastY: number;
  lastT: number;
  v: number;
  dragging: boolean;
  id: number;
}

export function DragSheet({
  snap,
  heights,
  onSnap,
  onHeight,
  header,
  children,
  reduced,
}: {
  snap: Snap;
  heights: Record<Snap, number>;
  onSnap: (s: Snap) => void;
  /** Live height in px (during drag and after snapping) — used to stack overlays above the sheet. */
  onHeight?: (px: number) => void;
  header: ReactNode;
  children: ReactNode;
  reduced?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<DragState | null>(null);
  const swallowClick = useRef(false);
  const target = heights[snap];

  useLayoutEffect(() => {
    if (!el.current || st.current?.dragging) return;
    el.current.style.height = `${target}px`;
    onHeight?.(target);
  }, [target, onHeight]);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    node.dataset.snap = snap;
  }, [snap]);

  const setH = (h: number) => {
    if (!el.current) return;
    el.current.style.height = `${h}px`;
    onHeight?.(h);
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    st.current = { y0: e.clientY, h0: el.current?.getBoundingClientRect().height ?? target, lastY: e.clientY, lastT: performance.now(), v: 0, dragging: false, id: e.pointerId };
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    const dy = e.clientY - s.y0;
    if (!s.dragging) {
      if (Math.abs(dy) < 7) return;
      s.dragging = true;
      el.current?.classList.add('dsheet--drag');
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const now = performance.now();
    const dt = Math.max(1, now - s.lastT);
    s.v = 0.7 * s.v + 0.3 * ((s.lastY - e.clientY) / dt);
    s.lastY = e.clientY;
    s.lastT = now;
    const min = heights.peek * 0.72;
    const max = heights.full;
    let h = s.h0 - dy;
    if (h > max) h = max + (h - max) * 0.2;
    if (h < min) h = min - (min - h) * 0.3;
    setH(h);
  };
  const up = (e: React.PointerEvent) => {
    const s = st.current;
    st.current = null;
    if (!s || !s.dragging) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    el.current?.classList.remove('dsheet--drag');
    const h = el.current?.getBoundingClientRect().height ?? target;
    const projected = h + s.v * 160;
    let best: Snap = snap;
    let bestD = Infinity;
    for (const k of ORDER) {
      const d = Math.abs(heights[k] - projected);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (best !== snap) haptic.impact('light');
    // Re-apply the target even when the snap is unchanged (drag released mid-way).
    setH(heights[best]);
    onSnap(best);
  };

  const cycle = () => {
    haptic.tap();
    onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
  };

  return (
    <div ref={el} className={`dsheet dsheet--${snap} ${reduced ? 'dsheet--still' : ''}`} style={{ height: target }}>
      <div
        className="dsheet__head"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <button type="button" className="dsheet__grab" aria-label={snap === 'full' ? t('ui.collapse') : t('ui.expand')} aria-expanded={snap !== 'peek'} onClick={cycle}>
          <span />
        </button>
        {header}
      </div>
      <div className="dsheet__body">{children}</div>
    </div>
  );
}
