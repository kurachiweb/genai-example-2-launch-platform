import { describe, expect, test } from 'bun:test';

import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../admin/admin-avatar-upload.ts';
import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../product/product-input-rules.ts';
import { USER_AVATAR_PURPOSE } from '../profile/profile-input-rules.ts';
import { MODERATION_ACTIONS } from './moderation-actions.ts';
import {
  ADMIN_COMMENT_STATE_LABELS,
  ADMIN_COMMENT_STATES,
  ADMIN_LAUNCH_STATE_LABELS,
  ADMIN_LAUNCH_STATES,
  DISPOSABLE_EMAIL_JUDGEMENTS,
  DISPOSABLE_EMAIL_LABELS,
  MEDIA_PURPOSE_LABELS,
  mediaPurposeLabel,
  MODERATION_ACTION_LABELS,
  QUARANTINE_REASON_LABELS,
  QUARANTINE_REASONS,
} from './moderation-labels.ts';

const expectLabelsCover = (
  labels: Readonly<Record<string, string>>,
  values: readonly string[],
): void => {
  expect(Object.keys(labels).toSorted()).toEqual([...values].toSorted());
  for (const value of values) {
    expect(labels[value]?.length ?? 0).toBeGreaterThan(0);
  }
  expect(Object.isFrozen(labels)).toBe(true);
};

describe('MODERATION_ACTION_LABELS', () => {
  test('13種の措置の表示名を持つ', () => {
    expectLabelsCover(MODERATION_ACTION_LABELS, MODERATION_ACTIONS);
    expect(MODERATION_ACTION_LABELS).toEqual({
      'user.suspend': 'ユーザーの停止',
      'user.unsuspend': 'ユーザーの停止解除',
      'user.administrative-withdraw': 'ユーザーの代理の退会',
      'product.hide': 'プロダクトの非公開化',
      'product.unhide': 'プロダクトの復元',
      'comment.hide': 'コメントの非公開化',
      'comment.unhide': 'コメントの復元',
      'rating.invalidate': '評価の無効化',
      'rating.revalidate': '評価の無効化の取り消し',
      'image.approve': '画像の公開承認',
      'image.quarantine': '画像の隔離',
      'image.release': '画像の隔離の解除',
      'image.delete': '画像の削除',
    });
  });
});

describe('QUARANTINE_REASON_LABELS', () => {
  test('写した隔離理由の4つを網羅し、文言規則の表示名を持つ', () => {
    expect(QUARANTINE_REASONS).toEqual([
      'auto',
      'product_hidden',
      'user_suspended',
      'admin_action',
    ]);
    expectLabelsCover(QUARANTINE_REASON_LABELS, QUARANTINE_REASONS);
    expect(QUARANTINE_REASON_LABELS).toEqual({
      auto: '自動判定',
      product_hidden: '非公開化',
      user_suspended: 'ユーザー停止',
      admin_action: '管理者操作',
    });
  });
});

describe('DISPOSABLE_EMAIL_LABELS', () => {
  test('写した使い捨て判定の3つと、メールアドレスの確認前の未確認を網羅する', () => {
    expect(DISPOSABLE_EMAIL_JUDGEMENTS).toEqual([
      'disposable',
      'regular',
      'undetermined',
      'unverified',
    ]);
    expectLabelsCover(DISPOSABLE_EMAIL_LABELS, DISPOSABLE_EMAIL_JUDGEMENTS);
    expect(DISPOSABLE_EMAIL_LABELS).toEqual({
      disposable: '使い捨て',
      regular: '通常',
      undetermined: '判定できず',
      unverified: '未確認',
    });
  });
});

describe('ADMIN_LAUNCH_STATE_LABELS', () => {
  test('写した最新のローンチの状態の5つを網羅する', () => {
    expect(ADMIN_LAUNCH_STATES).toEqual([
      'scheduled',
      'in_progress',
      'won',
      'lost',
      'canceled',
    ]);
    expectLabelsCover(ADMIN_LAUNCH_STATE_LABELS, ADMIN_LAUNCH_STATES);
    expect(ADMIN_LAUNCH_STATE_LABELS).toEqual({
      scheduled: '予約中',
      in_progress: '予選マッチ中',
      won: '勝利',
      lost: '敗北',
      canceled: '取消',
    });
  });
});

describe('ADMIN_COMMENT_STATE_LABELS', () => {
  test('写したコメントの状態の5つを網羅する', () => {
    expect(ADMIN_COMMENT_STATES).toEqual([
      'hidden',
      'deleted',
      'anonymized',
      'author_unavailable',
      'shown',
    ]);
    expectLabelsCover(ADMIN_COMMENT_STATE_LABELS, ADMIN_COMMENT_STATES);
    expect(ADMIN_COMMENT_STATE_LABELS).toEqual({
      hidden: '管理者が非公開化',
      deleted: '投稿者が削除',
      anonymized: '匿名化済み',
      author_unavailable: '投稿者が退会・停止中',
      shown: '表示中',
    });
  });
});

describe('MEDIA_PURPOSE_LABELS', () => {
  test('画像の4つの用途の表示名を持つ', () => {
    expectLabelsCover(MEDIA_PURPOSE_LABELS, [
      USER_AVATAR_PURPOSE,
      PRODUCT_LOGO_PURPOSE,
      PRODUCT_SCREENSHOT_PURPOSE,
      ADMIN_AVATAR_UPLOAD_PURPOSE,
    ]);
    expect(MEDIA_PURPOSE_LABELS).toEqual({
      'user-avatar': 'プロフィール画像',
      'product-logo': 'ロゴ',
      'product-screenshot': 'スクリーンショット',
      'admin-avatar': '管理者のプロフィール画像',
    });
  });

  test('mediaPurposeLabelは既知の用途の表示名を返す', () => {
    expect(mediaPurposeLabel(USER_AVATAR_PURPOSE)).toBe('プロフィール画像');
  });

  test('mediaPurposeLabelは未知の用途に用途名をそのまま返す', () => {
    expect(mediaPurposeLabel('inquiry-attachment')).toBe('inquiry-attachment');
  });

  test('mediaPurposeLabelはObjectの組み込みのプロパティ名を用途の表示名として扱わない', () => {
    expect(mediaPurposeLabel('toString')).toBe('toString');
    expect(mediaPurposeLabel('__proto__')).toBe('__proto__');
  });
});
