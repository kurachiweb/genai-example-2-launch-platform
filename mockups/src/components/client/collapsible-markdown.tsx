import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { Markdown } from '#/components/client/markdown';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';

type Props = {
  markdown: string;
  // これを超える高さは折りたたみ、「続きを読む」で全文を表示する
  collapsedHeight: number;
  externalRel: string;
  size?: 'sm' | 'base';
  // 折りたたみ時に下端を背景色へ溶け込ませるグラデーションの色(配置先の背景色に合わせる)
  fadeClassName?: string;
};

export function CollapsibleMarkdown({
  markdown,
  collapsedHeight,
  externalRel,
  size,
  fadeClassName = 'from-background',
}: Props) {
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > collapsedHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [markdown, collapsedHeight]);

  const collapsed = overflowing && !expanded;

  return (
    <>
      <div className="relative">
        <div
          id={bodyId}
          ref={body}
          className={cn(collapsed && 'overflow-hidden')}
          style={{ maxHeight: collapsed ? collapsedHeight : undefined }}
        >
          <Markdown externalRel={externalRel} size={size}>
            {markdown}
          </Markdown>
        </div>
        {collapsed && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-28 max-h-[60%] bg-linear-to-t to-transparent',
              fadeClassName,
            )}
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
    </>
  );
}
