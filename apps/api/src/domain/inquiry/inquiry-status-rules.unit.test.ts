import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_STATUSES,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import {
  checkReplyable,
  checkStatusChangeable,
  statusAfterUserMessage,
} from './inquiry-status-rules.ts';

describe('statusAfterUserMessage', () => {
  test.each([{ current: 'resolved' }, { current: 'rejected' }] as const)(
    '$currentの問い合わせは利用者の送信でopenへ戻る',
    ({ current }) => {
      expect(statusAfterUserMessage(current)).toBe('open');
    },
  );

  test.each([{ current: 'open' }, { current: 'in_progress' }] as const)(
    '$currentの問い合わせは利用者の送信で変わらない',
    ({ current }) => {
      expect(statusAfterUserMessage(current)).toBe(current);
    },
  );
});

describe('checkReplyable', () => {
  test('退会していないログインの問い合わせへは返信できる', () => {
    expect(
      checkReplyable({ kind: 'member', withdrawn: false }),
    ).toBeUndefined();
  });

  test('退会済みのログインの問い合わせへの返信はwithdrawnで拒否する', () => {
    expect(checkReplyable({ kind: 'member', withdrawn: true })).toBe(
      'withdrawn',
    );
  });

  test('未ログインの問い合わせへの返信はguest-not-repliableで拒否する', () => {
    expect(checkReplyable({ kind: 'guest', withdrawn: false })).toBe(
      'guest-not-repliable',
    );
  });

  test('未ログインの問い合わせは退会済みの印に関わらずguest-not-repliableで拒否する', () => {
    expect(checkReplyable({ kind: 'guest', withdrawn: true })).toBe(
      'guest-not-repliable',
    );
  });
});

describe('checkStatusChangeable', () => {
  const otherStatusPairs = INQUIRY_STATUSES.flatMap((status) =>
    INQUIRY_STATUSES.filter((next) => next !== status).map((next) => ({
      status,
      next,
    })),
  );

  test.each(otherStatusPairs)(
    '退会していない$statusの問い合わせは別の値の$nextへ変更できる',
    ({ status, next }) => {
      expect(
        checkStatusChangeable({ withdrawn: false, status }, next),
      ).toBeUndefined();
    },
  );

  test.each(INQUIRY_STATUSES.map((status) => ({ status })))(
    '$statusから同じ値への変更はunchangedで拒否する',
    ({ status }) => {
      expect(checkStatusChangeable({ withdrawn: false, status }, status)).toBe(
        'unchanged',
      );
    },
  );

  test.each(otherStatusPairs)(
    '退会済みの$statusの問い合わせは$nextへの変更をwithdrawnで拒否する',
    ({ status, next }) => {
      expect(checkStatusChangeable({ withdrawn: true, status }, next)).toBe(
        'withdrawn',
      );
    },
  );

  test('退会済みで同じ値への変更は退会済みの理由を優先して拒否する', () => {
    const status: InquiryStatus = 'open';

    expect(checkStatusChangeable({ withdrawn: true, status }, status)).toBe(
      'withdrawn',
    );
  });
});
