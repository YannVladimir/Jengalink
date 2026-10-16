// Demo or real environment (spec §34: a Demo banner stays visible). Asked once per page load;
// the last answer is remembered so the banner shows straight away, even offline.
import type { EnvironmentInfo } from '@jengalink/contracts';
import { useEffect, useState } from 'react';
import { API_URL } from './api';

const KEY = 'jengalink.demo';
const remembered = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

let demo = remembered();
let asked: Promise<boolean> | null = null;
const ask = () =>
  (asked ??= fetch(`${API_URL}/v1/environment`)
    .then((r) => (r.ok ? (r.json() as Promise<EnvironmentInfo>) : Promise.reject(new Error(String(r.status)))))
    .then((info) => {
      demo = info.demo;
      try {
        localStorage.setItem(KEY, demo ? '1' : '0');
      } catch {
        /* private mode */
      }
      return demo;
    })
    .catch(() => demo));

/** True in a demo environment. */
export function useDemo(): boolean {
  const [value, setValue] = useState(demo);
  useEffect(() => {
    let live = true;
    void ask().then((d) => live && setValue(d));
    return () => {
      live = false;
    };
  }, []);
  return value;
}
