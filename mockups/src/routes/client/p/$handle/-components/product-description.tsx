import { FileTextIcon } from 'lucide-react';

import { CollapsibleMarkdown } from '#/components/client/collapsible-markdown';

import { SectionTitle } from './section-title';

type Props = { markdown: string };

// これを超える高さの説明文は折りたたみ、マッチ履歴やコメントまでのスクロール量を抑える
const COLLAPSED_HEIGHT_PX = 480;

export function ProductDescription({ markdown }: Props) {
  return (
    <section aria-labelledby="description-heading">
      <SectionTitle id="description-heading" icon={FileTextIcon} title="説明" />
      <div className="mt-4">
        <CollapsibleMarkdown
          markdown={markdown}
          collapsedHeight={COLLAPSED_HEIGHT_PX}
          externalRel="noopener"
        />
      </div>
    </section>
  );
}
