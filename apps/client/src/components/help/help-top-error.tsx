import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { HELP_TOP_ERROR_MESSAGE } from './help-messages.ts';

export interface HelpTopErrorProps {
  // 取得し直す。最初の表示の失敗ではルーターの再評価、表示中の失敗では取得のやり直し
  readonly onRetry: () => Promise<unknown>;
}

// 再試行で失敗の表示が描き直されて押したボタンが消えるため、ページの見出しへフォーカスを移して<body>へ落とさない。
// 最初の表示の失敗ではページ全体が描き直されて見出しも作り直されるため、取得し直した後にもう一度移す
const focusPageHeading = (): void => {
  document.querySelector<HTMLElement>('main h1')?.focus();
};

export function HelpTopError({ onRetry }: HelpTopErrorProps) {
  const retry = () => {
    focusPageHeading();
    void onRetry().then(focusPageHeading);
  };
  return (
    <ErrorState
      message={HELP_TOP_ERROR_MESSAGE}
      onRetry={retry}
      contactHref={CLIENT_PROFILE.contactAvailable ? CONTACT_HREF : undefined}
    />
  );
}
