import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

const TOKEN_STYLE = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
  fontFamily: 'var(--font-sans)',
} as CSSProperties;

const ICONS = {
  success: <CircleCheckIcon aria-hidden="true" className="size-4" />,
  info: <InfoIcon aria-hidden="true" className="size-4" />,
  warning: <TriangleAlertIcon aria-hidden="true" className="size-4" />,
  error: <OctagonXIcon aria-hidden="true" className="size-4" />,
};

// sonnerがレイヤー外に差し込む輪郭を消す規則は、base.cssのフォーカスの輪郭(レイヤー内)に勝つため、トーストにだけ!importantで同じ見た目の輪郭を付ける
const TOAST_OPTIONS = {
  classNames: {
    toast:
      'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring! focus-visible:outline-solid!',
  },
};

// sonnerの見た目の規則はTailwindのレイヤーより優先されるため、配色とフォントはインラインのCSS変数でトークンへ差し替える
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      containerAriaLabel="通知"
      icons={ICONS}
      style={TOKEN_STYLE}
      toastOptions={TOAST_OPTIONS}
    />
  );
}
