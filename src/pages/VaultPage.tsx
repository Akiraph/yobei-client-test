import { Show } from 'solid-js';
import { createVaultFeature } from '../features/vault/model';
import VaultPageDesktop from './VaultPage.desktop';
import VaultPageMobile from './VaultPage.mobile';

export default function VaultPage() {
  const feature = createVaultFeature();

  return (
    <Show when={feature.isMobile()} fallback={<VaultPageDesktop feature={feature} />}>
      <VaultPageMobile feature={feature} />
    </Show>
  );
}
