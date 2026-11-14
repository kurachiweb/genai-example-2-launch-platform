import type { ReactNode } from 'react';

import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { renderInRouter } from '../../../test/page-router.tsx';

export type MotionHost = 'on' | 'off' | 'none';

export interface MatchFrameOptions {
  readonly host?: MotionHost;
  // 部品を置く枠の幅(px)。省略すると画面の幅いっぱいにする
  readonly width?: number;
  // 表示中のページのURL。省略するとトップページにする
  readonly path?: string;
}

// アプリの文書の外枠が置く表示設定とツールチップの文脈を与え、トップページの根と同じく自動更新の状態を祖先の属性で示す
export function renderInMatchFrame(
  element: ReactNode,
  { host = 'on', width, path }: MatchFrameOptions = {},
) {
  const style = width === undefined ? undefined : { width };
  const autoRefresh = host === 'none' ? undefined : host;
  return renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <div data-auto-refresh={autoRefresh} className="p-8" style={style}>
          {element}
        </div>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { path },
  );
}
