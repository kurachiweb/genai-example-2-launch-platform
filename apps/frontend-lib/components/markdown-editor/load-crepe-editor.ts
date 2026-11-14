import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

import { PRELOAD_ERROR_EVENT } from '../../start/preload-recovery.ts';
import type { EditorSurfaceProps } from './editor-controller.ts';
import { EditorLoadError } from './editor-load-error.ts';

export type EditorSurfaceComponent = ComponentType<EditorSurfaceProps>;

export interface EditorSurfaceModule {
  readonly default: EditorSurfaceComponent;
}

// Viteの読み込みの補助は、既定の動作を止めた読み込みの失敗を例外にせず、値の無いモジュールとして返す
export type ImportEditorSurface = () => Promise<
  EditorSurfaceModule | undefined
>;

export const importCrepeEditorSurface: ImportEditorSurface = () =>
  import('./crepe/crepe-editor-surface.tsx');

// 読み込みの失敗でページを再読み込みすると同じフォームの未保存の値が失われるため、読み込みの間の失敗の通知の既定の動作を止める。ページの再読み込みの聞き手は通知の全ての聞き手が終わってから既定の動作が止められたかを見る
async function importWithoutPageReload(
  importSurface: ImportEditorSurface,
): Promise<EditorSurfaceModule> {
  const preloadFailures: unknown[] = [];
  const preventPageReload = (event: Event): void => {
    event.preventDefault();
    preloadFailures.push('payload' in event ? event.payload : undefined);
  };
  window.addEventListener(PRELOAD_ERROR_EVENT, preventPageReload);
  let surfaceModule: EditorSurfaceModule | undefined;
  try {
    surfaceModule = await importSurface();
  } catch (error) {
    throw new EditorLoadError(error);
  } finally {
    window.removeEventListener(PRELOAD_ERROR_EVENT, preventPageReload);
  }
  if (surfaceModule === undefined) {
    throw new EditorLoadError(preloadFailures.at(-1));
  }
  return surfaceModule;
}

export const loadCrepeEditor = (
  importSurface: ImportEditorSurface = importCrepeEditorSurface,
): LazyExoticComponent<EditorSurfaceComponent> =>
  lazy(() => importWithoutPageReload(importSurface));
