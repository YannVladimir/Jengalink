// Demo or real environment (spec §34: a Demo banner stays visible). Asked once per start; the
// last answer is kept on the phone so the banner shows straight away, even offline.
import type { EnvironmentInfo } from '@jengalink/contracts';
import { useEffect, useState } from 'react';
import { API_URL, secure } from './auth';

const stored = secure('jengalink.demo');
let demo: boolean | null = null;
let asked: Promise<boolean> | null = null;

const ask = () =>
  (asked ??= (async () => {
    if (demo === null) demo = (await stored.get().catch(() => null)) === '1';
    try {
      const res = await fetch(`${API_URL}/v1/environment`);
      if (res.ok) {
        demo = ((await res.json()) as EnvironmentInfo).demo;
        await stored.set(demo ? '1' : '0').catch(() => undefined);
      }
    } catch {
      // offline: keep the last answer
    }
    return demo;
  })());

/** True in a demo environment. */
export function useDemo(): boolean {
  const [value, setValue] = useState(demo ?? false);
  useEffect(() => {
    let live = true;
    void ask().then((d) => live && setValue(d));
    return () => {
      live = false;
    };
  }, []);
  return value;
}
