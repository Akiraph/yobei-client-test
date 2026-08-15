import { lazy, Show, Suspense } from 'solid-js';
import { createVaultFeature } from '../features/vault/model';

const VaultPageDesktop = lazy(() => import('./VaultPage.desktop'));
const VaultPageMobile = lazy(() => import('./VaultPage.mobile'));

export default function VaultPage() {
  const feature = createVaultFeature();

  return (
    <Suspense fallback={<div class="vault-root fog-reveal" />}>
      <Show when={feature.isMobile()} fallback={<VaultPageDesktop feature={feature} />}>
        <VaultPageMobile feature={feature} />
      </Show>
    </Suspense>
  );
}
