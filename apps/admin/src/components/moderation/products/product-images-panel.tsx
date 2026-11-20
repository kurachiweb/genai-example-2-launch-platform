import { useId, useRef } from 'react';

import { Badge } from '../../../../lib/components/ui/badge/badge.tsx';
import type { PictureDisplay } from '../../../../lib/utilities/media/picture-sources.ts';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';
import { QuarantineImageButton } from '../media/quarantine-image-button.tsx';
import { AdminMediaImage } from '../shared/admin-media-image.tsx';
import { ModerationDialogHost } from '../shared/moderation-dialog-host.tsx';
import {
  LOGO_QUARANTINE_NAME,
  NO_VALUE_LABEL,
  PRODUCT_DETAIL_COPY,
  productLogoAlt,
  productScreenshotAlt,
  QUARANTINE_REASONS_LABEL,
  QUARANTINED_IMAGE_MARK,
  quarantineReasonsText,
  screenshotQuarantineName,
} from '../shared/moderation-messages.ts';

export interface ProductImagesPanelProps {
  readonly productName: string;
  // nullは削除済み
  readonly logo: AdminMediaFileView | null;
  readonly screenshots: readonly AdminMediaFileView[];
}

const LOGO_DISPLAY: PictureDisplay = Object.freeze({
  kind: 'square',
  size: 128,
});

const SCREENSHOT_DISPLAY: PictureDisplay = Object.freeze({
  kind: 'screenshot',
  variant: 'thumb',
});

interface ImageStateProps {
  readonly file: AdminMediaFileView | null;
  readonly quarantineName: string;
}

// 隔離理由のある画像には印と理由を、無い画像には個別の隔離の操作を添える
function ImageState({ file, quarantineName }: ImageStateProps) {
  if (file === null) {
    return null;
  }
  if (!file.quarantined) {
    return (
      <QuarantineImageButton file={file} accessibleName={quarantineName} />
    );
  }
  return (
    <div className="flex flex-col items-start gap-1 text-sm">
      <Badge variant="destructive">{QUARANTINED_IMAGE_MARK}</Badge>
      <dl className="flex flex-wrap gap-x-2">
        <dt className="text-muted-foreground">{QUARANTINE_REASONS_LABEL}</dt>
        <dd>{quarantineReasonsText(file.quarantineReasons)}</dd>
      </dl>
    </div>
  );
}

// ロゴとスクリーンショットを、隔離中のものも含めて管理者側のサイトと同じオリジンから表示する
export function ProductImagesPanel({
  productName,
  logo,
  screenshots,
}: ProductImagesPanelProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-extrabold"
      >
        {PRODUCT_DETAIL_COPY.sections.images}
      </h2>
      {/* 取り直しでプロダクトごと消えると詳細のページが見つからない表示に替わり、ダイアログも外れるため、不在の失敗の取り直しを閉じるまで遅らせる */}
      <ModerationDialogHost
        fallbackFocusRef={headingRef}
        deferTargetMissingRefresh
      >
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">
            {PRODUCT_DETAIL_COPY.items.logo}
          </h3>
          <div className="flex flex-wrap items-start gap-3">
            <AdminMediaImage
              file={logo}
              display={LOGO_DISPLAY}
              alt={productLogoAlt(productName)}
              placeholder={{
                label: productName,
                seed: logo?.id ?? productName,
              }}
              className="rounded-md border border-border"
            />
            <ImageState file={logo} quarantineName={LOGO_QUARANTINE_NAME} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">
            {PRODUCT_DETAIL_COPY.items.screenshots}
          </h3>
          {screenshots.length === 0 ? (
            <p className="text-sm">{NO_VALUE_LABEL}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {screenshots.map((file, index) => (
                <li key={file.id} className="flex flex-col items-start gap-2">
                  <AdminMediaImage
                    file={file}
                    display={SCREENSHOT_DISPLAY}
                    alt={productScreenshotAlt(productName, index + 1)}
                    placeholder={{ label: productName, seed: file.id }}
                    className="h-auto max-w-full rounded-md border border-border"
                  />
                  <ImageState
                    file={file}
                    quarantineName={screenshotQuarantineName(index + 1)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModerationDialogHost>
    </section>
  );
}
