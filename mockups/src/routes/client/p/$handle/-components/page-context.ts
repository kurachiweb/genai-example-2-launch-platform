import { createContext, useContext } from 'react';

import type { LoginPurpose } from '#/components/client/login-dialog';
import type { ReportTarget } from '#/components/client/report-dialog';
import type { User } from '#/lib/mock-data';

import type { ProductSearch } from '../-model/options';
import type { ViewerRole } from '../-model/page-model';

export type PageContextValue = {
  role: ViewerRole;
  viewer: User | null;
  maker: User;
  // モックの現在時刻
  now: Date;
  imagesBroken: boolean;
  partial: ProductSearch['partial'];
  // 自分の5段階評価。評価カードとコメント投稿欄で共有する
  myRating: number | null;
  setMyRating: (value: number | null) => void;
  requireLogin: (purpose: LoginPurpose) => void;
  openReport: (target: ReportTarget) => void;
};

export const PageContext = createContext<PageContextValue | null>(null);

export function usePageContext(): PageContextValue {
  const value = useContext(PageContext);
  if (!value) throw new Error('PageContextの外で使用されています');
  return value;
}
