import { createEffect, createSignal, Show } from 'solid-js';

export default function QrCode(props: { value: string; label?: string }) {
  const [source, setSource] = createSignal('');

  createEffect(() => {
    const value = props.value;
    if (!value) return;
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(value, { margin: 1, width: 240 }))
      .then(setSource)
      .catch(() => {});
  });

  return (
    <Show when={source()}>
      <img class="transfer-qr" src={source()} alt={props.label ?? 'QR'} />
    </Show>
  );
}
