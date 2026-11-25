import { emailSendRecords } from '../../../../../db/schema/email/email-send-records.ts';
import { emailSuppressions } from '../../../../../db/schema/email/email-suppressions.ts';
import { dataExports } from '../../../../../db/schema/data-export/data-exports.ts';
import { sponsorshipDisplayStops } from '../../../../../db/schema/sponsorship/sponsorship-display-stops.ts';
import { sponsorships } from '../../../../../db/schema/sponsorship/sponsorships.ts';
import {
  addBusinessDays,
  parseBusinessDate,
} from '../../../../../lib/core/time/business-time.ts';
import {
  baseInstantOf,
  productAt,
  userAt,
  type EntityContext,
} from '../../entities.ts';
import { deterministicUlid } from '../../random.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { MEDIA_KEY_PREFIX } from './media-files.ts';
import { DAY_MS, HOUR_MS, scaledCount } from './scale.ts';

const SEND_RECORDS = 10_500;

// 利用者に紐づかない抑止記録の削除は90件×20ページ(1,800件)までのため、残りが出る件数にする
const UNLINKED_SUPPRESSIONS = 2_000;

const EXPIRED_SUPPRESSIONS = 2_000;

const UNPAID_SPONSORSHIPS = 10_500;

// 表示停止の区間の削除は1回500件まで
const DISPLAY_STOPS = 600;

// ZIPの期限切れは100件×10回(1,000件)まで
const EXPIRED_EXPORTS = 1_100;

const SEND_RECORD_RETENTION_DAYS = 14;

const UNLINKED_RETENTION_DAYS = 365;

const DISPLAY_STOP_RETENTION_DAYS = 400;

const baseOf = (entities: EntityContext): number =>
  baseInstantOf(entities.baseDate).getTime();

const numberOf = (index: number): string => String(index + 1).padStart(6, '0');

const idOf = (
  entities: EntityContext,
  kind: string,
  index: number,
  at: Date,
): string =>
  deterministicUlid(at, `${String(entities.seed)}:${kind}:${String(index)}`);

function* sendRecordRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, SEND_RECORDS);
  for (let index = 0; index < count; index += 1) {
    const sentAt = new Date(
      baseOf(entities) -
        (SEND_RECORD_RETENTION_DAYS + 3 + (index % 30)) * DAY_MS,
    );
    yield {
      id: idOf(entities, 'send-record', index, sentAt),
      kind: 'synthetic-readiness',
      idempotencyKey: `synthetic-readiness-${numberOf(index)}`,
      sentAt,
      createdAt: sentAt,
      updatedAt: sentAt,
    };
  }
}

function* suppressionRows(entities: EntityContext): Generator<SqlRow> {
  const base = baseOf(entities);
  const expired = scaledCount(entities.profile, EXPIRED_SUPPRESSIONS);
  for (let index = 0; index < expired; index += 1) {
    const lastEventAt = new Date(base - 8 * DAY_MS);
    yield {
      id: idOf(entities, 'suppression-expired', index, lastEventAt),
      address: `synthetic-rejected-${numberOf(index)}@readiness.example`,
      lastReason: 'rejected',
      lastEventAt,
      expiresAt: new Date(base - DAY_MS),
      createdAt: lastEventAt,
      updatedAt: lastEventAt,
    };
  }
  const unlinked = scaledCount(entities.profile, UNLINKED_SUPPRESSIONS);
  for (let index = 0; index < unlinked; index += 1) {
    const lastEventAt = new Date(
      base - (UNLINKED_RETENTION_DAYS + 30 + (index % 60)) * DAY_MS,
    );
    yield {
      id: idOf(entities, 'suppression-unlinked', index, lastEventAt),
      address: `synthetic-bounce-${numberOf(index)}@readiness.example`,
      lastReason: 'hard_bounce',
      lastEventAt,
      createdAt: lastEventAt,
      updatedAt: lastEventAt,
    };
  }
}

function* unpaidSponsorshipRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, UNPAID_SPONSORSHIPS);
  const base = parseBusinessDate(entities.baseDate);
  const startsOn = addBusinessDays(base, -10);
  const endsOn = addBusinessDays(base, -3);
  const days = 8;
  for (let index = 0; index < count; index += 1) {
    const product = productAt(entities, index % entities.profile.products);
    const createdAt = new Date(
      baseOf(entities) - 11 * DAY_MS + (index % 1_000),
    );
    yield {
      id: idOf(entities, 'unpaid-sponsorship', index, createdAt),
      userId: product.ownerId,
      productId: product.id,
      tier: 'silver',
      startsOn,
      endsOn,
      days,
      state: 'pending_payment',
      createdAt,
      updatedAt: createdAt,
    };
  }
}

function* displayStopRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, DISPLAY_STOPS);
  const base = baseOf(entities);
  for (let index = 0; index < count; index += 1) {
    const startedAt = new Date(
      base - (DISPLAY_STOP_RETENTION_DAYS + 100) * DAY_MS,
    );
    yield {
      id: idOf(entities, 'display-stop', index, startedAt),
      subjectKind: 'product',
      subjectId: productAt(entities, index % entities.profile.products).id,
      startedAt,
      endedAt: new Date(base - (DISPLAY_STOP_RETENTION_DAYS + 50) * DAY_MS),
      createdAt: startedAt,
      updatedAt: startedAt,
    };
  }
}

function* exportRows(entities: EntityContext): Generator<SqlRow> {
  const base = baseOf(entities);
  const { users } = entities.profile;
  const expired = scaledCount(entities.profile, EXPIRED_EXPORTS);
  for (let index = 0; index < expired; index += 1) {
    const requestedAt = new Date(base - 10 * DAY_MS);
    yield {
      id: idOf(entities, 'export-expired', index, requestedAt),
      userId: userAt(entities, index % users).id,
      status: 'ready',
      requestedAt,
      objectKey: `${MEDIA_KEY_PREFIX}export/${numberOf(index)}.zip`,
      fileName: `synthetic-export-${numberOf(index)}.zip`,
      byteSize: 1_024,
      completedAt: new Date(requestedAt.getTime() + HOUR_MS),
      expiresAt: new Date(base - 3 * DAY_MS),
      createdAt: requestedAt,
      updatedAt: requestedAt,
    };
  }
}

export function* databaseOnlyStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  yield* insertStatements(emailSendRecords, sendRecordRows(entities));
  yield* insertStatements(emailSuppressions, suppressionRows(entities));
  yield* insertStatements(sponsorships, unpaidSponsorshipRows(entities));
  yield* insertStatements(sponsorshipDisplayStops, displayStopRows(entities));
  yield* insertStatements(dataExports, exportRows(entities));
}
