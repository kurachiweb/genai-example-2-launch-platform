import { describe, expect, test } from 'bun:test';

import {
  changeRoleTitle,
  currentRoleText,
  deleteAdminTitle,
  editProfileTitle,
  invitationSentMessage,
  resendInvitationTitle,
  ROW_ACTION_NAMES,
} from './admin-accounts-messages.ts';

describe('管理者アカウントの文言', () => {
  test('ダイアログの題名と結果の文言に対象の管理者を含める', () => {
    expect(resendInvitationTitle('invited@admin.example')).toBe(
      '「invited@admin.example」に招待を再送しますか?',
    );
    expect(deleteAdminTitle('審査の担当')).toBe(
      '管理者「審査の担当」を削除しますか?',
    );
    expect(changeRoleTitle('審査の担当')).toBe('「審査の担当」のロールを変更');
    expect(editProfileTitle('審査の担当')).toBe(
      '「審査の担当」のプロフィールを編集',
    );
    expect(currentRoleText('モデレーター')).toBe('現在のロール: モデレーター');
    expect(invitationSentMessage('new-admin@admin.example')).toBe(
      'new-admin@admin.exampleに招待のメールを送信しました。',
    );
  });

  test('行の操作の名前は、見えている操作名の前に対象の管理者を置く', () => {
    expect(ROW_ACTION_NAMES.resend('審査の担当')).toBe(
      '「審査の担当」の招待を再送',
    );
    expect(ROW_ACTION_NAMES.changeRole('審査の担当')).toBe(
      '「審査の担当」のロールを変更',
    );
    expect(ROW_ACTION_NAMES.editProfile('審査の担当')).toBe(
      '「審査の担当」のプロフィールを編集',
    );
    expect(ROW_ACTION_NAMES.delete('審査の担当')).toBe('「審査の担当」を削除');
  });
});
