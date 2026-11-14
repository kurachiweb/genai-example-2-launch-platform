import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  NEXT_PAGE_LABEL,
  PREVIOUS_PAGE_LABEL,
} from '../../utilities/messages/pagination-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface PageNavigationProps {
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  // 一覧の読み込み中とエラーの間は偽にし、前後のページがあっても両方のボタンを押せなくする
  readonly settled: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

// 押した直後に最後のページや読み込み中へ変わるボタンをdisabledにしたり描かなくしたりすると、Chromiumがフォーカスを<body>へ移して操作の位置を失うため、ページ送りは描いたままaria-disabledで押せなくする
function PageButton({
  enabled,
  onPress,
  children,
}: {
  readonly enabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={enabled ? undefined : true}
      onClick={() => {
        if (enabled) {
          onPress();
        }
      }}
    >
      {children}
    </Button>
  );
}

export function PageNavigation({
  label,
  hasPrevious,
  hasNext,
  settled,
  onPrevious,
  onNext,
}: PageNavigationProps) {
  return (
    <nav aria-label={label} className="flex flex-wrap justify-end gap-2">
      <PageButton enabled={settled && hasPrevious} onPress={onPrevious}>
        <ChevronLeftIcon aria-hidden="true" />
        {PREVIOUS_PAGE_LABEL}
      </PageButton>
      <PageButton enabled={settled && hasNext} onPress={onNext}>
        {NEXT_PAGE_LABEL}
        <ChevronRightIcon aria-hidden="true" />
      </PageButton>
    </nav>
  );
}
