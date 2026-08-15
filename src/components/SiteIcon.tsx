import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { initial } from '../lib/format';
import { siteIconUrl, siteIconUrlSync } from '../lib/siteIcons';

interface Props {
  title: string;
  url?: string;
  class?: string;
}

export default function SiteIcon(props: Props) {
  const [source, setSource] = createSignal<string | undefined>(siteIconUrlSync(props.url, props.title));
  const [broken, setBroken] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  createEffect(() => {
    const url = props.url;
    const title = props.title;
    let active = true;
    setBroken(false);
    setLoaded(false);
    setSource(siteIconUrlSync(url, title));
    siteIconUrl(url, title)
      .then((value) => {
        if (!active) return;
        setSource(value);
        setLoaded(false);
      })
      .catch(() => {});
    onCleanup(() => { active = false; });
  });

  return (
    <div class={`site-icon ${props.class ?? ''}`}>
      <span class="site-icon-fallback" classList={{ faded: !!source() && loaded() }}>
        {initial(props.title)}
      </span>
      <Show when={source() && !broken()}>
        <img
          class="site-icon-image"
          classList={{ loaded: loaded() }}
          src={source()}
          alt=""
          loading="eager"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => { setBroken(true); setLoaded(false); }}
        />
      </Show>
    </div>
  );
}
