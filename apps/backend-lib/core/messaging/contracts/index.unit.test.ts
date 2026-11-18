import { describe, expect, test } from 'bun:test';

import { EMAIL_SEND_MESSAGE } from '../../email/send-message.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../media/media-messages.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../payments/refund-message.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../ultras/activation-message.ts';
import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from './identity.ts';
import { MESSAGE_CONTRACTS } from './index.ts';
import { RUN_MATCH_EVENT_MESSAGE } from './match.ts';
import {
  EXPAND_NOTIFICATION_EVENT_MESSAGE,
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
} from './notifications.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from './product.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from './search-index-refresh.ts';
import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from './sponsorship.ts';

describe('MESSAGE_CONTRACTS', () => {
  test('集約した契約に種別の重複が無い', () => {
    const types = MESSAGE_CONTRACTS.map((contract) => contract.type);
    const duplicatedTypes = types.filter(
      (type, index) => types.indexOf(type) !== index,
    );

    expect(duplicatedTypes).toEqual([]);
  });

  test('メール送信の契約email.sendを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(EMAIL_SEND_MESSAGE);
  });

  test('索引の更新の契約search-index.refreshを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(SEARCH_INDEX_REFRESH_MESSAGE);
  });

  test.each([
    ['画像の判定の契約media.moderate-image', MODERATE_IMAGE_MESSAGE],
    ['保存先の移動の契約media.relocate-files', RELOCATE_FILES_MESSAGE],
    [
      'キャッシュのパージの契約media.purge-image-cache',
      PURGE_IMAGE_CACHE_MESSAGE,
    ],
  ])('%sを集約している', (_label, contract) => {
    expect(MESSAGE_CONTRACTS).toContain(contract);
  });

  test.each([
    [
      'ライフサイクルの実行の契約identity.run-user-lifecycle',
      RUN_USER_LIFECYCLE_MESSAGE,
    ],
    [
      '使い捨て判定のやり直しの契約identity.recheck-disposable-email',
      RECHECK_DISPOSABLE_EMAIL_MESSAGE,
    ],
  ])('%sを集約している', (_label, contract) => {
    expect(MESSAGE_CONTRACTS).toContain(contract);
  });

  test('返金の実行の契約payments.refund-paymentを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(PAYMENTS_REFUND_MESSAGE);
  });

  test('加入が有効になった知らせの処理の契約ultras.run-activation-handlersを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE);
  });

  test('プロダクトライフサイクルの実行の契約product.run-product-lifecycleを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(RUN_PRODUCT_LIFECYCLE_MESSAGE);
  });

  test('マッチイベントの実行の契約match.run-match-eventを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(RUN_MATCH_EVENT_MESSAGE);
  });

  test.each([
    [
      '送信枠の送り出しの契約notifications.flush-slot',
      FLUSH_NOTIFICATION_SLOT_MESSAGE,
    ],
    [
      '通知イベントの展開の契約notifications.expand-event',
      EXPAND_NOTIFICATION_EVENT_MESSAGE,
    ],
  ])('%sを集約している', (_label, contract) => {
    expect(MESSAGE_CONTRACTS).toContain(contract);
  });

  test.each([
    [
      'スポンサー広告の通知の送信の契約sponsorship.dispatch-notices',
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
    ],
    [
      'スポンサー広告の掲載の終わりの精算の契約sponsorship.settle-period-end',
      SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
    ],
  ])('%sを集約している', (_label, contract) => {
    expect(MESSAGE_CONTRACTS).toContain(contract);
  });

  test('集約点は凍結されていて実行時に契約を追加できない', () => {
    expect(Object.isFrozen(MESSAGE_CONTRACTS)).toBe(true);
  });
});
