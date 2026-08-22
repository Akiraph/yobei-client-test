// Item ↔ detail transition. The tapped row's rect is the origin, so the detail
// pane reads as that row growing: to fullscreen on mobile, into the right pane
// on desktop. Closing plays it backwards and lands on the row, which never left
// the list — so the list keeps its scroll position for free.
const DURATION = 180;

export function rowRect(id: string | null): DOMRect | null {
  if (!id) return null;
  const row = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
  return row?.getBoundingClientRect() ?? null;
}

// Returns the running animation, or null when it cannot or should not run.
// Callers that reverse must cancel it once the pane is gone, otherwise fill
// leaves the element collapsed.
export function flight(el: HTMLElement, origin: DOMRect, reverse = false): Animation | null {
  const target = el.getBoundingClientRect();
  if (!target.width || !target.height) return null;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  const collapsed = {
    transformOrigin: '0 0',
    transform: `translate(${origin.left - target.left}px, ${origin.top - target.top}px)`
      + ` scale(${origin.width / target.width}, ${origin.height / target.height})`,
    opacity: '0',
  };
  const expanded = { transformOrigin: '0 0', transform: 'none', opacity: '1' };

  return el.animate(reverse ? [expanded, collapsed] : [collapsed, expanded], {
    duration: DURATION,
    easing: reverse ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0, 0, 0.2, 1)',
    fill: 'both',
  });
}
