import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import {
  ULTRAS_MONTHLY_PRICE_PREFIX,
  ULTRAS_MONTHLY_PRICE_SUFFIX,
  ULTRAS_PRICE_UNAVAILABLE_MESSAGE,
} from './ultras-messages.ts';

export interface UltrasPriceLineProps {
  readonly amount: MinorUnitAmount | null;
  readonly unavailableReasonId: string;
}

const PRICE_CLASS_NAME = 'text-xl font-bold';

// 価格を照会できないときの文言は、加入のボタンがaria-describedbyで理由として結び付けるためidを持つ
export function UltrasPriceLine({
  amount,
  unavailableReasonId,
}: UltrasPriceLineProps) {
  if (amount === null) {
    return (
      <p id={unavailableReasonId} className={PRICE_CLASS_NAME}>
        {ULTRAS_PRICE_UNAVAILABLE_MESSAGE}
      </p>
    );
  }
  return (
    <p className={PRICE_CLASS_NAME}>
      {ULTRAS_MONTHLY_PRICE_PREFIX}
      <MoneyText amount={amount} />
      {ULTRAS_MONTHLY_PRICE_SUFFIX}
    </p>
  );
}
