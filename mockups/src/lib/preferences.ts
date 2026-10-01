import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export type Motion = 'on' | 'off';

const THEME_KEY = 'ls-theme';
const MOTION_KEY = 'ls-motion';

// 初回描画前にlocalStorageとOS設定を反映し、ライト表示やアニメーションの一瞬のちらつきを防ぐ
export const PREFERENCE_BOOTSTRAP_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('${THEME_KEY}');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;var m=localStorage.getItem('${MOTION_KEY}');if(!m){m=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}d.dataset.motion=m}catch(e){}})()`;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function readMotion(): Motion {
  return document.documentElement.dataset.motion === 'off' ? 'off' : 'on';
}

export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // プライベートモード等で保存できなくても表示は切り替える
  }
  emit();
}

export function setMotion(motion: Motion) {
  document.documentElement.dataset.motion = motion;
  try {
    localStorage.setItem(MOTION_KEY, motion);
  } catch {
    // プライベートモード等で保存できなくても表示は切り替える
  }
  emit();
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'light');
}

export function useMotion(): Motion {
  return useSyncExternalStore(subscribe, readMotion, () => 'on');
}
