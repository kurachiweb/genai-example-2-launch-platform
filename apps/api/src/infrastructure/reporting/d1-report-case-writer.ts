import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  CaseClosing,
  ReportCaseInquiryRecord,
  ReportCaseStatusChange,
  ReportCaseWriter,
} from '../../application/reporting/ports.ts';
import { REPORTING_TYPES } from '../../application/reporting/reporting-types.ts';
import type {
  D1ReportCaseStatements,
  ReportCaseBatch,
} from './d1-report-case-statements.ts';

type ReportCaseViolation = 'conflict' | 'not-found' | 'open-case-exists';

// D1は`D1_ERROR: <違反>: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ。文の組み立ての失敗はDrizzleQueryErrorが包む
const VIOLATION_PATTERNS: readonly (readonly [ReportCaseViolation, RegExp])[] =
  [
    // statusのCASE式の前進の文が、変更前の状態の不一致でNULLを入れる
    ['conflict', /NOT NULL constraint failed: report_cases\.status(?::|$)/u],
    // 先頭の存在の検査の文が、案件の行が無いときだけNULLを入れる
    [
      'not-found',
      /NOT NULL constraint failed: report_cases\.target_kind(?::|$)/u,
    ],
    // 未完了の案件を対象ごとに1つにする部分一意索引
    [
      'open-case-exists',
      /UNIQUE constraint failed: report_cases\.target_kind, report_cases\.target_id(?::|$)/u,
    ],
  ];

function violationOf(error: unknown): ReportCaseViolation | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    for (const [violation, pattern] of VIOLATION_PATTERNS) {
      if (pattern.test(current.message)) {
        return violation;
      }
    }
  }
  return undefined;
}

@injectable()
export class D1ReportCaseWriter implements ReportCaseWriter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(REPORTING_TYPES.ReportCaseStatements)
    private readonly statements: D1ReportCaseStatements,
  ) {}

  async changeStatus(
    input: ReportCaseStatusChange,
  ): Promise<'committed' | 'conflict' | 'open-case-exists' | 'not-found'> {
    return this.#commit(this.statements.forStatusChange(input), [
      'conflict',
      'not-found',
      'open-case-exists',
    ]);
  }

  async close(
    input: CaseClosing,
  ): Promise<'committed' | 'conflict' | 'not-found'> {
    return this.#commit(this.statements.forClosing(input, null), [
      'conflict',
      'not-found',
    ]);
  }

  async recordInquiry(
    input: ReportCaseInquiryRecord,
  ): Promise<'committed' | 'conflict' | 'not-found'> {
    return this.#commit(this.statements.forInquiry(input), [
      'conflict',
      'not-found',
    ]);
  }

  async #commit<TViolation extends ReportCaseViolation>(
    statements: ReportCaseBatch,
    expected: readonly TViolation[],
  ): Promise<'committed' | TViolation> {
    try {
      await this.db.batch(statements);
      return 'committed';
    } catch (error) {
      const violation = violationOf(error);
      if (
        violation !== undefined &&
        (expected as readonly ReportCaseViolation[]).includes(violation)
      ) {
        return violation as TViolation;
      }
      throw error;
    }
  }
}
