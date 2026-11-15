import { describe, expect, test } from 'bun:test';

import {
  NOTIFICATION_TOPIC_COPY,
  NOTIFICATION_TOPICS,
} from './notification-topics.ts';

describe('NOTIFICATION_TOPICS', () => {
  test('マッチ開始予告・勝敗結果・フォロー中ユーザーのマッチ開催・受賞結果の4つの種別をこの順に持つ', () => {
    expect(NOTIFICATION_TOPICS).toEqual([
      'match_preview',
      'match_result',
      'followed_user_match',
      'followed_user_award',
    ]);
  });

  test('凍結されていて実行時に種別を追加できない', () => {
    expect(Object.isFrozen(NOTIFICATION_TOPICS)).toBe(true);
  });
});

describe('NOTIFICATION_TOPIC_COPY', () => {
  test('4つの種別の名称と説明を文言規則の文言で持つ', () => {
    expect(NOTIFICATION_TOPIC_COPY).toEqual({
      match_preview: {
        label: 'マッチ開始予告',
        description:
          '自分のプロダクトのマッチの前日の夜に、対戦相手と開始時刻をお知らせします。',
      },
      match_result: {
        label: '勝敗結果',
        description:
          '自分のプロダクトのマッチの当日の夜に、結果をお知らせします。勝ち進んだ場合は翌日のマッチの予告もまとめてお送りします。',
      },
      followed_user_match: {
        label: 'フォロー中ユーザーのマッチ開催',
        description:
          'フォローしているユーザーのプロダクトのマッチが始まったら、その日の分を1通にまとめてお知らせします。',
      },
      followed_user_award: {
        label: 'フォロー中ユーザーの受賞結果',
        description:
          'フォローしているユーザーのプロダクトがProduct of the Week・Product of the Yearを受賞したらお知らせします。',
      },
    });
  });

  test('種別の並びがNOTIFICATION_TOPICSと同じになる', () => {
    expect(Object.keys(NOTIFICATION_TOPIC_COPY)).toEqual([
      ...NOTIFICATION_TOPICS,
    ]);
  });

  test('対応と各種別の文言は凍結されている', () => {
    expect(Object.isFrozen(NOTIFICATION_TOPIC_COPY)).toBe(true);
    for (const topic of NOTIFICATION_TOPICS) {
      expect(Object.isFrozen(NOTIFICATION_TOPIC_COPY[topic])).toBe(true);
    }
  });
});
