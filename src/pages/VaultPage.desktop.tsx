import { Show } from 'solid-js';
import Settings from '../routes/Settings';
import Sidebar from '../features/vault/ui/Sidebar';
import ItemList from '../features/vault/ui/ItemList';
import VaultDetailPane from '../features/vault/ui/VaultDetailPane';
import type { VaultFeature } from '../features/vault/model';

interface Props {
  feature: VaultFeature;
}

export default function VaultPageDesktop(props: Props) {
  return (
    <div class={`vault-root fog-reveal${props.feature.condensing() ? ' fog-condense' : ''}`}>
      <Show when={props.feature.settingsOpen()}>
        <Settings onClose={props.feature.closeSettings} />
      </Show>

      <Show when={!props.feature.settingsOpen()}>
        <aside class="vault-sidebar">
          <Sidebar feature={props.feature} />
        </aside>

        <section class="vault-list">
          <ItemList feature={props.feature} onNew={props.feature.createNew} />
        </section>

        <VaultDetailPane feature={props.feature} />
      </Show>
    </div>
  );
}
