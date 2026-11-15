import type { MouseEvent } from 'react';

import { SKIP_TO_MAIN_LABEL } from '../../utilities/messages/app-shell-messages.ts';
import { MAIN_CONTENT_ID } from './main-content.ts';

// URLのフラグメントを変えるとルーターが遷移として扱い履歴も増えるため、スクリプトが動く時は本文へ直接フォーカスを移す。フォーカスできない要素は-1のtabindexで受け取れるようにする
const moveFocusToMain = (event: MouseEvent<HTMLAnchorElement>): void => {
  const main = document.getElementById(MAIN_CONTENT_ID);
  if (main === null) {
    return;
  }
  event.preventDefault();
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
  }
  main.focus();
};

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-slot="skip-link"
      className="sr-only bg-background text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:px-4 focus:py-2 focus:shadow-md"
      onClick={moveFocusToMain}
    >
      {SKIP_TO_MAIN_LABEL}
    </a>
  );
}
