import { invoke } from '@tauri-apps/api/core';
import { appError } from './errors';

export async function readExternalAsset(path: string): Promise<string> {
  try {
    return await invoke<string>('read_external_asset', { path });
  } catch (error) {
    throw appError(error, 'file_failed');
  }
}
