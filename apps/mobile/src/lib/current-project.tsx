import type { ProjectSummary } from '@jengalink/contracts';
import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useOutbox } from './outbox';

const KEY = 'jengalink.currentProject';
const read = () =>
  Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY).catch(() => null);
const write = (id: string) =>
  Platform.OS === 'web' ? globalThis.localStorage?.setItem(KEY, id) : void SecureStore.setItemAsync(KEY, id).catch(() => undefined);

interface CurrentProject {
  projects: ProjectSummary[];
  project: ProjectSummary | null;
  select: (id: string) => void;
}

const Ctx = createContext<CurrentProject>({ projects: [], project: null, select: () => {} });

/**
 * Which real project the tabs show. The list comes from the copy the outbox keeps
 * (refreshed on every online launch), so it works offline; the choice is remembered.
 */
export function CurrentProjectProvider({ children }: { children: ReactNode }) {
  const { cache } = useOutbox();
  const projects = useMemo(() => cache.projects ?? [], [cache.projects]);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    void read().then((id) => setChosen((cur) => cur ?? id));
  }, []);

  const value = useMemo<CurrentProject>(() => {
    // Default: the active project first, then any other.
    const project =
      projects.find((p) => p.id === chosen) ?? projects.find((p) => p.status === 'active') ?? projects[0] ?? null;
    return {
      projects,
      project,
      select: (id) => {
        setChosen(id);
        write(id);
      },
    };
  }, [projects, chosen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCurrentProject = () => useContext(Ctx);
