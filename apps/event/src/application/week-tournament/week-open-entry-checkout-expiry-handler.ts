import { inject, injectable } from 'inversify';

import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';
import type {
  UltrasActivation,
  UltrasActivationHandler,
} from '../../../lib/core/ultras/activation-contract.ts';

const OPEN_CHECKOUT_EXPIRY_LIMIT = 50;

const MAX_EXPIRY_ROUNDS = 5;

// 加入の知らせには続きの再開が無いため、1回の処理で残りが無くなるまで繰り返し、上限で残れば例外で知らせ全体を再試行させる。
// 失効の部品は残りの未完了の決済を毎回選び直すため、再試行・送り直しで同じ知らせを何度処理してもよい
@injectable()
export class WeekOpenEntryCheckoutExpiryHandler implements UltrasActivationHandler {
  constructor(
    @inject(PAYMENTS_TYPES.OpenCheckoutExpirer)
    private readonly expirer: OpenCheckoutExpirer,
  ) {}

  async handle(activation: UltrasActivation): Promise<void> {
    for (let round = 0; round < MAX_EXPIRY_ROUNDS; round += 1) {
      const { remaining } = await this.expirer.expireOpen({
        userId: activation.userId,
        kinds: ['week_tournament_entry'],
        limit: OPEN_CHECKOUT_EXPIRY_LIMIT,
      });
      if (!remaining) {
        return;
      }
    }
    throw new Error(
      `未完了の参加費の決済が${String(MAX_EXPIRY_ROUNDS)}回の失効の後も残っています: activationId=${activation.activationId}`,
    );
  }
}
