// Web preview: localStorage, with photos kept as data: URLs (small; for testing in a browser).
const KEY = 'jengalink.offline';

export function readStateText(): Promise<string | null> {
  return Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null);
}

export function writeStateText(text: string) {
  globalThis.localStorage?.setItem(KEY, text);
}

export async function copyPhoto(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export function removePhoto(_localUri: string) {
  // Data URLs live inside the saved state; nothing separate to delete.
}

export function removeAll() {
  globalThis.localStorage?.removeItem(KEY);
}
