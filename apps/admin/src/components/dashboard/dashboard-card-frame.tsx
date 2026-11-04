import { type ReactNode, useId } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';

// 取得の状態。TanStack Queryの`status`と同じ名前にし、カードは`useQuery`の結果から組み立てる
export type DashboardCardState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly retry: () => void;
    }
  | { readonly status: 'success' };

export interface DashboardCardFrameProps {
  readonly title: string;
  // 詳しい一覧のページ。指定すると題名をリンクにする
  readonly href?: string;
  readonly state: DashboardCardState;
  readonly children: ReactNode;
}

// 管理者側には問い合わせの画面が無いため、失敗の表示に問い合わせの導線を渡さない
export function DashboardCardFrame({
  title,
  href,
  state,
  children,
}: DashboardCardFrameProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <h2 id={headingId} className="text-lg font-bold wrap-anywhere">
        {href === undefined ? (
          title
        ) : (
          <PathLink
            href={href}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {title}
          </PathLink>
        )}
      </h2>
      {state.status === 'pending' ? <LoadingSkeleton /> : null}
      {state.status === 'error' ? (
        <ErrorState
          message={errorMessageOf(state.error, ADMIN_PROFILE.contactAvailable)}
          onRetry={state.retry}
        />
      ) : null}
      {state.status === 'success' ? children : null}
    </section>
  );
}
