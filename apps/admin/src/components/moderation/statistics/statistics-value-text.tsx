import {
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../../../common-lib/payments/money.ts';
import { NumberText } from '../../../../lib/components/datetime/number-text.tsx';
import { STATISTICS_ZERO_DELTA_SIGN } from './statistics-messages.ts';
import type { StatisticsMetricKey } from './statistics-series.ts';

export interface StatisticsValueTextProps {
  readonly metric: StatisticsMetricKey;
  // 合計収益は最小通貨単位(セント)、他は件数
  readonly value: number;
  // 前週からの増減として、正に「+」、0に「±」を付ける
  readonly signed?: boolean;
}

// 共通の金額の表示部品は小数点以下を常に2桁で示すため、デザイン原則の「小数点以下が全て0なら省く」金額を自分で整える
const MONEY_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  style: 'currency',
  currency: PAYMENT_DISPLAY_CURRENCY,
  trailingZeroDisplay: 'stripIfInteger',
});

const formatOf = (
  metric: StatisticsMetricKey,
  signed: boolean,
): Intl.NumberFormatOptions | undefined => {
  const base = metric === 'netRevenue' ? MONEY_FORMAT : undefined;
  return signed ? { ...base, signDisplay: 'exceptZero' } : base;
};

export function StatisticsValueText({
  metric,
  value,
  signed = false,
}: StatisticsValueTextProps) {
  const displayValue =
    metric === 'netRevenue' ? value / MINOR_UNITS_PER_DOLLAR : value;
  return (
    <>
      {signed && value === 0 ? STATISTICS_ZERO_DELTA_SIGN : null}
      <NumberText value={displayValue} options={formatOf(metric, signed)} />
    </>
  );
}
