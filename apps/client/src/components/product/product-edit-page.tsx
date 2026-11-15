import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientMyProductQuery } from '../../graphql/generated/graphql.ts';
import { myProductQueryOptions } from '../../graphql/my-products.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { editProductLabel } from './my-product-messages.ts';
import { MyProductsSuspendedNotice } from './my-products-suspended-notice.tsx';
import { orderProductSections } from './product-section-order.ts';
import { ProductEditContent } from './product-edit-content.tsx';
import type {
  MyProductSection,
  ProductDeleteNotice,
} from './product-section-types.ts';

export interface ProductEditPageProps {
  readonly viewer: ClientViewer;
  // 編集画面のURLのハンドル
  readonly handle: string;
  // 画面を開いた時点の名称。題名に使う
  readonly productName: string;
  readonly sections: readonly MyProductSection[];
  readonly deleteNotices: readonly ProductDeleteNotice[];
}

interface PageFrameProps {
  readonly headingId: string;
  readonly title: string;
  readonly notice: ReactNode;
  readonly children: ReactNode;
}

// 読み込み中と取得の失敗の間も題名と案内を残すため、題名は内容を包む枠として描く。再試行と最新の内容の読み込みの後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする
function PageFrame({ headingId, title, notice, children }: PageFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-4">
        <h1
          id={headingId}
          tabIndex={-1}
          className="rounded-sm text-2xl font-extrabold tracking-tight wrap-anywhere sm:text-3xl"
        >
          {title}
        </h1>
        {notice}
      </div>
      {children}
    </div>
  );
}

const savedNameOf = ({
  myProduct,
}: ClientMyProductQuery): string | undefined =>
  myProduct?.__typename === 'MyProduct' ? myProduct.name : undefined;

export function ProductEditPage({
  viewer,
  handle,
  productName,
  sections,
  deleteNotices,
}: ProductEditPageProps) {
  const headingId = useId();
  // 保存で名称が変わった後も題名を合わせるため、取得のキャッシュの最新の名称を使う
  const { data: currentName } = useQuery({
    ...myProductQueryOptions(viewer.id, handle),
    select: savedNameOf,
    enabled: false,
  });
  // ルートの文脈の利用者は画面を開いた時点の値のため、取得のキャッシュの最新の値で判定する。停止中の利用者はサーバーが編集と削除を拒否するため、題名の下に理由を示し、全欄と送信と削除を無効にする
  const suspended = (useViewer() ?? viewer).status === 'SUSPENDED';
  const notice = suspended ? <MyProductsSuspendedNotice /> : null;
  const title = editProductLabel(currentName ?? productName);

  return (
    <RecoverableSlot
      className="rounded-sm"
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
      frame={(content) => (
        <PageFrame headingId={headingId} title={title} notice={notice}>
          {content}
        </PageFrame>
      )}
    >
      <PageFrame headingId={headingId} title={title} notice={notice}>
        <ProductEditContent
          viewerId={viewer.id}
          handle={handle}
          disabled={suspended}
          labelledBy={headingId}
          sections={orderProductSections(sections)}
          deleteNotices={orderProductSections(deleteNotices)}
        />
      </PageFrame>
    </RecoverableSlot>
  );
}
