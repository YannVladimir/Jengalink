import type { ProjectOverview, ProjectProgress, ProjectStage, ProjectSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import * as Network from 'expo-network';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, useAuth } from './auth';
import { deletePhoto, emptyOfflineState, loadState, type OfflineState, saveState } from './offline-store';
import { dueItems, type FailureKind, type OutboxItem, requeued, sendItem, summarize } from './outbox-core';

type SendResult = 'sent' | 'queued' | 'failed';

interface OutboxValue {
  ready: boolean;
  items: OutboxItem[];
  summary: ReturnType<typeof summarize>;
  syncing: boolean;
  /** False after a send failed for lack of connection; true again after any success. */
  online: boolean;
  cache: OfflineState['cache'];
  /** Adds or replaces an item and saves it to the device at once. */
  saveItem: (item: OutboxItem) => void;
  /** The latest saved copy of an item (not a render snapshot). */
  getItem: (id: string) => OutboxItem | undefined;
  removeItem: (id: string) => void;
  /** Queues the item and tries to send it now. */
  submit: (id: string) => Promise<SendResult>;
  syncNow: () => Promise<void>;
  cacheProjects: (list: ProjectSummary[]) => void;
  cacheStages: (projectId: string, list: ProjectStage[]) => void;
  cacheOverview: (list: ProjectOverview[]) => void;
  cacheProgress: (projectId: string, progress: ProjectProgress) => void;
}

const OutboxContext = createContext<OutboxValue | null>(null);

/**
 * Offline drafts and the send queue (Phase 3). Everything is written to the device
 * on each change, so it survives the app being closed; sending is retried on launch,
 * when the app returns to the foreground, when the connection comes back, and every 20 s.
 */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const { status, withRefresh } = useAuth();
  const state = useRef<OfflineState>(emptyOfflineState());
  const [snapshot, setSnapshot] = useState<OfflineState>(emptyOfflineState);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const running = useRef<Promise<void> | null>(null);

  const commit = useCallback((next: OfflineState) => {
    state.current = next;
    setSnapshot(next);
    saveState(next);
  }, []);
  const upsert = useCallback(
    (item: OutboxItem) => {
      const items = state.current.items.some((i) => i.id === item.id) ? state.current.items.map((i) => (i.id === item.id ? item : i)) : [...state.current.items, item];
      commit({ ...state.current, items });
    },
    [commit],
  );
  const removeItem = useCallback(
    (id: string) => {
      const gone = state.current.items.find((i) => i.id === id);
      gone?.photos.forEach((p) => deletePhoto(p.localUri));
      commit({ ...state.current, items: state.current.items.filter((i) => i.id !== id) });
    },
    [commit],
  );

  const sendOne = useCallback(
    async (start: OutboxItem): Promise<'sent' | FailureKind> => {
      const { outcome, item } = await sendItem(start, {
        grantUpload: (projectId, contentType) => withRefresh(() => request(() => api.POST('/v1/projects/{id}/uploads', { params: { path: { id: projectId } }, body: { contentType } }))),
        putFile: async (localUri, url, headers) => fetch(url, { method: 'PUT', headers, body: await (await fetch(localUri)).blob() }),
        postUpdate: async (projectId, sendKey, body) => {
          await withRefresh(() => request(() => api.POST('/v1/projects/{id}/updates', { params: { path: { id: projectId }, header: { 'Idempotency-Key': sendKey } }, body })));
        },
        save: upsert,
      });
      if (outcome === 'sent') removeItem(item.id);
      else upsert(item);
      return outcome;
    },
    [removeItem, upsert, withRefresh],
  );

  const runOnce = useCallback(async () => {
    setSyncing(true);
    try {
      for (const item of dueItems(state.current.items)) {
        const result = await sendOne(item);
        if (result === 'offline') {
          setOnline(false);
          break;
        }
        setOnline(true);
      }
    } finally {
      setSyncing(false);
    }
  }, [sendOne]);

  /** One sync at a time; a request during a sync runs again right after it. */
  const syncNow = useCallback(async () => {
    if (status !== 'signedIn') return;
    if (running.current) await running.current;
    if (!dueItems(state.current.items).length) return;
    const run = runOnce().finally(() => {
      running.current = null;
    });
    running.current = run;
    await run;
  }, [runOnce, status]);

  const submit = useCallback(
    async (id: string): Promise<SendResult> => {
      const item = state.current.items.find((i) => i.id === id);
      if (!item) return 'sent';
      // A failed update may have been edited: it goes under a new key.
      upsert(requeued(item));
      await syncNow();
      const after = state.current.items.find((i) => i.id === id);
      return !after ? 'sent' : after.status === 'failed' ? 'failed' : 'queued';
    },
    [syncNow, upsert],
  );

  // Load what was saved on the device.
  useEffect(() => {
    let live = true;
    void loadState().then((s) => {
      if (!live) return;
      state.current = s;
      setSnapshot(s);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // Signing out wipes the device copy; forget the in-memory one too.
  useEffect(() => {
    if (ready && status === 'signedOut' && state.current.items.length + Object.keys(state.current.cache).length > 0) commit(emptyOfflineState());
  }, [ready, status, commit]);

  /** Saves the projects and their stages, so the composer and the feed work later without a connection. */
  const refreshCache = useCallback(async () => {
    try {
      const projects = await withRefresh(() => request(() => api.GET('/v1/projects')));
      const stages: Record<string, ProjectStage[]> = { ...state.current.cache.stages };
      // Every project: reporters need stages for the composer, everyone for the feed's stage filter.
      for (const p of projects) stages[p.id] = await withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id: p.id } } })));
      commit({ ...state.current, cache: { ...state.current.cache, projects, stages } });
    } catch {
      // Offline: keep the saved copy.
    }
  }, [commit, withRefresh]);

  // When to try sending: on launch/sign-in, foreground, reconnect, and every 20 s.
  useEffect(() => {
    if (!ready || status !== 'signedIn') return;
    void refreshCache();
    void syncNow();
    const appState = AppState.addEventListener('change', (s) => s === 'active' && void syncNow());
    const net =
      Platform.OS === 'web'
        ? (() => {
            const on = () => void syncNow();
            globalThis.addEventListener?.('online', on);
            return { remove: () => globalThis.removeEventListener?.('online', on) };
          })()
        : Network.addNetworkStateListener((n) => n.isConnected && void syncNow());
    const timer = setInterval(() => void syncNow(), 20_000);
    return () => {
      appState.remove();
      net.remove();
      clearInterval(timer);
    };
  }, [ready, status, syncNow, refreshCache]);

  const value = useMemo<OutboxValue>(
    () => ({
      ready,
      items: snapshot.items,
      summary: summarize(snapshot.items),
      syncing,
      online,
      cache: snapshot.cache,
      saveItem: upsert,
      getItem: (id) => state.current.items.find((i) => i.id === id),
      removeItem,
      submit,
      syncNow,
      cacheProjects: (list) => commit({ ...state.current, cache: { ...state.current.cache, projects: list } }),
      cacheStages: (projectId, list) => commit({ ...state.current, cache: { ...state.current.cache, stages: { ...state.current.cache.stages, [projectId]: list } } }),
      cacheOverview: (list) => commit({ ...state.current, cache: { ...state.current.cache, overview: list } }),
      cacheProgress: (projectId, progress) => commit({ ...state.current, cache: { ...state.current.cache, progress: { ...state.current.cache.progress, [projectId]: progress } } }),
    }),
    [ready, snapshot, syncing, online, upsert, removeItem, submit, syncNow, commit],
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxValue {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error('useOutbox must be used inside OutboxProvider');
  return ctx;
}
