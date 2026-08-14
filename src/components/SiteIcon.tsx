import { createEffect, createSignal, Show } from 'solid-js';
import { initial } from '../lib/format';
import { siteIconUrl } from '../lib/siteIcons';

interface Props {
  title: string;
  url?: string;
  class?: string;
}

export default function SiteIcon(props: Props) {
  const [source, setSource] = createSignal<string>();
  const [broken, setBroken] = createSignal(false);

  createEffect(() => {
    const url = props.url;
    const title = props.title;
    setBroken(false);
    setSource(undefined);
    siteIconUrl(url, title).then((value) => setSource(value));
  });

  return (
    <div class={`site-icon ${props.class ?? ''}`}>
      <Show when={source() && !broken()}>
        <img
          class="site-icon-image"
          src={source()}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </Show>
      <Show when={!source() || broken()}>
        <span>{initial(props.title)}</span>
      </Show>
    </div>
  );
}
