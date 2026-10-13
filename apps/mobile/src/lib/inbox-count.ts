import { useSyncExternalStore } from 'react';

// How many decisions wait on me: set wherever the inbox is loaded, shown on the Home tab.
let count = 0;
const listeners = new Set<() => void>();

export function setInboxCount(n: number) {
  if (n === count) return;
  count = n;
  for (const l of listeners) l();
}

export function useInboxCount() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
  );
}
