// Phones: a folder in the app's document directory (the OS does not clear it).
// The web preview uses offline-files.web.ts instead (Metro picks it by platform).
import { Directory, File, Paths } from 'expo-file-system';
import { newId } from './outbox-core';

const root = () => {
  const dir = new Directory(Paths.document, 'jengalink-offline');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};
const stateFile = () => new File(root(), 'state.json');

export async function readStateText(): Promise<string | null> {
  const f = stateFile();
  return f.exists ? await f.text() : null;
}

export function writeStateText(text: string) {
  const f = stateFile();
  if (!f.exists) f.create({ intermediates: true });
  f.write(text);
}

/** Copies a picked or captured photo into app storage; returns its file:// URI. */
export async function copyPhoto(uri: string, contentType: string): Promise<string> {
  const dir = new Directory(root(), 'photos');
  dir.create({ idempotent: true, intermediates: true });
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/heic' ? 'heic' : 'jpg';
  const target = new File(dir, `${newId('photo')}.${ext}`);
  await new File(uri).copy(target);
  return target.uri;
}

export function removePhoto(localUri: string) {
  if (!localUri.startsWith('file:')) return;
  try {
    const f = new File(localUri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

export function removeAll() {
  try {
    const dir = new Directory(Paths.document, 'jengalink-offline');
    if (dir.exists) dir.delete();
  } catch {
    // Nothing stored.
  }
}
