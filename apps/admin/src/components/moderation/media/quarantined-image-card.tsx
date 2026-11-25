import type { ReactNode } from 'react';

import { mediaPurposeLabel } from '../../../../common-lib/moderation/moderation-labels.ts';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import type { PictureDisplay } from '../../../../lib/utilities/media/picture-sources.ts';
import type { AdminQuarantinedImageView } from '../../../graphql/admin-quarantined-images.ts';
import { AdminMediaImage } from '../shared/admin-media-image.tsx';
import {
  NO_FINDINGS_LABEL,
  QUARANTINED_IMAGE_ITEM_LABELS,
  quarantineReasonsText,
} from '../shared/moderation-messages.ts';
import { ImageModerationActions } from './image-moderation-actions.tsx';
import { quarantinedImageOwnerLabel } from './quarantined-image-view.ts';

export interface QuarantinedImageCardProps {
  readonly image: AdminQuarantinedImageView;
}

// 寸法の分からない原本を用途によらず同じ枠に収め、読み込めない時はスクリーンショットと同じ代わりの表示にする
const IMAGE_DISPLAY: PictureDisplay = Object.freeze({
  kind: 'screenshot',
  variant: 'thumb',
});

function DetailItem({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted-foreground sm:w-28">{term}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}

// 隔離画像の1件。続きを読み込んだ後のフォーカスの移り先になるよう、項目をプログラムからだけフォーカスできるようにする
export function QuarantinedImageCard({ image }: QuarantinedImageCardProps) {
  const ownerLabel = quarantinedImageOwnerLabel(image.owner);
  const purposeLabel = mediaPurposeLabel(image.purpose);

  return (
    <li
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:p-5"
    >
      {/* 保有者と用途を隣の項目で示すため、画像は飾りとして名前を付けない */}
      <AdminMediaImage
        file={image.file}
        display={IMAGE_DISPLAY}
        alt=""
        placeholder={{ label: ownerLabel, seed: image.file.id }}
        className="h-auto w-40 shrink-0 self-start rounded-md border border-border bg-muted sm:w-48"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <DetailItem term={QUARANTINED_IMAGE_ITEM_LABELS.purpose}>
            {purposeLabel}
          </DetailItem>
          <DetailItem term={QUARANTINED_IMAGE_ITEM_LABELS.owner}>
            {ownerLabel}
          </DetailItem>
          <DetailItem term={QUARANTINED_IMAGE_ITEM_LABELS.quarantinedAt}>
            <DateTime value={image.quarantinedAt} format="longDateTime" />
          </DetailItem>
          <DetailItem term={QUARANTINED_IMAGE_ITEM_LABELS.reasons}>
            {quarantineReasonsText(image.file.quarantineReasons)}
          </DetailItem>
          <DetailItem term={QUARANTINED_IMAGE_ITEM_LABELS.findings}>
            {image.findings.length === 0 ? (
              NO_FINDINGS_LABEL
            ) : (
              <ul className="flex flex-col gap-1">
                {image.findings.map((finding, index) => (
                  // 同じ検出内容が重なり得るため、並び順を添えて区別する
                  <li key={`${String(index)}:${finding}`}>{finding}</li>
                ))}
              </ul>
            )}
          </DetailItem>
        </dl>
        <ImageModerationActions
          image={image}
          ownerLabel={ownerLabel}
          purposeLabel={purposeLabel}
        />
      </div>
    </li>
  );
}
