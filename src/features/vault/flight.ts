// Row → detail container transform. The pane keeps its final layout and is
// revealed through a clip window that starts exactly on the tapped row, so no
// text or icon is ever stretched. The row's icon and title fly to their detail
// positions on top of that, and an opaque surface travels with the window so
// the growing rectangle hides whatever sits behind it.
const DURATION = 260;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
// Matches --r-md, the row's own corner radius.
const ROW_RADIUS = 12;

// Everything that is not a shared element simply fades in inside the window.
const FADE_SELECTOR = '.detail-scroll > :not(.detail-header), .detail-header .icon-btn, .detail-url';

export interface RowOrigin {
  rect: DOMRect;
  icon: DOMRect | null;
  title: DOMRect | null;
}

export interface Flight {
  /** Resolves once every part of the transition has settled. */
  finished: Promise<void>;
  /** Drops all fills and the flight styling. Safe to call twice. */
  cancel: () => void;
}

export function rowOrigin(id: string | null): RowOrigin | null {
  if (!id) return null;
  const row = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { rect, icon: rectOf(row, '.item-icon'), title: rectOf(row, '.item-title') };
}

function rectOf(root: Element, selector: string): DOMRect | null {
  const found = root.querySelector(selector);
  const rect = found?.getBoundingClientRect();
  return rect && rect.width && rect.height ? rect : null;
}

/**
 * Animates `pane` out of (or, with `reverse`, back onto) `origin`.
 * Returns null when the transition cannot or should not run; callers that
 * reverse must `cancel()` once the pane is gone, otherwise the fill keeps it
 * collapsed.
 */
export function flight(pane: HTMLElement, origin: RowOrigin, reverse = false): Flight | null {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  // Measure everything first: reading a rect after an animation has started
  // would report the animated position instead of the resting layout.
  const target = pane.getBoundingClientRect();
  if (!target.width || !target.height) return null;

  // Window the size of the row, pinned to the pane's top-left, then moved onto
  // the row. Clamped because the desktop pane is narrower than a list row.
  const width = Math.min(origin.rect.width, target.width);
  const height = Math.min(origin.rect.height, target.height);
  const dx = origin.rect.left - target.left;
  const dy = origin.rect.top - target.top;

  const plan: Array<[Element, Keyframe[]]> = [[pane, [
    {
      transform: `translate(${dx}px, ${dy}px)`,
      clipPath: `inset(0px ${target.width - width}px ${target.height - height}px 0px round ${ROW_RADIUS}px)`,
    },
    { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
  ]]];

  // Shared elements move against the pane's own translation, so they stay on
  // their row counterparts at the start of the flight.
  push(plan, pane, '.detail-icon', origin.icon, dx, dy);
  push(plan, pane, '.detail-title', origin.title, dx, dy);

  for (const element of pane.querySelectorAll(FADE_SELECTOR)) {
    plan.push([element, [
      { opacity: '0', offset: 0 },
      { opacity: '0', offset: 0.4 },
      { opacity: '1', offset: 1 },
    ]]);
  }

  pane.classList.add('flying');

  // `direction: reverse` instead of reversed keyframe arrays: offsets stay
  // valid and the easing curve mirrors itself for the closing direction.
  const options: KeyframeAnimationOptions = {
    duration: DURATION,
    easing: EASING,
    fill: 'both',
    direction: reverse ? 'reverse' : 'normal',
  };
  const animations = plan.map(([element, frames]) => element.animate(frames, options));

  let stopped = false;
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    for (const animation of animations) animation.cancel();
    pane.classList.remove('flying');
  };

  const finished = Promise.all(animations.map((animation) => animation.finished.catch(() => {})))
    .then(() => {
      // Forward: release right away so the pane holds no leftover transform.
      // Reverse: keep the collapsed fill until the caller unmounts the pane.
      if (!reverse) cancel();
    });

  return { finished, cancel };
}

function push(
  plan: Array<[Element, Keyframe[]]>,
  pane: HTMLElement,
  selector: string,
  from: DOMRect | null,
  dx: number,
  dy: number,
): void {
  if (!from) return;
  const element = pane.querySelector(selector);
  const to = element?.getBoundingClientRect();
  if (!element || !to || !to.height) return;

  // The pane's own translate also moves this element, so subtract it to land on
  // the row's rect. Scaling by height keeps the vertical rhythm for text and is
  // exact for the square icon.
  const scale = from.height / to.height;
  const offsetX = from.left - to.left - dx;
  const offsetY = (from.top + from.height / 2) - (to.top + to.height / 2) - dy;
  plan.push([element, [
    { transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`, transformOrigin: 'left center' },
    { transform: 'none', transformOrigin: 'left center' },
  ]]);
}
