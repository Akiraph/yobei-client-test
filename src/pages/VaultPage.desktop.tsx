import { lazy, Show, Suspense } from 'solid-js';
import Sidebar from '../features/vault/ui/Sidebar';
import ItemList from '../features/vault/ui/ItemList';
import VaultDetailPane from '../features/vault/ui/VaultDetailPane';
import { addTotpFromUri } from '../features/vault/totp';
import ScanPage from '../components/ScanPage';
import { t } from '../lib/i18n';
import type { VaultFeature } from '../features/vault/model';

const Settings = lazy(() => import('../routes/Settings'));

interface Props {
  feature: VaultFeature;
}

export default function VaultPageDesktop(props: Props) {
  return (
    <div class={`vault-root fog-reveal${props.feature.condensing() ? ' fog-condense' : ''}`}>
      <Show when={props.feature.scanning()}>
        <ScanPage
          label={t('list.scan')}
          onClose={props.feature.closeScan}
          onResult={addTotpFromUri}
        />
      </Show>

      <Show when={!props.feature.scanning() && props.feature.settingsOpen()}>
        <Suspense fallback={null}>
          <Settings onClose={props.feature.closeSettings} />
        </Suspense>
      </Show>

      <Show when={!props.feature.scanning() && !props.feature.settingsOpen()}>
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
