import { ChevronDownIcon } from 'lucide-react';
import {
  type FocusEvent,
  type RefObject,
  type UIEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  COLLAPSE_LABEL,
  READ_MORE_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import { Button } from '../ui/button/button.tsx';
import {
  MarkdownContent,
  type MarkdownContentProps,
} from './markdown-content.tsx';

export interface CollapsibleMarkdownContentProps extends MarkdownContentProps {
  readonly collapsedHeight: number;
  readonly fadeClassName?: string;
}

type Fit = 'unmeasured' | 'fits' | 'overflows';

interface RevealTarget {
  readonly element: Element;
  readonly block: ScrollLogicalPosition;
}

// 小数の画素の丸めで指定の高さをわずかに超えるだけの本文は、切り取られる部分が見えないため折りたたまない
const OVERFLOW_TOLERANCE_PX = 1;

function useContentFit(
  contentRef: RefObject<HTMLDivElement | null>,
  collapsedHeight: number,
): Fit {
  const [fit, setFit] = useState<Fit>('unmeasured');
  useEffect(() => {
    const content = contentRef.current;
    if (content === null) {
      return;
    }
    const measure = () => {
      const height = content.getBoundingClientRect().height;
      setFit(
        height > collapsedHeight + OVERFLOW_TOLERANCE_PX ? 'overflows' : 'fits',
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [contentRef, collapsedHeight]);
  return fit;
}

const isHiddenBelow = (target: Element, body: HTMLElement): boolean =>
  body.scrollTop > 0 ||
  target.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom;

const isShownWithin = (element: Element, body: HTMLElement): boolean => {
  const target = element.getBoundingClientRect();
  const bounds = body.getBoundingClientRect();
  return target.top < bounds.bottom && target.bottom > bounds.top;
};

// ブラウザはフラグメントを元の表記とパーセント符号化を戻した表記の両方でIDと照合する
function elementOfLocationHash(): Element | null {
  const fragment = location.hash.slice(1);
  if (fragment === '') {
    return null;
  }
  const exact = document.getElementById(fragment);
  if (exact !== null) {
    return exact;
  }
  try {
    return document.getElementById(decodeURIComponent(fragment));
  } catch {
    return null;
  }
}

// 本文の中のスクロールはページ内の移動先かフォーカスした要素を見せるために起きるため、今見えている側を展開の後に表示し直す
function revealTargetOf(body: HTMLElement): RevealTarget | null {
  const hashTarget = elementOfLocationHash();
  if (
    hashTarget !== null &&
    body.contains(hashTarget) &&
    isShownWithin(hashTarget, body)
  ) {
    return { element: hashTarget, block: 'start' };
  }
  const focused = document.activeElement;
  if (focused !== null && focused !== body && body.contains(focused)) {
    return { element: focused, block: 'nearest' };
  }
  return null;
}

// 測定の前は高さを知らないため、ページのサーバー側の描画と同じく初めから折りたたみ、あふれると分かった時だけ切替ボタンとぼかしを出す
export function CollapsibleMarkdownContent({
  collapsedHeight,
  fadeClassName,
  ...contentProps
}: CollapsibleMarkdownContentProps) {
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const revealTargetRef = useRef<RevealTarget | null>(null);
  const fit = useContentFit(contentRef, collapsedHeight);
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsed = fit !== 'fits' && !isExpanded;
  const isToggleShown = fit === 'overflows';

  // 初期化の前のページ内の移動やTabキーで本文の中がスクロールした状態は、scrollイベントを受け取れないため初期化の時に確かめる
  useEffect(() => {
    const body = bodyRef.current;
    if (body !== null && body.scrollTop > 0) {
      revealTargetRef.current = revealTargetOf(body);
      setIsExpanded(true);
    }
  }, []);

  useEffect(() => {
    const target = revealTargetRef.current;
    if (!isExpanded || target === null) {
      return;
    }
    revealTargetRef.current = null;
    target.element.scrollIntoView({ block: target.block });
  }, [isExpanded]);

  // 折りたたんだ部分へキーボードでフォーカスが移った時に、フォーカスした要素を切り取って隠さないよう展開する
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (isCollapsed && isHiddenBelow(event.target, event.currentTarget)) {
      setIsExpanded(true);
    }
  };

  // ページ内のリンクの移動先(脚注など)はフォーカスできず、折りたたんだ本文の中だけがスクロールして先頭が隠れるため、展開して移動先を表示し直す
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const body = event.currentTarget;
    if (isCollapsed && body.scrollTop > 0) {
      revealTargetRef.current = revealTargetOf(body);
      setIsExpanded(true);
    }
  };

  return (
    <div data-slot="collapsible-markdown-content">
      <div className="relative">
        <div
          ref={bodyRef}
          id={bodyId}
          data-slot="collapsible-markdown-body"
          className={cn(isCollapsed && 'overflow-hidden')}
          style={isCollapsed ? { maxHeight: collapsedHeight } : undefined}
          onFocus={handleFocus}
          onScroll={handleScroll}
        >
          <div ref={contentRef}>
            <MarkdownContent {...contentProps} />
          </div>
        </div>
        {isToggleShown && isCollapsed && (
          <div
            aria-hidden="true"
            data-slot="collapsible-markdown-fade"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-28 max-h-[60%] bg-linear-to-t from-background to-transparent',
              fadeClassName,
            )}
          />
        )}
      </div>
      {isToggleShown && (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full rounded-full sm:w-auto"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          onClick={() => {
            setIsExpanded((current) => !current);
          }}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('transition-transform', isExpanded && 'rotate-180')}
          />
          {isExpanded ? COLLAPSE_LABEL : READ_MORE_LABEL}
        </Button>
      )}
    </div>
  );
}
