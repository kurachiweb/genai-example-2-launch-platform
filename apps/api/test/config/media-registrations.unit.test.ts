import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { Container } from 'inversify';
import { unstable_readConfig } from 'wrangler';
import { z } from 'zod';

import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import {
  createCronRegistry,
  type ScheduledJobDefinition,
} from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import type { AccountGuard } from '../../src/application/identity/account-guard.ts';
import { AccountUploaderEligibility } from '../../src/application/identity/account-uploader-eligibility.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
} from '../../src/application/media/file-access-policies.ts';
import { MEDIA_JOB_TYPES } from '../../src/application/media/media-daily-jobs.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../../src/application/media/uploader-eligibility.ts';
import { FILE_READ_POLICIES } from '../../src/composition/file-read-policies.ts';
import { MEDIA_REVIEW_POLICY_BINDINGS } from '../../src/composition/media-review-policy.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';
import { UPLOAD_PURPOSES } from '../../src/composition/upload-purposes.ts';
import { UPLOADER_ELIGIBILITY_BINDINGS } from '../../src/composition/uploader-eligibility.ts';
import { DenyAllAdminMediaReviewPolicy } from '../../src/infrastructure/media/deny-all-admin-media-review-policy.ts';
import { imageFileViewOf } from '../support/media-file-view.ts';

const API_WRANGLER_CONFIG = join(
  import.meta.dirname,
  '..',
  '..',
  'wrangler.jsonc',
);

const WRANGLER_ENVIRONMENTS = [
  { label: 'ローカル(ルート)', wranglerEnv: undefined },
  { label: 'staging', wranglerEnv: 'staging' },
  { label: 'prod', wranglerEnv: 'prod' },
] as const;

const triggersSchema = z.object({
  triggers: z.object({ crons: z.array(z.string()).optional() }),
});

const DAILY_RUN_AT = { hour: 4, minute: 21 } as const;

const MEDIA_JOBS: readonly ScheduledJobDefinition[] = [
  {
    name: 'media-pipeline.expired-file-erasure',
    at: DAILY_RUN_AT,
    order: 810,
    handler: MEDIA_JOB_TYPES.ExpiredFileErasureJob,
  },
  {
    name: 'media-pipeline.moderation-requeue',
    at: DAILY_RUN_AT,
    order: 820,
    handler: MEDIA_JOB_TYPES.ModerationRequeueJob,
  },
  {
    name: 'media-pipeline.location-reconciliation',
    at: DAILY_RUN_AT,
    order: 830,
    handler: MEDIA_JOB_TYPES.LocationReconciliationJob,
  },
];

const USER_PRINCIPAL = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JC0USER00000000000000001',
  sessionId: '01JC0SESSION0000000000001',
} as const);

const ADMIN_PRINCIPAL = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: '01JC0ADMIN0000000000000001',
  sessionId: '01JC0SESSION0000000000002',
} as const);

const REGISTERED_AT = new Date('2026-10-01T00:00:00.000Z');

const unusedGuardMethod = (): never => {
  throw new Error('アップロードの判定では使わない');
};

const activeUserGuard: AccountGuard = {
  currentUser: () =>
    Promise.resolve({
      principal: USER_PRINCIPAL,
      user: {
        id: USER_PRINCIPAL.subjectId,
        status: 'active',
        emailVerifiedAt: REGISTERED_AT,
        deletedAt: null,
        pseudonymousId: '01JC0PSEUDONYM000000000001',
        email: 'user@mail.example',
        passwordHash: 'hashed',
        nickname: '利用者',
        handle: 'user_1',
        disposableEmailStatus: 'regular',
        termsAgreedAt: REGISTERED_AT,
        lifecycleVersion: 0,
      },
    }),
  requireUser: unusedGuardMethod,
  requireWritableUser: unusedGuardMethod,
  requireVerifiedUser: unusedGuardMethod,
};

function readTriggerCrons(wranglerEnv: string | undefined): readonly string[] {
  const raw: unknown = unstable_readConfig(
    { config: API_WRANGLER_CONFIG, env: wranglerEnv },
    { hideWarnings: true },
  );
  return triggersSchema.parse(raw).triggers.crons ?? [];
}

// 利用者のアカウントの判定・管理者の権限の判定を持つ機能が束縛を差し替えるときは、この期待値を差し替え後の束縛に合わせて直す
describe('メディアの登録箇所の既定値', () => {
  test('アップロードの用途は管理者のプロフィール画像だけを登録し、用途ごとの閲覧の可否の方針は1つも登録しない', () => {
    expect(UPLOAD_PURPOSES).toEqual([
      {
        name: 'admin-avatar',
        storage: 'images',
        uploaderKinds: ['admin'],
        allowedTypes: IMAGE_MEDIA_TYPES,
        maxBytes: 512_000,
      },
    ]);
    expect(FILE_READ_POLICIES).toEqual([]);
  });

  test('管理者の画像確認には、管理者側の管理者にも常に拒否する既定の実装を束縛する', async () => {
    const container = new Container();
    container.load(MEDIA_REVIEW_POLICY_BINDINGS);

    const policy = container.get<AdminMediaReviewPolicy>(
      FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
    );

    expect(policy).toBeInstanceOf(DenyAllAdminMediaReviewPolicy);
    expect(
      await policy.canReview({
        principal: ADMIN_PRINCIPAL,
        file: imageFileViewOf(),
      }),
    ).toBe(false);
  });

  test('アップロードできる利用者かの判定は、利用者の状態による判定の識別子へ転送する', async () => {
    const container = new Container();
    container.load(UPLOADER_ELIGIBILITY_BINDINGS);
    container
      .bind<AccountGuard>(IDENTITY_TYPES.AccountGuard)
      .toConstantValue(activeUserGuard);
    container
      .bind<UploaderEligibility>(IDENTITY_TYPES.AccountUploaderEligibility)
      .to(AccountUploaderEligibility)
      .inSingletonScope();

    const eligibility = container.get<UploaderEligibility>(
      UPLOAD_ACCESS_TYPES.UploaderEligibility,
    );

    expect(eligibility).toBeInstanceOf(AccountUploaderEligibility);
    expect(eligibility).toBe(
      container.get(IDENTITY_TYPES.AccountUploaderEligibility),
    );
    expect(
      await eligibility.check({
        session: { principal: () => Promise.resolve(USER_PRINCIPAL) },
        principal: USER_PRINCIPAL,
        purpose: {
          name: 'user-avatar',
          storage: 'images',
          uploaderKinds: ['user'],
          allowedTypes: ['image/png'],
          maxBytes: 1024,
        },
      }),
    ).toEqual({ allowed: true });
  });
});

describe('メディアの日次バッチの登録', () => {
  test('3つのジョブを業務時刻4:21に順序810・820・830で登録する', () => {
    const mediaJobs = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('media-pipeline.'),
    );

    expect(mediaJobs).toEqual([...MEDIA_JOBS]);
  });

  test('4:21の起動で、メディアの3つのジョブが物理削除・判定の再依頼・保存先の照合の順に動く', () => {
    const names = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(toUtcCronExpression(DAILY_RUN_AT))
      .map(({ name }) => name)
      .filter((name) => name.startsWith('media-pipeline.'));

    expect(names).toEqual(MEDIA_JOBS.map(({ name }) => name));
  });

  test.each(WRANGLER_ENVIRONMENTS)(
    '$labelの定期実行の定義に、4:21の起動の式21 12 * * *がある',
    ({ wranglerEnv }) => {
      const cron = toUtcCronExpression(DAILY_RUN_AT);

      expect(cron).toBe('21 12 * * *');
      expect(readTriggerCrons(wranglerEnv)).toContain(cron);
    },
  );
});
