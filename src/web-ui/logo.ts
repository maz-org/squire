import { readFile } from 'node:fs/promises';

import { SQUIRE_LOGO_PNG_PATH } from './asset-paths.ts';

let logoPngInFlight: Promise<Uint8Array<ArrayBuffer>> | null = null;

async function readLogoPng(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await readFile(SQUIRE_LOGO_PNG_PATH);
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

export function getSquireLogoPng(): Promise<Uint8Array<ArrayBuffer>> {
  logoPngInFlight ??= readLogoPng();
  return logoPngInFlight;
}
