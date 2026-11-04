import { describe, expect, test } from 'bun:test';

import type { AuditActionDefinition } from '../../../common-lib/admin/audit-action.ts';
import type { AdminAccount } from '../../graphql/admin-accounts.ts';
import {
  actionOptionsOf,
  operatorOptionsOf,
} from './audit-log-filter-options.ts';

const accountOf = (
  overrides: Partial<AdminAccount> & Pick<AdminAccount, 'id'>,
): AdminAccount => ({
  email: `${overrides.id.toLowerCase()}@admin.example`,
  nickname: '運営の担当',
  title: null,
  avatar: null,
  role: 'viewer',
  status: 'active',
  createdAt: '2026-10-01T03:00:00.000Z',
  ...overrides,
});

const ACTIVE = accountOf({
  id: '01JC0ADMIN000000000000000001',
  nickname: '審査の担当',
});
const SECOND = accountOf({
  id: '01JC0ADMIN000000000000000002',
  nickname: '統括の担当',
});
const INVITED = accountOf({
  id: '01JC0ADMIN000000000000000003',
  nickname: null,
  status: 'invited',
});
const EXPIRED = accountOf({
  id: '01JC0ADMIN000000000000000004',
  nickname: null,
  status: 'invitation_expired',
});

const ACTIONS: readonly AuditActionDefinition[] = [
  {
    name: 'admin-account.invite',
    label: '管理者の招待',
    targetKind: 'admin',
    reason: 'optional',
    detailKeys: [],
    maxTargets: 1,
  },
  {
    name: 'user.email-search',
    label: 'ユーザーのメールアドレス検索',
    targetKind: 'user',
    reason: 'none',
    detailKeys: [],
    maxTargets: 100,
  },
];

describe('operatorOptionsOf', () => {
  test('操作し得る有効な管理者だけを一覧の順にニックネームで選べるようにする', () => {
    expect(
      operatorOptionsOf([INVITED, ACTIVE, EXPIRED, SECOND], undefined),
    ).toStrictEqual([
      { value: ACTIVE.id, label: '審査の担当' },
      { value: SECOND.id, label: '統括の担当' },
    ]);
  });

  test('一覧に無い管理者(削除済みなど)が条件にあれば、IDで示す選択肢を最後に加える', () => {
    expect(
      operatorOptionsOf([ACTIVE], '01JC0ADMIN0000000000000000FF'),
    ).toStrictEqual([
      { value: ACTIVE.id, label: '審査の担当' },
      {
        value: '01JC0ADMIN0000000000000000FF',
        label: '一覧に無い管理者(ID: 01JC0ADMIN0000000000000000FF)',
      },
    ]);
  });

  test('一覧にある管理者が条件なら選択肢を加えない', () => {
    expect(operatorOptionsOf([ACTIVE], ACTIVE.id)).toStrictEqual([
      { value: ACTIVE.id, label: '審査の担当' },
    ]);
  });
});

describe('actionOptionsOf', () => {
  test('登録された操作種別を登録の順に表示名で選べるようにする', () => {
    expect(actionOptionsOf(ACTIONS, undefined)).toStrictEqual([
      { value: 'admin-account.invite', label: '管理者の招待' },
      { value: 'user.email-search', label: 'ユーザーのメールアドレス検索' },
    ]);
  });

  test('登録に無い操作種別が条件にあれば、名前で示す選択肢を最後に加える', () => {
    expect(actionOptionsOf(ACTIONS, 'retired.action')).toStrictEqual([
      { value: 'admin-account.invite', label: '管理者の招待' },
      { value: 'user.email-search', label: 'ユーザーのメールアドレス検索' },
      { value: 'retired.action', label: 'retired.action' },
    ]);
  });
});
