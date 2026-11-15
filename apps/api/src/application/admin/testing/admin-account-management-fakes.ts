import type { AdminRole } from '../../../../common-lib/admin/admin-roles.ts';
import { createAuditActionCatalog } from '../../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import type { PreparedAuditEntry } from '../../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../../lib/core/admin/current-admin.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type {
  ClaimRequest,
  ClaimResult,
  EraseSummary,
  MediaFiles,
} from '../../../../lib/core/media/ports.ts';
import type { AdminSnapshot } from '../../../domain/admin/admin-account.ts';
import {
  type AdminAccountManagement,
  StoreAdminAccountManagement,
} from '../admin-account-management.ts';
import { type AdminProfile, StoreAdminProfile } from '../admin-profile.ts';
import { StoreAuditLogRecorder } from '../audit-log-recorder.ts';
import type {
  AdminAccountStore,
  AdminProfileUpdate,
  AdminRecord,
  AdminRequestMeta,
  AdminRoleChange,
  AuditLogStore,
} from '../ports.ts';

export const MANAGEMENT_NOW = new Date('2026-11-03T03:04:05.678Z');

export const MANAGEMENT_META: AdminRequestMeta = {
  clientIp: '192.0.2.40',
  userAgent: 'Mozilla/5.0',
  now: MANAGEMENT_NOW,
};

export const OPERATOR_ID = '01JC0OPER00000000000000001';

export const TARGET_ID = '01JC0TRGT00000000000000001';

export const OTHER_SUPER_ADMIN_ID = '01JC0SUPR00000000000000002';

export const CURRENT_AVATAR_ID = '01JC0FILE00000000000000001';

export const NEW_AVATAR_ID = '01JC0FILE00000000000000002';

export const currentAdmin = (role: AdminRole): CurrentAdmin => ({
  id: OPERATOR_ID,
  role,
  nickname: '操作者',
  sessionId: '01JC0SESN00000000000000009',
});

export const adminRecordOf = (
  overrides: Partial<AdminRecord> = {},
): AdminRecord => ({
  id: TARGET_ID,
  role: 'viewer',
  status: 'active',
  invitationExpiresAt: null,
  email: 'target1@mail.example',
  passwordHash: 'stored-hash',
  nickname: '対象の管理者',
  title: null,
  avatarFileId: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  activatedAt: new Date('2026-11-01T01:00:00.000Z'),
  ...overrides,
});

export const operatorRecordOf = (role: AdminRole): AdminRecord =>
  adminRecordOf({
    id: OPERATOR_ID,
    role,
    email: 'operator1@mail.example',
    nickname: '操作者',
  });

type AdminTable = Map<string, AdminRecord>;

export interface AccountManagementFakeOptions {
  readonly admins?: readonly AdminRecord[];
  // 一括の書き込みの直前に割り込む操作。rejectedを返すと書き込みを取り消したことにする
  readonly beforeGuardedWrite?: (admins: AdminTable) => 'rejected' | undefined;
  // プロフィールの更新の直前に割り込む操作
  readonly beforeProfileUpdate?: (admins: AdminTable) => void;
  readonly claimResult?: ClaimResult;
  readonly claimError?: Error;
  readonly eraseError?: Error;
}

export interface AccountManagementRecorded {
  readonly calls: string[];
  readonly admins: AdminTable;
  readonly deletions: {
    readonly operator: AdminSnapshot;
    readonly targetId: string;
    readonly audit: PreparedAuditEntry;
  }[];
  readonly roleChanges: {
    readonly operator: AdminSnapshot;
    readonly change: AdminRoleChange;
    readonly audit: PreparedAuditEntry;
  }[];
  readonly profileUpdates: {
    readonly adminId: string;
    readonly input: AdminProfileUpdate;
  }[];
  readonly claims: ClaimRequest[];
  readonly erasures: (readonly string[])[];
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

function createAccountStore(
  recorded: AccountManagementRecorded,
  options: AccountManagementFakeOptions,
): AdminAccountStore {
  const { admins } = recorded;
  const guardedWrite = (): 'rejected' | undefined =>
    options.beforeGuardedWrite?.(admins);
  return partialFake<AdminAccountStore>({
    findById(adminId) {
      recorded.calls.push('admins.findById');
      return Promise.resolve(admins.get(adminId));
    },
    list() {
      recorded.calls.push('admins.list');
      return Promise.resolve([...admins.values()]);
    },
    deleteGuarded(operator, targetId, audit) {
      recorded.calls.push('admins.deleteGuarded');
      if (guardedWrite() === 'rejected') {
        return Promise.resolve('rejected');
      }
      recorded.deletions.push({ operator, targetId, audit });
      admins.delete(targetId);
      return Promise.resolve('deleted');
    },
    changeRoleGuarded(operator, change, audit) {
      recorded.calls.push('admins.changeRoleGuarded');
      if (guardedWrite() === 'rejected') {
        return Promise.resolve('rejected');
      }
      recorded.roleChanges.push({ operator, change, audit });
      const target = admins.get(change.targetId);
      if (target !== undefined) {
        admins.set(target.id, { ...target, role: change.toRole });
      }
      return Promise.resolve('changed');
    },
    updateProfile(adminId, input) {
      recorded.calls.push('admins.updateProfile');
      options.beforeProfileUpdate?.(admins);
      const target = admins.get(adminId);
      if (target?.status !== 'active') {
        return Promise.resolve('not-active');
      }
      recorded.profileUpdates.push({ adminId, input });
      admins.set(adminId, { ...target, ...input });
      return Promise.resolve('updated');
    },
  });
}

function createMediaFiles(
  recorded: AccountManagementRecorded,
  options: AccountManagementFakeOptions,
): MediaFiles {
  return partialFake<MediaFiles>({
    claim(request) {
      recorded.calls.push('media.claim');
      recorded.claims.push(request);
      if (options.claimError !== undefined) {
        return Promise.reject(options.claimError);
      }
      return Promise.resolve(options.claimResult ?? { ok: true });
    },
    eraseNow(fileIds): Promise<EraseSummary> {
      recorded.calls.push('media.eraseNow');
      recorded.erasures.push(fileIds);
      if (options.eraseError !== undefined) {
        return Promise.reject(options.eraseError);
      }
      return Promise.resolve({ erased: fileIds.length });
    },
  });
}

function createAuditLogRecorder(): StoreAuditLogRecorder {
  let sequence = 0;
  const ids: IdGenerator = {
    generate: () => `01JC0AUDT${String(sequence++).padStart(17, '0')}`,
  };
  return new StoreAuditLogRecorder(
    createAuditActionCatalog(AUDIT_ACTIONS),
    ids,
    partialFake<AuditLogStore>({}),
  );
}

function createRecorded(
  options: AccountManagementFakeOptions,
): AccountManagementRecorded {
  const admins = options.admins ?? [
    operatorRecordOf('super_admin'),
    adminRecordOf(),
  ];
  return {
    calls: [],
    admins: new Map(admins.map((admin) => [admin.id, admin])),
    deletions: [],
    roleChanges: [],
    profileUpdates: [],
    claims: [],
    erasures: [],
  };
}

export function setupAccountManagement(
  options: AccountManagementFakeOptions = {},
): {
  readonly management: AdminAccountManagement;
  readonly profile: AdminProfile;
  readonly recorded: AccountManagementRecorded;
} {
  const recorded = createRecorded(options);
  const admins = createAccountStore(recorded, options);
  const media = createMediaFiles(recorded, options);
  return {
    management: new StoreAdminAccountManagement(
      admins,
      createAuditLogRecorder(),
      media,
    ),
    profile: new StoreAdminProfile(admins, media),
    recorded,
  };
}

export async function rejectionOf(action: Promise<unknown>): Promise<unknown> {
  return action.then(
    () => {
      throw new Error('例外が発生しませんでした。');
    },
    (error: unknown) => error,
  );
}
