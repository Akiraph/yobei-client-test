import init, { generate_password } from './wasm/yobei_core.js';

let ready: Promise<unknown> | null = null;

/** Initialize the WASM module once per worker lifetime. */
export function loadCore(): Promise<unknown> {
  if (!ready) ready = init();
  return ready;
}

/** Generate a password using camelCase JSON options. */
export function generatePassword(mode: string, optsJson: string): string {
  return generate_password(mode, optsJson);
}
