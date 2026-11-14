import { MoonIcon, SunIcon } from 'lucide-react';

import {
  SWITCH_TO_DARK_LABEL,
  SWITCH_TO_LIGHT_LABEL,
} from '../../utilities/messages/app-shell-messages.ts';
import { Button } from '../ui/button/button.tsx';
import { Tooltip } from '../ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../ui/tooltip/tooltip-trigger.tsx';
import { useTheme } from './use-theme.ts';

// サーバーは配色を知らないため、名前・アイコン・ツールチップは初回描画前のスクリプトがhtml要素に付けるdarkクラスでCSSから出し分け、ハイドレーションより前から切り替え先を正しく示す。表示しない側はdisplay:noneで名前の計算からも除かれる
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            setTheme(theme === 'dark' ? 'light' : 'dark');
          }}
        >
          <MoonIcon aria-hidden="true" className="dark:hidden" />
          <SunIcon aria-hidden="true" className="hidden dark:block" />
          <span className="sr-only dark:hidden">{SWITCH_TO_DARK_LABEL}</span>
          <span className="sr-only hidden dark:inline">
            {SWITCH_TO_LIGHT_LABEL}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="dark:hidden">{SWITCH_TO_DARK_LABEL}</span>
        <span className="hidden dark:inline">{SWITCH_TO_LIGHT_LABEL}</span>
      </TooltipContent>
    </Tooltip>
  );
}
