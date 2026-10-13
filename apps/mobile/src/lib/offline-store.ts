import type { ProjectOverview, ProjectProgress, ProjectStage, ProjectSummary } from '@jengalink/contracts';
import { copyPhoto, readStateText, removeAll, removePhoto, writeStateText } from './offline-files';
import type { OutboxItem } from './outbox-core';

/** Everything the app keeps on the device so it works without a connection. */
export interface OfflineState {
  version: 1;
  items: OutboxItem[];
  cache: {
    projects?: ProjectSummary[];
    stages?: Record<string, ProjectStage[]>;
    overview?: ProjectOverview[];
    progress?: Record<string, ProjectProgress>;
  };
}

export const emptyOfflineState = (): OfflineState => ({ version: 1, items: [], cache: {} });

export async function loadState(): Promise<OfflineState> {
  try {
    const text = await readStateText();
    if (!text) return emptyOfflineState();
    const parsed = JSON.parse(text) as OfflineState;
    return parsed.version === 1 ? parsed : emptyOfflineState();
  } catch {
    return emptyOfflineState();
  }
}

/** Writes the whole state (small: a few updates and cached lists). */
export function saveState(state: OfflineState) {
  writeStateText(JSON.stringify(state));
}

/** Copies a picked or captured photo into app storage, so it survives restarts and cache clean-ups. */
export const keepPhoto = (uri: string, contentType: string) => copyPhoto(uri, contentType);
export const deletePhoto = (localUri: string) => removePhoto(localUri);

/** Wipes the device copy when the session ends (spec §3.3). */
export function clearOffline() {
  removeAll();
}
