import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ultrasOfferQueryOptions } from '../../graphql/ultras.ts';

export interface UltrasPromotionGateProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

// 有料プランへの導線を、新規の加入を受け付けているときだけ描く。読み込み中と取得の失敗では子もfallbackも描かず、導線を出し過ぎない側に倒す
export function UltrasPromotionGate({
  children,
  fallback,
}: UltrasPromotionGateProps) {
  const { data } = useQuery(ultrasOfferQueryOptions());
  if (data === undefined) {
    return null;
  }
  return data.ultrasOffer.promotionEnabled ? children : (fallback ?? null);
}
