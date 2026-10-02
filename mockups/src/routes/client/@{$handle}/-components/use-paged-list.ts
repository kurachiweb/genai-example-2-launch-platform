import { useEffect, useState } from 'react';

// 各タブの一覧は「さらに読み込む」で20件ずつ取得する(カーソルベース)
export const PAGE_SIZE = 20;
const MOCK_LATENCY_MS = 700;

export type PagedList = {
  visible: number;
  total: number;
  loading: boolean;
  failed: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

// failingがtrueの間は続きの読み込みを毎回失敗させる(部分的な読み込みエラーの確認用)
export function usePagedList(total: number, failing: boolean): PagedList {
  const [visible, setVisible] = useState(Math.min(PAGE_SIZE, total));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => {
      setLoading(false);
      if (failing) {
        setFailed(true);
        return;
      }
      setVisible((current) => Math.min(total, current + PAGE_SIZE));
    }, MOCK_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [loading, failing, total]);

  return {
    visible,
    total,
    loading,
    failed,
    hasMore: visible < total,
    loadMore: () => {
      setFailed(false);
      setLoading(true);
    },
  };
}
