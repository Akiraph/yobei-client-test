import { createSignal, type JSX } from 'solid-js';

interface DialogState {
  open: boolean;
  title?: string;
  body?: JSX.Element;
  onClose?: () => void;
}

const [dialog, setDialog] = createSignal<DialogState>({ open: false });

export function showDialog(title: string, body: JSX.Element, onClose?: () => void): void {
  setDialog({ open: true, title, body, onClose });
}

export function hideDialog(): void {
  const current = dialog();
  current.onClose?.();
  setDialog({ open: false });
}

export { dialog };
