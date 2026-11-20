import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  moderatedUserIdOf,
  moderationIdOf,
  OPERATOR_ADMIN_ID,
  T0,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { DefaultAdminCommentReader } from '../application/moderation/admin-comment-reader.ts';
import { DefaultAdminProductReader } from '../application/moderation/admin-product-reader.ts';
import { DefaultAdminRatingReader } from '../application/moderation/admin-rating-reader.ts';
import { DefaultAdminUserReader } from '../application/moderation/admin-user-reader.ts';
import { DefaultAdministrativeWithdrawalService } from '../application/moderation/administrative-withdrawal-service.ts';
import { DefaultCommentModerationService } from '../application/moderation/comment-moderation-service.ts';
import { DefaultImageModerationService } from '../application/moderation/image-moderation-service.ts';
import {
  MODERATION_MAINTENANCE_JOB_DEFINITION,
  ModerationMaintenanceJob,
} from '../application/moderation/jobs/moderation-maintenance-job.ts';
import {
  WEEKLY_STATISTICS_JOB_DEFINITION,
  WeeklyStatisticsJob,
} from '../application/moderation/jobs/weekly-statistics-job.ts';
import { EmailModerationNotifier } from '../application/moderation/moderation-notifier.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModeration,
  type PendingModerationRecord,
} from '../application/moderation/pending-moderation-record.ts';
import { DefaultProductModerationService } from '../application/moderation/product-moderation-service.ts';
import { DefaultQuarantinedImageReader } from '../application/moderation/quarantined-image-reader.ts';
import { DefaultRatingModerationService } from '../application/moderation/rating-moderation-service.ts';
import { DefaultUserModerationService } from '../application/moderation/user-moderation-service.ts';
import { DefaultWeeklyStatisticsReader } from '../application/moderation/weekly-statistics-reader.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ControlEngagementModerationWriter } from '../infrastructure/moderation/control-engagement-moderation-writer.ts';
import { ControlImageModerationWriter } from '../infrastructure/moderation/control-image-moderation-writer.ts';
import { D1ModerationStatements } from '../infrastructure/moderation/d1-moderation-statements.ts';
import { D1WeeklyStatisticsStore } from '../infrastructure/moderation/d1-weekly-statistics-store.ts';
import type { ModerationWriteParticipants } from '../infrastructure/moderation/moderation-write-participant.ts';
import { ProductModerationRecordSyncHandler } from '../infrastructure/moderation/product-moderation-record-sync-handler.ts';
import { SentryModerationIncidentReporter } from '../infrastructure/moderation/sentry-moderation-incident-reporter.ts';
import {
  auditOf,
  PSEUDONYMOUS_ID,
} from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { UserModerationRecordSyncHandler } from '../infrastructure/moderation/user-moderation-record-sync-handler.ts';
import { ENGAGEMENT_MODULE } from './engagement-module.ts';
import { MODERATION_MODULE } from './moderation-module.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const DAILY_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

// 参加者の解決の部品はクラスでなく登録から組み立てた値のため、解決を別のテストで確かめる
const IDENTIFIERS_OUTSIDE_IMPLEMENTATIONS: readonly string[] = [
  'ModerationWriteParticipants',
];

const IMPLEMENTATIONS = [
  ['UserModerationService', DefaultUserModerationService],
  ['AdministrativeWithdrawalService', DefaultAdministrativeWithdrawalService],
  ['ProductModerationService', DefaultProductModerationService],
  ['CommentModerationService', DefaultCommentModerationService],
  ['RatingModerationService', DefaultRatingModerationService],
  ['ImageModerationService', DefaultImageModerationService],
  ['ModerationNotifier', EmailModerationNotifier],
  ['AdminUserReader', DefaultAdminUserReader],
  ['AdminProductReader', DefaultAdminProductReader],
  ['AdminCommentReader', DefaultAdminCommentReader],
  ['AdminRatingReader', DefaultAdminRatingReader],
  ['QuarantinedImageReader', DefaultQuarantinedImageReader],
  ['ModerationMaintenanceJob', ModerationMaintenanceJob],
  ['PendingModerationRecord', InMemoryPendingModerationRecord],
  ['ModerationIncidentReporter', SentryModerationIncidentReporter],
  ['ModerationStatements', D1ModerationStatements],
  ['ImageModerationWriter', ControlImageModerationWriter],
  ['EngagementModerationWriter', ControlEngagementModerationWriter],
  ['UserModerationRecordSyncHandler', UserModerationRecordSyncHandler],
  ['ProductModerationRecordSyncHandler', ProductModerationRecordSyncHandler],
  ['WeeklyStatisticsStore', D1WeeklyStatisticsStore],
  ['WeeklyStatisticsJob', WeeklyStatisticsJob],
  ['WeeklyStatisticsReader', DefaultWeeklyStatisticsReader],
] as const;

const CONTEXT = {
  actionId: '01JQ0MDR000000000000000001',
  action: 'comment.hide',
  targetId: '01JD0CMNT00000000000000001',
  occurredAt: new Date('2026-11-20T04:21:00.000Z'),
} as const;

const SUSPENDED_EVENT = {
  id: '01JC0EVT000000000000000001',
  userId: moderatedUserIdOf(1),
  type: 'suspended',
  occurredAt: T0,
} as const;

const PENDING_SUSPENSION: PendingModeration = {
  record: {
    id: moderationIdOf(1),
    action: 'user.suspend',
    targetId: moderatedUserIdOf(1),
    subjectUserId: moderatedUserIdOf(1),
    productId: null,
    operatorAdminId: OPERATOR_ADMIN_ID,
    reason: '規約違反の投稿を繰り返したため',
    noticeStatus: 'pending',
  },
  lifecycleEvent: 'suspended',
  audit: auditOf({
    index: 1,
    action: 'user.suspend',
    targetKind: 'user',
    targetId: PSEUDONYMOUS_ID,
    occurredAt: T0,
  }),
  participation: undefined,
};

function createContainer(kind: InvocationScopeInfo['kind']): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

describe('APIサーバーのモジュールの一覧への措置の束縛の登録', () => {
  test('apiの措置のモジュールを、engagementのモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(MODERATION_MODULE.name).toBe('moderation');
    expect(names.filter((name) => name === 'moderation')).toHaveLength(1);
    expect(MODULES.indexOf(MODERATION_MODULE)).toBeGreaterThan(
      MODULES.indexOf(ENGAGEMENT_MODULE),
    );
  });

  test('解決を確かめる識別子は、参加者の解決の部品を除くMODERATION_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(MODERATION_TYPES)
        .filter((name) => !IDENTIFIERS_OUTSIDE_IMPLEMENTATIONS.includes(name))
        .toSorted(),
    );
  });

  test('保守のジョブを4:21の起動に順序1910で1つだけ登録し、同じ起動の他のジョブと順序が重ならない', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS).jobsFor(DAILY_CRON);

    expect(
      SCHEDULED_JOBS.filter(
        ({ handler }) => handler === MODERATION_TYPES.ModerationMaintenanceJob,
      ),
    ).toStrictEqual([MODERATION_MAINTENANCE_JOB_DEFINITION]);
    expect(
      jobs.filter(({ order }) => order === 1910).map(({ name }) => name),
    ).toEqual(['ugc-moderation.maintenance']);
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
  });

  test('統計の集計のジョブを4:21の起動に順序1900で1つだけ登録し、保守のジョブより前に動かす', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS).jobsFor(DAILY_CRON);

    expect(
      SCHEDULED_JOBS.filter(
        ({ handler }) => handler === MODERATION_TYPES.WeeklyStatisticsJob,
      ),
    ).toStrictEqual([WEEKLY_STATISTICS_JOB_DEFINITION]);
    expect(
      jobs.filter(({ order }) => order === 1900).map(({ name }) => name),
    ).toEqual(['ugc-moderation.weekly-statistics']);
    expect(
      jobs
        .map(({ name }) => name)
        .filter((name) => name.startsWith('ugc-moderation.')),
    ).toEqual([
      'ugc-moderation.weekly-statistics',
      'ugc-moderation.maintenance',
    ]);
  });

  test('利用者の停止・停止解除・退会を対象に、措置の記録の同期の処理をユーザーの同期の処理の登録口に1つ登録する', () => {
    expect(
      USER_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'ugc-moderation.user-moderation-record' ||
          handler === MODERATION_TYPES.UserModerationRecordSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'ugc-moderation.user-moderation-record',
        events: ['suspended', 'unsuspended', 'withdrawn'],
        handler: MODERATION_TYPES.UserModerationRecordSyncHandler,
      },
    ]);
  });

  test('プロダクトの非公開化・復元を対象に、措置の記録の同期の処理をプロダクトの同期の処理の登録口に1つ登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'ugc-moderation.product-moderation-record' ||
          handler === MODERATION_TYPES.ProductModerationRecordSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'ugc-moderation.product-moderation-record',
        events: ['hidden', 'unhidden'],
        handler: MODERATION_TYPES.ProductModerationRecordSyncHandler,
      },
    ]);
  });
});

describe.each(INVOCATION_KINDS)('APIサーバーの措置の束縛(%s)', (kind) => {
  test.each(IMPLEMENTATIONS)(
    'モジュールの一覧の処理単位のコンテナから%sを実装のクラスに解決する',
    (name, implementation) => {
      expect(createContainer(kind).get(MODERATION_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test('保留中の措置は処理単位のコンテナの中で1つで、別の処理単位とは共有しない', () => {
    const container = createContainer(kind);
    const pending = container.get<PendingModerationRecord>(
      MODERATION_TYPES.PendingModerationRecord,
    );

    expect(
      container.get<PendingModerationRecord>(
        MODERATION_TYPES.PendingModerationRecord,
      ),
    ).toBe(pending);
    expect(
      createContainer(kind).get<PendingModerationRecord>(
        MODERATION_TYPES.PendingModerationRecord,
      ),
    ).not.toBe(pending);
  });

  test('同期の処理は同じ処理単位のコンテナに置いた保留中の措置だけを取り出す', async () => {
    const container = createContainer(kind);
    container
      .get<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
      .set(PENDING_SUSPENSION);

    const fromOther = await createContainer(kind)
      .get<UserLifecycleSyncHandler>(
        MODERATION_TYPES.UserModerationRecordSyncHandler,
      )
      .statementsFor(SUSPENDED_EVENT, db);
    const fromSame = await container
      .get<UserLifecycleSyncHandler>(
        MODERATION_TYPES.UserModerationRecordSyncHandler,
      )
      .statementsFor(SUSPENDED_EVENT, db);

    expect(fromOther).toStrictEqual([]);
    expect(fromSame.length).toBeGreaterThan(0);
    expect(
      container
        .get<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
        .wasTaken(),
    ).toBe(true);
  });

  test('参加者の解決の部品を初版の空の登録で組み立て、参加の無い措置に文を返さない', async () => {
    const participants = createContainer(kind).get<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    );

    await expect(
      participants.statementsFor(undefined, CONTEXT),
    ).resolves.toStrictEqual([]);
    await expect(
      participants.statementsFor(
        { kind: 'content-reporting.report-closure', payload: {} },
        CONTEXT,
      ),
    ).rejects.toThrow(
      '措置の書き込みの参加者に登録の無い種類です: "content-reporting.report-closure"',
    );
  });
});
