import { describe, expect, test } from 'bun:test';

import {
  reportStatusChangeDescription,
  reportStatusChangeTitle,
} from './report-case-messages.ts';

describe('対応ステータスの変更の確認の文言', () => {
  test('題は変更後の対応ステータスの表示名を入れる', () => {
    expect(reportStatusChangeTitle('対応中')).toBe(
      '対応ステータスを対応中にしますか?',
    );
  });

  test('未対応と対応中の間の変更は通知しない旨だけを示す', () => {
    expect(reportStatusChangeDescription('progress')).toBe(
      '手での変更では投稿者と申出者へ通知しません。',
    );
  });

  test('手での完了は通知する操作の案内を続ける', () => {
    expect(reportStatusChangeDescription('close')).toBe(
      '手での変更では投稿者と申出者へ通知しません。通知するには、措置・措置なしで対応済にする・却下の操作を使ってください。',
    );
  });

  test('完了からの再開は完了の記録を消し措置を取り消さない旨を続ける', () => {
    expect(reportStatusChangeDescription('reopen')).toBe(
      '手での変更では投稿者と申出者へ通知しません。完了の日時・措置の種類・完了の理由を消し、まだ送っていない通知を取りやめます。行った措置(非公開化・停止)は取り消されません。取り消す場合は各管理画面で行ってください。',
    );
  });
});
