import { type ReactNode, useId } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { MyProductsSuspendedNotice } from './my-products-suspended-notice.tsx';
import { ProductEmailVerificationNotice } from './product-email-verification-notice.tsx';
import { PRODUCT_REGISTER_PAGE_TITLE } from './product-form-messages.ts';
import { ProductRegistrationContent } from './product-registration-content.tsx';

export interface ProductRegistrationPageProps {
  readonly viewer: ClientViewer;
}

interface PageFrameProps {
  readonly headingId: string;
  readonly notice: ReactNode;
  readonly children: ReactNode;
}

// 読み込み中と取得の失敗の間も題名と案内を残すため、題名は内容を包む枠として描く。再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする
function PageFrame({ headingId, notice, children }: PageFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-4">
        <h1
          id={headingId}
          tabIndex={-1}
          className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
        >
          {PRODUCT_REGISTER_PAGE_TITLE}
        </h1>
        {notice}
      </div>
      {children}
    </div>
  );
}

// 停止中の利用者とメールアドレスの確認が済んでいない利用者はサーバーが登録を拒否するため、題名の下に理由を示し、全欄と送信を無効にする
const noticeOf = (viewer: ClientViewer): ReactNode => {
  if (viewer.status === 'SUSPENDED') {
    return <MyProductsSuspendedNotice />;
  }
  return viewer.emailVerified ? null : <ProductEmailVerificationNotice />;
};

export function ProductRegistrationPage({
  viewer,
}: ProductRegistrationPageProps) {
  const headingId = useId();
  // ルートの文脈の利用者は画面を開いた時点の値のため、確認メールの再送で確認済みと分かって取り直した後も案内と無効が残らないよう、取得のキャッシュの最新の値で判定する
  const notice = noticeOf(useViewer() ?? viewer);

  return (
    <RecoverableSlot
      className="rounded-sm"
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
      frame={(content) => (
        <PageFrame headingId={headingId} notice={notice}>
          {content}
        </PageFrame>
      )}
    >
      <PageFrame headingId={headingId} notice={notice}>
        <ProductRegistrationContent
          viewerId={viewer.id}
          disabled={notice !== null}
          labelledBy={headingId}
        />
      </PageFrame>
    </RecoverableSlot>
  );
}
