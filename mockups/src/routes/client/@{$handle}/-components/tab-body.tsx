import { useEffect, useState } from 'react';

import type { ProfileTab } from '../-model/options';
import { ProductCardSkeletons } from './product-card-skeletons';
import { TabError } from './tab-error';
import { UpvoteSkeletons } from './upvote-skeletons';

type Props = {
  tab: ProfileTab;
  // タブ切り替え後の読み込み中
  loading: boolean;
  // failingがtrueの間はタブの内容の取得を毎回失敗させる(部分的な読み込みエラーの確認用)
  failing: boolean;
  children: React.ReactNode;
};

const RETRY_LATENCY_MS = 600;
const SKELETON_ITEMS: Record<ProfileTab, number> = { launches: 3, upvotes: 6 };
const ERROR_TITLES: Record<ProfileTab, string> = {
  launches: 'ローンチしたプロダクトを読み込めませんでした。',
  upvotes: 'Upvote履歴を読み込めませんでした。',
};

// ヘッダーと自己紹介を保ったまま、タブの内容部分だけ読み込み中・取得エラーを示す
export function TabBody({ tab, loading, failing, children }: Props) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => setRetrying(false), RETRY_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [retrying]);

  if (loading || retrying) {
    return (
      <div role="status" aria-busy="true" aria-label="読み込み中">
        {tab === 'launches' ? (
          <ProductCardSkeletons count={SKELETON_ITEMS.launches} />
        ) : (
          <UpvoteSkeletons count={SKELETON_ITEMS.upvotes} />
        )}
      </div>
    );
  }
  if (failing) {
    return (
      <TabError title={ERROR_TITLES[tab]} onRetry={() => setRetrying(true)} />
    );
  }
  return children;
}
