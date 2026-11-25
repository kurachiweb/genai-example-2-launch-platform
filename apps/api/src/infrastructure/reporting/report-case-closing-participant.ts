import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { ModerationWriteParticipation } from '../../application/moderation/ports.ts';
import { readReportCaseClosingPayload } from '../../application/reporting/report-case-closing-participation.ts';
import { REPORTING_TYPES } from '../../application/reporting/reporting-types.ts';
import type {
  ModerationWriteContext,
  ModerationWriteParticipant,
} from '../moderation/moderation-write-participant.ts';
import type { D1ReportCaseStatements } from './d1-report-case-statements.ts';

// 案件を読まずに完了の文だけを返す。完了済みの案件はstatusの前進の文の違反で、物理削除された案件は存在の検査の文の違反で、上流の確定ごと取り消される
@injectable()
export class ReportCaseClosingParticipant implements ModerationWriteParticipant {
  constructor(
    @inject(REPORTING_TYPES.ReportCaseStatements)
    private readonly statements: D1ReportCaseStatements,
  ) {}

  statementsFor(
    participation: ModerationWriteParticipation,
    context: ModerationWriteContext,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    const closing = readReportCaseClosingPayload(participation);
    // 種類と形の誤りは束縛か呼び出し側の誤りで、運用者に知らせるためAppErrorにしない
    if (closing === undefined) {
      return Promise.reject(
        new Error(
          `措置と一体の案件の完了の参加の種類か形が正しくありません: ${JSON.stringify(participation.kind)}`,
        ),
      );
    }
    return Promise.resolve(
      this.statements.forClosing(closing, context.actionId),
    );
  }
}
