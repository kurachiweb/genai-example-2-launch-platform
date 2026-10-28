import type { Decorator, Preview } from '@storybook/tanstack-react';
import { type ReactNode, useLayoutEffect } from 'react';

import { DisplayPreferencesContext } from '../components/datetime/use-display-preferences.ts';
import { TooltipProvider } from '../components/ui/tooltip/tooltip-provider.tsx';
import {
  type AppRuntime,
  createAppRuntimeHolder,
} from '../start/router-context.ts';
import '../styles/base.css';
import { WCAG_22_AA_TAGS } from '../test/a11y.ts';
import type { DisplayPreferences } from '../utilities/datetime/display-preferences.ts';
import {
  setThemePreference,
  type ThemePreference,
} from '../utilities/theme/theme-preference.ts';

const CATALOG_DISPLAY: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const CATALOG_RUNTIME: AppRuntime = {
  publicConfig: {
    environment: 'local',
    turnstileSiteKey: '1x00000000000000000000AA',
    sentry: { dsn: undefined, environment: 'local', tracesSampleRate: 0 },
    webAnalyticsToken: undefined,
  },
  display: CATALOG_DISPLAY,
};

const TOOLTIP_DELAY_MS = 200;

const themeOf = (value: unknown): ThemePreference =>
  value === 'dark' ? 'dark' : 'light';

interface CatalogFrameProps {
  readonly theme: ThemePreference;
  readonly children: ReactNode;
}

// ツールバーの配色は保存せず、アプリと同じくhtml要素のdarkクラスとcolor-schemeで切り替える。表示設定はブラウザの値へ切り替える提供の部品を通さず、どの環境でも同じ表示になる固定の値を文脈へ直接渡す
function CatalogFrame({ theme, children }: CatalogFrameProps) {
  useLayoutEffect(() => {
    setThemePreference(document.documentElement, undefined, theme);
  }, [theme]);
  return (
    <DisplayPreferencesContext value={CATALOG_DISPLAY}>
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        {children}
      </TooltipProvider>
    </DisplayPreferencesContext>
  );
}

const withCatalogFrame: Decorator = (Story, { globals }) => (
  <CatalogFrame theme={themeOf(globals.theme)}>
    <Story />
  </CatalogFrame>
);

const preview: Preview = {
  decorators: [withCatalogFrame],
  globalTypes: {
    theme: {
      description: '配色',
      toolbar: {
        title: '配色',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'ライト', icon: 'sun' },
          { value: 'dark', title: 'ダーク', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    a11y: {
      options: { runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] } },
    },
    tanstack: {
      router: {
        context: { runtime: createAppRuntimeHolder(CATALOG_RUNTIME) },
      },
    },
  },
};

export default preview;
