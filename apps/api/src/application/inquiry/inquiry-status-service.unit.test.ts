import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type InquiryStatusService,
  StoreInquiryStatusService,
} from './inquiry-status-service.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  AdminInquiryDetail,
  GuestInquiryRecord,
  InquiryAdminReader,
  InquiryStatusStore,
  InquiryStatusTarget,
  MemberInquiryRecord,
} from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const INQUIRY_ID = '01JD0000000000000000MINQ01';
const GUEST_INQUIRY_ID = '01JD0000000000000000GINQ01';

const CURRENT_ADMIN: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: 'モデレーター',
  sessionId: '01JD0000000000000000SESS09',
});

const memberInquiryOf = (
  overrides: Partial<MemberInquiryRecord> = {},
): MemberInquiryRecord => ({
  id: INQUIRY_ID,
  userId: '01JD0000000000000000USER01',
  categoryId: '01JD0000000000000000000BUG',
  status: 'open',
  statusChangedAt: new Date('2027-03-02T00:00:00.000Z'),
  lastMessageAt: new Date('2027-03-03T00:00:00.000Z'),
  createdAt: new Date('2027-03-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const guestInquiryOf = (
  overrides: Partial<GuestInquiryRecord> = {},
): GuestInquiryRecord => ({
  id: GUEST_INQUIRY_ID,
  categoryId: '01JC0000000000000000000000',
  nickname: '未ログインの人',
  email: 'guest@mail.example',
  body: 'ログインできません。',
  status: 'resolved',
  statusChangedAt: new Date('2027-03-05T00:00:00.000Z'),
  createdAt: new Date('2027-03-05T00:00:00.000Z'),
  ...overrides,
});

const PREPARED = Object.freeze({
  operatorAdminId: CURRENT_ADMIN.id,
}) as unknown as PreparedAuditEntry;

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      // コンテナは注入する値がPromiseかをthenの有無で調べるため、thenは無いものとして返す
      if (property === 'then' || typeof property === 'symbol') {
        return undefined;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${property}`);
      };
    },
  }) as T;
}

interface ChangedStatus {
  readonly target: InquiryStatusTarget;
  readonly next: InquiryStatus;
  readonly at: Date;
  readonly audit: PreparedAuditEntry;
}

interface FakeOptions {
  readonly detail?: AdminInquiryDetail | undefined;
  readonly prepareError?: AppError;
  readonly changeResult?: 'changed' | 'conflict';
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const changed: ChangedStatus[] = [];
  const detail =
    'detail' in options
      ? options.detail
      : { kind: 'member' as const, inquiry: memberInquiryOf() };
  const reader = partialFake<InquiryAdminReader>({
    findDetail: (id) => {
      calls.push('findDetail');
      return Promise.resolve(detail?.inquiry.id === id ? detail : undefined);
    },
  });
  const store: InquiryStatusStore = {
    change: (target, next, at, audit) => {
      calls.push('change');
      changed.push({ target, next, at, audit });
      return Promise.resolve(options.changeResult ?? 'changed');
    },
  };
  const auditLog = partialFake<AuditLogRecorder>({
    prepare: (input) => {
      calls.push('prepare');
      prepared.push(input);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
      return PREPARED;
    },
  });
  const clock: Clock = { now: () => NOW };
  const container = new Container();
  container
    .bind<InquiryAdminReader>(INQUIRY_TYPES.InquiryAdminReader)
    .toConstantValue(reader);
  container
    .bind<InquiryStatusStore>(INQUIRY_TYPES.InquiryStatusStore)
    .toConstantValue(store);
  container
    .bind<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    .toConstantValue(auditLog);
  container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);
  container
    .bind<InquiryStatusService>(INQUIRY_TYPES.InquiryStatusService)
    .to(StoreInquiryStatusService);
  const service = container.get<InquiryStatusService>(
    INQUIRY_TYPES.InquiryStatusService,
  );
  return { service, calls, prepared, changed };
}

async function caught(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const appErrorOf = (error: unknown) => {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  return {
    kind: appError.kind,
    code: appError.code,
    details: appError.details?.map((detail) => [detail.field, detail.code]),
  };
};

describe('StoreInquiryStatusService.change', () => {
  test('ログインの問い合わせのステータスを、種別と変更前後のステータスを詳細に持つ監査ログの準備の後に変更し、変更後の問い合わせを返す', async () => {
    const { service, calls, prepared, changed } = setup();

    const result = await service.change(CURRENT_ADMIN, {
      inquiryId: INQUIRY_ID,
      status: 'in_progress',
      reason: '担当者が確認を始めた',
    });

    expect(result).toEqual({
      kind: 'member',
      inquiry: memberInquiryOf({ status: 'in_progress', statusChangedAt: NOW }),
    });
    expect(calls).toEqual(['findDetail', 'prepare', 'change']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT_ADMIN.id,
        action: 'inquiry.status-change',
        targetIds: [INQUIRY_ID],
        reason: '担当者が確認を始めた',
        detail: { kind: 'member', fromStatus: 'open', toStatus: 'in_progress' },
        occurredAt: NOW,
      },
    ]);
    expect(changed).toEqual([
      {
        target: {
          kind: 'member',
          id: INQUIRY_ID,
          status: 'open',
          withdrawn: false,
        },
        next: 'in_progress',
        at: NOW,
        audit: PREPARED,
      },
    ]);
  });

  test('未ログインの問い合わせのステータスも変更し、監査ログの詳細の種別を未ログインにする', async () => {
    const { service, calls, prepared, changed } = setup({
      detail: { kind: 'guest', inquiry: guestInquiryOf() },
    });

    const result = await service.change(CURRENT_ADMIN, {
      inquiryId: GUEST_INQUIRY_ID,
      status: 'open',
    });

    expect(result).toEqual({
      kind: 'guest',
      inquiry: guestInquiryOf({ status: 'open', statusChangedAt: NOW }),
    });
    expect(calls).toEqual(['findDetail', 'prepare', 'change']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT_ADMIN.id,
        action: 'inquiry.status-change',
        targetIds: [GUEST_INQUIRY_ID],
        detail: { kind: 'guest', fromStatus: 'resolved', toStatus: 'open' },
        occurredAt: NOW,
      },
    ]);
    expect(changed).toEqual([
      {
        target: {
          kind: 'guest',
          id: GUEST_INQUIRY_ID,
          status: 'resolved',
          withdrawn: false,
        },
        next: 'open',
        at: NOW,
        audit: PREPARED,
      },
    ]);
  });

  test.each([
    ['open', 'in_progress'],
    ['open', 'resolved'],
    ['open', 'rejected'],
    ['in_progress', 'open'],
    ['in_progress', 'resolved'],
    ['in_progress', 'rejected'],
    ['resolved', 'open'],
    ['resolved', 'in_progress'],
    ['resolved', 'rejected'],
    ['rejected', 'open'],
    ['rejected', 'in_progress'],
    ['rejected', 'resolved'],
  ] as const)('%sから%sへの変更をストアへ渡す', async (from, to) => {
    const { service, changed } = setup({
      detail: { kind: 'member', inquiry: memberInquiryOf({ status: from }) },
    });

    await service.change(CURRENT_ADMIN, { inquiryId: INQUIRY_ID, status: to });

    expect(changed.map((entry) => [entry.target.status, entry.next])).toEqual([
      [from, to],
    ]);
  });

  test('退会済み(論理削除した)の問い合わせの変更を、監査ログの準備と変更の前に拒否する', async () => {
    const { service, calls } = setup({
      detail: {
        kind: 'member',
        inquiry: memberInquiryOf({
          deletedAt: new Date('2027-03-10T00:00:00.000Z'),
        }),
      },
    });

    const error = await caught(
      service.change(CURRENT_ADMIN, {
        inquiryId: INQUIRY_ID,
        status: 'resolved',
      }),
    );

    expect(appErrorOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_read_only',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test('退会済みの問い合わせは、同じ値への変更でも退会済みのエラーで拒否する', async () => {
    const { service, calls } = setup({
      detail: {
        kind: 'member',
        inquiry: memberInquiryOf({
          deletedAt: new Date('2027-03-10T00:00:00.000Z'),
        }),
      },
    });

    const error = await caught(
      service.change(CURRENT_ADMIN, { inquiryId: INQUIRY_ID, status: 'open' }),
    );

    expect(appErrorOf(error).code).toBe('inquiry_read_only');
    expect(calls).toEqual(['findDetail']);
  });

  test.each([
    ['ログイン', 'member', 'in_progress'],
    ['未ログイン', 'guest', 'rejected'],
  ] as const)(
    '%sの問い合わせの現在と同じ値への変更を、ステータスの欄の検証のエラーで監査ログの準備と変更の前に拒否する',
    async (_label, kind, status) => {
      const detail: AdminInquiryDetail =
        kind === 'member'
          ? { kind, inquiry: memberInquiryOf({ status }) }
          : { kind, inquiry: guestInquiryOf({ status }) };
      const { service, calls } = setup({ detail });

      const error = await caught(
        service.change(CURRENT_ADMIN, {
          inquiryId: detail.inquiry.id,
          status,
        }),
      );

      expect(appErrorOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [['status', 'unchanged']],
      });
      expect(calls).toEqual(['findDetail']);
    },
  );

  test('存在しない問い合わせの変更を、見つからないエラーで拒否する', async () => {
    const { service, calls } = setup({ detail: undefined });

    const error = await caught(
      service.change(CURRENT_ADMIN, {
        inquiryId: INQUIRY_ID,
        status: 'resolved',
      }),
    );

    expect(appErrorOf(error)).toEqual({
      kind: 'not_found',
      code: 'inquiry_not_found',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test('監査ログの準備の違反は、ステータスを変えずにそのまま伝える', async () => {
    const invalid = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
    });
    const { service, calls } = setup({ prepareError: invalid });

    const error = await caught(
      service.change(CURRENT_ADMIN, {
        inquiryId: INQUIRY_ID,
        status: 'resolved',
      }),
    );

    expect(error).toBe(invalid);
    expect(calls).toEqual(['findDetail', 'prepare']);
  });

  test('読んだ後にステータスが変わったか退会が確定して変更が取り消されたら、状態の競合のエラーにする', async () => {
    const { service, calls } = setup({ changeResult: 'conflict' });

    const error = await caught(
      service.change(CURRENT_ADMIN, {
        inquiryId: INQUIRY_ID,
        status: 'resolved',
      }),
    );

    expect(appErrorOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_state_conflict',
      details: undefined,
    });
    expect(calls).toEqual(['findDetail', 'prepare', 'change']);
  });
});
