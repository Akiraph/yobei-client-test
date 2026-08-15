import type { JSX } from 'solid-js';

interface Props {
  class?: string;
  onPointerDown?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>;
}
export default function Backdrop(props: Props) {
  return (
    <div
      class={`ui-backdrop${props.class ? ` ${props.class}` : ''}`}
      aria-hidden="true"
      onPointerDown={props.onPointerDown}
    />
  );
}
