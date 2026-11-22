import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { REPORTING_PLATFORM_TYPES } from '../../../lib/core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../../lib/core/reporting/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export const PRODUCT_REPORT_ERASURE_BATCH_SIZE = 500;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 申出者の通報と理由は対象が無くなっても運営の判断の記録として残すため、案件と通報を消さずに対象への参照だけを消す。
// 参照の残る案件だけを毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class ProductReportErasureHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(REPORTING_PLATFORM_TYPES.ReportErasureStore)
    private readonly store: ReportErasureStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { remaining } = await this.store.detachCasesByProduct(
      event.productId,
      this.clock.now(),
      PRODUCT_REPORT_ERASURE_BATCH_SIZE,
    );
    return remaining ? CONTINUE : DONE;
  }
}
