import {
  HeadContent,
  ScriptOnce,
  Scripts,
  useRouter,
} from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';

import { initBrowserObservability } from '../../start/observability/browser-observability.ts';
import { browserErrorQueue } from '../../start/observability/report-error.ts';
import { installPreloadRecovery } from '../../start/preload-recovery.ts';
import { appRuntimeOf } from '../../start/router-context.ts';
import { THEME_BOOTSTRAP_SCRIPT } from '../../utilities/theme/theme-preference.ts';
import { DisplayPreferencesProvider } from '../datetime/display-preferences-provider.tsx';
import { Toaster } from '../feedback/toaster.tsx';
import { TooltipProvider } from '../ui/tooltip/tooltip-provider.tsx';
import { RouteAnnouncer } from './route-announcer.tsx';
import { SkipLink } from './skip-link.tsx';

export interface AppDocumentProps {
  readonly children: ReactNode;
}

const TOOLTIP_DELAY_MS = 200;

// Cookieやサイトデータを禁止した設定では参照するだけで例外になるため、保存先が無いものとして扱う
const sessionStorageOrUndefined = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const reloadPage = (): void => {
  window.location.reload();
};

// html要素の配色のclassとstyleは初回描画前のスクリプトがハイドレーションより前に書き換えるため、html要素だけ属性の不一致の警告を抑える
export function AppDocument({ children }: AppDocumentProps) {
  const router = useRouter();
  const runtime = appRuntimeOf(router.options.context);
  const sentry = runtime.publicConfig.sentry;

  useEffect(() => {
    void initBrowserObservability({
      router,
      config: sentry,
      queue: browserErrorQueue,
    });
  }, [router, sentry]);

  useEffect(
    () =>
      installPreloadRecovery({
        target: window,
        storage: sessionStorageOrUndefined(),
        reload: reloadPage,
      }),
    [],
  );

  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* サーバーの描画でだけnonce付きで出力し、本文の解析より前に配色を反映した後に自身を取り除くため、ハイドレーションで食い違わず再実行もされない */}
        <ScriptOnce>{THEME_BOOTSTRAP_SCRIPT}</ScriptOnce>
        <HeadContent />
      </head>
      <body>
        <SkipLink />
        <DisplayPreferencesProvider initial={runtime.display}>
          <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
            {children}
          </TooltipProvider>
        </DisplayPreferencesProvider>
        <Toaster />
        <RouteAnnouncer />
        <Scripts />
      </body>
    </html>
  );
}
