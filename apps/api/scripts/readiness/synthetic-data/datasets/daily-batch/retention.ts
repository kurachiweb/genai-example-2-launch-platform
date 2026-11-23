import { guestInquiries } from '../../../../../db/schema/inquiry/guest-inquiries.ts';
import { paymentRecords } from '../../../../../db/schema/payments/payment-records.ts';
import { utcYearsBefore } from '../../../../../lib/core/time/utc-calendar.ts';
import { baseInstantOf, type EntityContext } from '../../entities.ts';
import { deterministicUlid, deterministicUuid } from '../../random.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { auditEntryAt, auditStatements } from '../moderation.ts';
import { DAY_MS, scaledCount } from './scale.ts';

// 日次の削除は500件ずつ最大20回(10,000件)までのため、残りが出るよう500件多くする
const CAPPED_TARGETS = 10_500;

const AUDIT_RETENTION_YEARS = 3;

const PAYMENT_RETENTION_YEARS = 7;

const INQUIRY_RETENTION_DAYS = 14;

const SPREAD_DAYS = 90;

const MARGIN_DAYS = 30;

const DEFAULT_INQUIRY_CATEGORY_ID = '01JC0000000000000000000000';

const yearsBeforeBase = (entities: EntityContext, years: number): number =>
  utcYearsBefore(baseInstantOf(entities.baseDate), years).getTime();

// 古いほうから基準の日時より前の範囲へ並べる。基準の日時は保持期間の境界より、余裕を持って前にする
const spreadAt = (limit: number, index: number, count: number): Date =>
  new Date(
    limit -
      MARGIN_DAYS * DAY_MS -
      Math.floor(((count - 1 - index) * SPREAD_DAYS * DAY_MS) / count),
  );

export function* expiredAuditStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  const count = scaledCount(entities.profile, CAPPED_TARGETS);
  const limit = yearsBeforeBase(entities, AUDIT_RETENTION_YEARS);
  yield* auditStatements(function* () {
    for (let index = 0; index < count; index += 1) {
      yield auditEntryAt(
        entities,
        index,
        spreadAt(limit, index, count),
        `${String(entities.seed)}:expired`,
      );
    }
  });
}

function* inquiryRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, CAPPED_TARGETS);
  const limit =
    baseInstantOf(entities.baseDate).getTime() -
    INQUIRY_RETENTION_DAYS * DAY_MS;
  for (let index = 0; index < count; index += 1) {
    const changedAt = spreadAt(limit, index, count);
    const number = String(index + 1).padStart(6, '0');
    yield {
      id: deterministicUlid(
        changedAt,
        `${String(entities.seed)}:guest-inquiry:${String(index)}`,
      ),
      categoryId: DEFAULT_INQUIRY_CATEGORY_ID,
      nickname: `合成ゲスト${number}`,
      email: `synthetic-inquiry-${number}@readiness.example`,
      body: `合成の問い合わせ${number}: 性能の検証のために自動で作った、対応を終えた未ログインの問い合わせです。`,
      status: index % 2 === 0 ? 'resolved' : 'rejected',
      statusChangedAt: changedAt,
      createdAt: new Date(changedAt.getTime() - DAY_MS),
      updatedAt: changedAt,
    };
  }
}

function* paymentRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, CAPPED_TARGETS);
  const limit = yearsBeforeBase(entities, PAYMENT_RETENTION_YEARS);
  for (let index = 0; index < count; index += 1) {
    const at = spreadAt(limit, index, count);
    const key = `${String(entities.seed)}:payment-record:${String(index)}`;
    yield {
      id: deterministicUlid(at, key),
      pseudonymousId: deterministicUuid(key),
      kind: 'one_time',
      purpose: 'sponsorship',
      status: 'succeeded',
      amount: 800,
      currency: 'usd',
      quantity: 1,
      stripeReference: `ch_synthetic_${String(index + 1).padStart(6, '0')}`,
      occurredAt: at,
      lastEventAt: at,
      recordedAt: at,
      createdAt: at,
      updatedAt: at,
    };
  }
}

export function* retentionStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  yield* expiredAuditStatements(entities);
  yield* insertStatements(guestInquiries, inquiryRows(entities));
  yield* insertStatements(paymentRecords, paymentRows(entities));
}
