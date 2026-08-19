import { Show, onCleanup } from 'solid-js';
import { scanRequest, scanner } from '../../core/scan';
import ScanPage from './ScanPage';

// Mounted for the lifetime of the unlocked phase so any feature (vault scan,
// settings device pairing, ...) can raise the camera scanner via `scanner.open`
// without owning scanner state itself. Unmounting (e.g. auto-lock) releases
// the camera and drops the pending scan request.
export default function ScannerHost() {
  onCleanup(() => scanner.clear());

  return (
    <Show when={scanRequest()}>
      {(request) => <ScanPage onResult={request().onResult} onClose={scanner.close} />}
    </Show>
  );
}
