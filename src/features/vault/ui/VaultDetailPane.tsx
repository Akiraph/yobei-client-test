import { lazy, Show, Suspense } from 'solid-js';
import ItemDetail from './ItemDetail';
import type { VaultFeature } from '../model';

const ItemEditor = lazy(() => import('./ItemEditor'));

interface Props {
  feature: VaultFeature;
  mobile?: boolean;
}

export default function VaultDetailPane(props: Props) {
  return (
    <aside class="vault-detail">
      <Show when={props.feature.editing()} fallback={
        <ItemDetail
          feature={props.feature}
          onBack={props.mobile ? props.feature.back : undefined}
          onEdit={props.feature.edit}
          onDelete={props.feature.remove}
        />
      }>
        <Suspense fallback={<div class="detail-pane" />}>
          <ItemEditor
            feature={props.feature}
            item={props.feature.editingItem()}
            onClose={props.feature.closeEditor}
          />
        </Suspense>
      </Show>
    </aside>
  );
}
