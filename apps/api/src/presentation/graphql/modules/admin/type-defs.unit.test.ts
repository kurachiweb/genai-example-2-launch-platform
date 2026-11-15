import { describe, expect, test } from 'bun:test';
import { Kind, parse } from 'graphql';

import { ADMIN_TYPE_DEFS } from './type-defs.ts';

function rootFieldsOf(typeName: 'Query' | 'Mutation'): string[] {
  return parse(ADMIN_TYPE_DEFS).definitions.flatMap((definition) =>
    definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
    definition.name.value === typeName
      ? (definition.fields ?? []).map((field) => field.name.value)
      : [],
  );
}

describe('ADMIN_TYPE_DEFS', () => {
  test('監査ログは検索の照会だけを持ち、変更・削除の操作を持たない', () => {
    expect(rootFieldsOf('Query')).toContain('auditLogs');
    expect(
      rootFieldsOf('Mutation').filter((name) => /audit/iu.test(name)),
    ).toEqual([]);
  });

  test('操作は管理者の認証・管理・本人の操作の一覧と一致する', () => {
    expect(rootFieldsOf('Query').toSorted()).toEqual([
      'adminAccounts',
      'adminViewer',
      'auditLogs',
    ]);
    expect(rootFieldsOf('Mutation').toSorted()).toEqual([
      'adminLogin',
      'adminLogout',
      'changeAdminPassword',
      'changeAdminRole',
      'completeAdminInvitation',
      'completeAdminSecondFactorLogin',
      'completeAdminTotpReset',
      'confirmAdminEmailChange',
      'deleteAdmin',
      'inviteAdmin',
      'regenerateAdminRecoveryCodes',
      'requestAdminEmailChange',
      'requestAdminPasswordReset',
      'resendAdminInvitation',
      'resetAdminPassword',
      'startAdminInvitation',
      'startAdminTotpReset',
      'updateAdminProfile',
    ]);
  });
});
