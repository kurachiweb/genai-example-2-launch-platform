import { describe, expect, test } from 'bun:test';

import { INQUIRY_STATUS_LABELS } from '../inquiry/inquiry-status.ts';
import { MODERATION_ACTION_LABELS } from '../moderation/moderation-labels.ts';
import {
  REPORT_CASE_STATUSES,
  REPORT_RESOLUTIONS,
} from './report-case-rules.ts';
import {
  REPORT_CASE_STATUS_LABELS,
  REPORT_RESOLUTION_LABELS,
  REPORT_TARGET_KIND_LABELS,
  RESPONSE_TIME_ALERT_LABELS,
} from './report-labels.ts';
import { REPORT_TARGET_KINDS } from './report-rules.ts';

describe('通報の表示名', () => {
  test('対象の種類の表示名', () => {
    expect(REPORT_TARGET_KIND_LABELS).toEqual({
      user: 'ユーザー',
      product: 'プロダクト',
      comment: 'コメント',
    });
    expect(Object.keys(REPORT_TARGET_KIND_LABELS)).toEqual([
      ...REPORT_TARGET_KINDS,
    ]);
    expect(Object.isFrozen(REPORT_TARGET_KIND_LABELS)).toBe(true);
  });

  test('対応ステータスの表示名', () => {
    expect(REPORT_CASE_STATUS_LABELS).toEqual({
      open: '未対応',
      in_progress: '対応中',
      resolved: '対応済',
      rejected: '却下',
    });
    expect(Object.keys(REPORT_CASE_STATUS_LABELS)).toEqual([
      ...REPORT_CASE_STATUSES,
    ]);
    expect(Object.isFrozen(REPORT_CASE_STATUS_LABELS)).toBe(true);
  });

  test('対応ステータスの表示名がinquiry-chatの問い合わせの対応ステータスと一致する', () => {
    expect(REPORT_CASE_STATUS_LABELS).toEqual(INQUIRY_STATUS_LABELS);
  });

  test('措置の種類の表示名', () => {
    expect(REPORT_RESOLUTION_LABELS).toEqual({
      'product.hide': 'プロダクトの非公開化',
      'comment.hide': 'コメントの非公開化',
      'user.suspend': 'ユーザーの停止',
      none: '措置なし',
    });
    expect(Object.keys(REPORT_RESOLUTION_LABELS)).toEqual([
      ...REPORT_RESOLUTIONS,
    ]);
    expect(Object.isFrozen(REPORT_RESOLUTION_LABELS)).toBe(true);
  });

  test('措置の表示名がugc-moderationの措置の表示名と一致する', () => {
    expect(REPORT_RESOLUTION_LABELS['product.hide']).toBe(
      MODERATION_ACTION_LABELS['product.hide'],
    );
    expect(REPORT_RESOLUTION_LABELS['comment.hide']).toBe(
      MODERATION_ACTION_LABELS['comment.hide'],
    );
    expect(REPORT_RESOLUTION_LABELS['user.suspend']).toBe(
      MODERATION_ACTION_LABELS['user.suspend'],
    );
  });

  test('目標の超過の表示名', () => {
    expect(RESPONSE_TIME_ALERT_LABELS).toEqual({
      'start-overdue': '確認開始の目標(1営業日)を超えています',
      'decision-overdue': '判断の目標(9日)を超えています',
    });
    expect(Object.isFrozen(RESPONSE_TIME_ALERT_LABELS)).toBe(true);
  });
});
