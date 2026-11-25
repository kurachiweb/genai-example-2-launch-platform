import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import {
  refundOutcomeOf,
  type RefundSettlement,
  type TerminationPlans,
} from '../../../lib/workers/sponsorship/refund-settlement.ts';
import type {
  SponsorshipTerminationWriter,
  TerminationCommitResult,
} from '../../application/sponsorship/sponsorship-termination.ts';
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';

type CommitInput = Parameters<SponsorshipTerminationWriter['commit']>[0];

// 強制終了の前進の文だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: sponsorships.state: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const NOT_TERMINABLE_PATTERN =
  /NOT NULL constraint failed: sponsorships\.state(?::|$)/u;

function isNotTerminable(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (NOT_TERMINABLE_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

@injectable()
export class D1TerminationWriter implements SponsorshipTerminationWriter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SPONSORSHIP_PLATFORM_TYPES.RefundSettlement)
    private readonly settlement: RefundSettlement,
  ) {}

  async commit(input: CommitInput): Promise<TerminationCommitResult> {
    const plans = await this.settlement.planTermination(
      input.record,
      input.today,
    );
    try {
      // 同時の強制終了・終了日の経過・退会・プロダクトの論理削除と競合したとき、前進の文の違反が最初の失敗になるよう先頭に置く。
      // 監査ログには条件を付けない。前進の文の後では状態が既にterminatedのため、同じ条件を付けると必ず取り消され、取り消しは前進の文の違反だけで足りる
      await this.db.batch([
        this.terminationStatement(input, plans),
        ...plans.termination.statements,
        ...plans.displayStop.statements,
        ...buildAuditLogStatements(this.db, input.audit),
      ]);
    } catch (error) {
      if (isNotTerminable(error)) {
        return { kind: 'not_terminable' };
      }
      throw error;
    }
    await this.settlement.dispatch([plans.termination, plans.displayStop]);
    return {
      kind: 'committed',
      termination: refundOutcomeOf(plans.termination),
      displayStop: refundOutcomeOf(plans.displayStop),
    };
  }

  // 決済済み・論理削除なし・プロダクトの論理削除なし・終了日が今日以降でなければ、状態をNULLにしてNOT NULLの違反で一括の書き込み全体を取り消す
  private terminationStatement(
    { record, today, reason, at }: CommitInput,
    { termination, displayStop }: TerminationPlans,
  ): BatchItem<'sqlite'> {
    const terminable = and(
      eq(sponsorships.state, 'paid'),
      isNull(sponsorships.deletedAt),
      isNull(sponsorships.productDeletedAt),
      gte(sponsorships.endsOn, today),
    );
    return this.db
      .update(sponsorships)
      .set({
        state: sql<'terminated'>`case when ${terminable} then 'terminated' else null end`,
        terminatedAt: at,
        terminationReason: reason,
        terminationNotice: 'pending',
        terminationRefundStatus: termination.status,
        terminationRefundDays: termination.days,
        terminationRefundAmount: termination.amount,
        terminationRefundRequestId: termination.refundRequestId,
        stopRefundStatus: displayStop.status,
        stopRefundDays: displayStop.days,
        stopRefundAmount: displayStop.amount,
        stopRefundRequestId: displayStop.refundRequestId,
        updatedAt: at,
      })
      .where(eq(sponsorships.id, record.id));
  }
}
