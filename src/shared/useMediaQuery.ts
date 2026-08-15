import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

/** Keeps viewport decisions in one reactive boundary instead of per-page resize handlers. */
export function createMediaQuery(query: string): Accessor<boolean> {
  const initial = typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = createSignal(initial);

  onMount(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      onCleanup(() => media.removeEventListener('change', update));
    } else {
      const legacyMedia = media as MediaQueryList & {
        addListener: (listener: (event: MediaQueryListEvent) => void) => void;
        removeListener: (listener: (event: MediaQueryListEvent) => void) => void;
      };
      legacyMedia.addListener(update);
      onCleanup(() => legacyMedia.removeListener(update));
    }
  });

  return matches;
}
