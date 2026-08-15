import { Show } from 'solid-js';
import ItemDetail from './ItemDetail';
import ItemEditor from './ItemEditor';
import type { VaultFeature } from '../model';

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
        <ItemEditor
          feature={props.feature}
          item={props.feature.editingItem()}
          onClose={props.feature.closeEditor}
        />
      </Show>
    </aside>
  );
}
