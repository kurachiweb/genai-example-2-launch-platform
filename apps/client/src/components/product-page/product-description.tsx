import { FileTextIcon } from 'lucide-react';

import { CollapsibleMarkdownContent } from '../../../lib/components/markdown/collapsible-markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { SectionHeading } from '../layout/section-heading.tsx';
import { DESCRIPTION_HEADING } from './product-description-messages.ts';

export interface ProductDescriptionProps {
  readonly markdown: string;
}

const HEADING_ID = 'description-heading';

// これを超える高さの説明文は折りたたみ、マッチ履歴やコメントまでのスクロール量を抑える
const COLLAPSED_HEIGHT_PX = 480;

export function ProductDescription({ markdown }: ProductDescriptionProps) {
  // 詳細ページは投票で勝ち上がったプロダクトか、本人だけが見る未掲載のプロダクトのため、ugcを付けない
  const options = useMarkdownOptions({
    externalLinkRel: ['noopener'],
    idScope: 'product',
  });
  const rendered = useRenderedMarkdown(markdown, options);

  return (
    <section aria-labelledby={HEADING_ID}>
      <SectionHeading
        id={HEADING_ID}
        icon={
          <FileTextIcon aria-hidden="true" className="size-5 text-primary" />
        }
        title={DESCRIPTION_HEADING}
      />
      <div className="mt-4">
        <CollapsibleMarkdownContent
          rendered={rendered}
          collapsedHeight={COLLAPSED_HEIGHT_PX}
        />
      </div>
    </section>
  );
}
