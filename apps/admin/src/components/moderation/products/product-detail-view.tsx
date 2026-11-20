import { ExternalLinkIcon } from 'lucide-react';
import { useId } from 'react';

import { checkExternalUrl } from '../../../../common-lib/url/external-url.ts';
import { MarkdownContent } from '../../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../../lib/components/markdown/use-rendered-markdown.ts';
import type { AdminModerationProductDetailView } from '../../../graphql/admin-moderation-products.ts';
import { ModerationNote } from '../shared/moderation-note.tsx';
import {
  NEW_TAB_NOTICE,
  PRODUCT_DETAIL_COPY,
  PRODUCT_VISIBILITY_LABELS,
  productOwnerLabel,
  UNREADABLE_USER_LABEL,
} from '../shared/moderation-messages.ts';
import { ProductImagesPanel } from './product-images-panel.tsx';
import { ProductLaunchesPanel } from './product-launches-panel.tsx';
import { ProductRatingsPanel } from './product-ratings-panel.tsx';
import { ProductVisibilityActions } from './product-visibility-actions.tsx';

export interface ProductDetailViewProps {
  readonly detail: AdminModerationProductDetailView;
}

const SECTION_CLASS_NAME =
  'flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6';

const HEADING_CLASS_NAME = 'text-lg font-extrabold';

const TERM_CLASS_NAME = 'text-muted-foreground';

const ITEMS_CLASS_NAME =
  'grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]';

// 管理者側では利用者側のプロダクト詳細と同じく、投票で勝ち上がったプロダクトの説明文としてugcを付けない
const DESCRIPTION_LINK_REL = Object.freeze(['noopener'] as const);

// 外部WebサイトURLは管理者の閲覧の参照元をプロダクトの運営者へ渡さない
const WEBSITE_LINK_REL = 'noopener noreferrer';

function WebsiteLink({ url }: { readonly url: string }) {
  // 保存時の検証を通った値だけが入る前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
  if (checkExternalUrl(url) !== 'ok') {
    return <span className="wrap-anywhere">{url}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel={WEBSITE_LINK_REL}
      className="inline-flex items-center gap-1 wrap-anywhere text-primary underline underline-offset-2"
    >
      {url}
      <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{NEW_TAB_NOTICE}</span>
    </a>
  );
}

// プロダクトの詳細の公開状態・情報・画像・評価・ローンチ履歴を順に並べる
export function ProductDetailView({ detail }: ProductDetailViewProps) {
  const { product } = detail;
  const visibilityHeadingId = useId();
  const informationHeadingId = useId();
  const options = useMarkdownOptions({
    externalLinkRel: DESCRIPTION_LINK_REL,
    idScope: 'product',
  });
  const description = useRenderedMarkdown(detail.descriptionMarkdown, options);

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby={visibilityHeadingId}
        className={SECTION_CLASS_NAME}
      >
        <h2 id={visibilityHeadingId} className={HEADING_CLASS_NAME}>
          {PRODUCT_DETAIL_COPY.sections.visibility}
        </h2>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-bold">
              {PRODUCT_VISIBILITY_LABELS[product.visibility]}
            </p>
            {product.visibility === 'hidden' ? (
              <ModerationNote
                dateLabel={PRODUCT_DETAIL_COPY.items.hiddenAt}
                occurredAt={detail.hiddenAt}
                note={detail.latestHide}
              />
            ) : null}
          </div>
          <ProductVisibilityActions product={product} />
        </div>
      </section>
      <section
        aria-labelledby={informationHeadingId}
        className={SECTION_CLASS_NAME}
      >
        <h2 id={informationHeadingId} className={HEADING_CLASS_NAME}>
          {PRODUCT_DETAIL_COPY.sections.information}
        </h2>
        <dl className={ITEMS_CLASS_NAME}>
          <dt className={TERM_CLASS_NAME}>
            {PRODUCT_DETAIL_COPY.items.tagline}
          </dt>
          <dd className="wrap-anywhere">{detail.tagline}</dd>
          <dt className={TERM_CLASS_NAME}>
            {PRODUCT_DETAIL_COPY.items.category}
          </dt>
          <dd>{product.category.name}</dd>
          <dt className={TERM_CLASS_NAME}>
            {PRODUCT_DETAIL_COPY.items.handle}
          </dt>
          <dd className="wrap-anywhere">{product.handle}</dd>
          <dt className={TERM_CLASS_NAME}>
            {PRODUCT_DETAIL_COPY.items.websiteUrl}
          </dt>
          <dd>
            <WebsiteLink url={detail.websiteUrl} />
          </dd>
          <dt className={TERM_CLASS_NAME}>{PRODUCT_DETAIL_COPY.items.owner}</dt>
          <dd className="wrap-anywhere">
            {product.owner === null
              ? UNREADABLE_USER_LABEL
              : productOwnerLabel(product.owner.nickname, product.owner.handle)}
          </dd>
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">
            {PRODUCT_DETAIL_COPY.items.description}
          </h3>
          <MarkdownContent
            rendered={description}
            size="sm"
            className="rounded-md border border-border p-4"
          />
        </div>
      </section>
      <ProductImagesPanel
        productName={product.name}
        logo={product.logo}
        screenshots={detail.screenshots}
      />
      <ProductRatingsPanel
        productId={product.id}
        summary={detail.ratingSummary}
      />
      <ProductLaunchesPanel launches={detail.launches} />
    </div>
  );
}
