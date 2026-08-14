import { createSignal, type JSX } from 'solid-js';

interface DialogState {
  open: boolean;
  title?: string;
  onClose?: () => void;
  children?: JSX.Element;
}

const [dialogState, setDialogState] = createSignal<DialogState>({ open: false });

export function showDialog(title: string, children: JSX.Element, onClose?: () => void) {
  setDialogState({ open: true, title, children, onClose });
}

export function hideDialog() {
  const s = dialogState();
  if (s.onClose) s.onClose();
  setDialogState({ open: false, children: undefined, onClose: undefined });
}

export { dialogState };
