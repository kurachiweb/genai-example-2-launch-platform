import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, FileTextIcon } from 'lucide-react';

import { Markdown } from '#/components/client/markdown';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';

import { SectionTitle } from './section-title';

type Props = { markdown: string };

// これを超える高さの説明文は折りたたみ、マッチ履歴やコメントまでのスクロール量を抑える
const COLLAPSED_HEIGHT_PX = 480;

export function ProductDescription({ markdown }: Props) {
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > COLLAPSED_HEIGHT_PX + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [markdown]);

  const collapsed = overflowing && !expanded;

  return (
    <section aria-labelledby="description-heading">
      <SectionTitle id="description-heading" icon={FileTextIcon} title="説明" />
      <div className="relative mt-4">
        <div
          id={bodyId}
          ref={body}
          className={cn(collapsed && 'overflow-hidden')}
          style={{ maxHeight: collapsed ? COLLAPSED_HEIGHT_PX : undefined }}
        >
          <Markdown externalRel="noopener">{markdown}</Markdown>
        </div>
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-background to-transparent"
          />
        )}
      </div>
      {overflowing && (
        <Button
          variant="outline"
          className="mt-3 w-full rounded-full sm:w-auto"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('transition-transform', expanded && 'rotate-180')}
          />
          {expanded ? '折りたたむ' : '続きを読む'}
        </Button>
      )}
    </section>
  );
}
