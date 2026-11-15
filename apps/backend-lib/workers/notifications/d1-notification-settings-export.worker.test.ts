import { beforeEach, describe, expect, test } from 'vitest';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import type { SuppressionReason } from '../../core/email/suppression-policy.ts';
import type { NoticeSuppressionReason } from '../../core/notifications/notice-copy.ts';
import type { Clock } from '../../core/time/clock.ts';
import { createSuppressionRepository } from '../email/suppression-repository.ts';
import { D1UserContactDirectory } from '../identity/d1-user-contact-directory.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSettingsExport } from './d1-notification-settings-export.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertRecipient,
  recipientIdOf,
  T0,
} from './testing/notification-store-fixtures.ts';

const NOW = new Date('2026-11-14T03:00:00.000Z');

const HOUR_MILLISECONDS = 3_600_000;

const clock: Clock = { now: () => new Date(NOW) };

const preferences = new D1NotificationPreferenceStore(db);

const suppressions = createSuppressionRepository(db, clock);

const settingsExport = new D1NotificationSettingsExport(
  preferences,
  new D1UserContactDirectory(db),
  suppressions,
);

async function setPreferences(
  index: number,
  enabled: Partial<Record<NotificationTopic, boolean>>,
): Promise<void> {
  for (const [topic, value] of Object.entries(enabled) as [
    NotificationTopic,
    boolean,
  ][]) {
    await preferences.setPreference({
      userId: recipientIdOf(index),
      topic,
      enabled: value,
      at: T0,
    });
  }
}

async function suppress(
  address: string,
  reason: SuppressionReason,
  expiresAt: Date | null,
): Promise<void> {
  await suppressions.record(address, {
    lastReason: reason,
    lastEventAt: T0,
    expiresAt,
  });
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await clearNotificationTables();
});

describe('D1NotificationSettingsExport', () => {
  describe('find', () => {
    test('4種別の受信可否を返し、設定の行が無い種別は受信しないとする', async () => {
      await insertRecipient(1, { emailVerifiedAt: T0 });
      await setPreferences(1, {
        match_preview: true,
        match_result: false,
        followed_user_award: true,
      });

      await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
        matchPreview: true,
        matchResult: false,
        followedUserMatch: false,
        followedUserAward: true,
        suppressedReason: null,
      });
    });

    test('設定の行が1つも無い利用者は4種別とも受信しないとする', async () => {
      await insertRecipient(1);

      await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
        matchPreview: false,
        matchResult: false,
        followedUserMatch: false,
        followedUserAward: false,
        suppressedReason: null,
      });
    });

    test('他の利用者の受信設定と抑止を混ぜない', async () => {
      await insertRecipient(1, { email: 'first@mail.example' });
      await insertRecipient(2, { email: 'second@mail.example' });
      await setPreferences(2, {
        match_preview: true,
        match_result: true,
        followed_user_match: true,
        followed_user_award: true,
      });
      await suppress('second@mail.example', 'complaint', null);

      await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
        matchPreview: false,
        matchResult: false,
        followedUserMatch: false,
        followedUserAward: false,
        suppressedReason: null,
      });
    });

    test.each([
      ['hard_bounce', 'bounce'],
      ['complaint', 'complaint'],
      ['rejected', 'rejected'],
    ] as const satisfies readonly (readonly [
      SuppressionReason,
      NoticeSuppressionReason,
    ])[])(
      '連絡先のメールアドレスが抑止の理由%sで除外されていれば%sを返す',
      async (reason, expected) => {
        await insertRecipient(1, { email: 'owner@mail.example' });
        await setPreferences(1, { match_result: true });
        await suppress(
          'owner@mail.example',
          reason,
          new Date(NOW.getTime() + HOUR_MILLISECONDS),
        );

        await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
          matchPreview: false,
          matchResult: true,
          followedUserMatch: false,
          followedUserAward: false,
          suppressedReason: expected,
        });
      },
    );

    test('大文字を含む連絡先のメールアドレスも照合キーで抑止を見つける', async () => {
      await insertRecipient(1, { email: 'Owner.Name@Mail.Example' });
      await suppress('owner.name@mail.example', 'hard_bounce', null);

      await expect(
        settingsExport.find(recipientIdOf(1)),
      ).resolves.toMatchObject({ suppressedReason: 'bounce' });
    });

    test('抑止の期限が過ぎていれば除外されていないとしてnullを返す', async () => {
      await insertRecipient(1, { email: 'owner@mail.example' });
      await suppress(
        'owner@mail.example',
        'rejected',
        new Date(NOW.getTime() - HOUR_MILLISECONDS),
      );

      await expect(
        settingsExport.find(recipientIdOf(1)),
      ).resolves.toMatchObject({ suppressedReason: null });
    });

    test('停止中の利用者も出力の対象として返す', async () => {
      await insertRecipient(1, {
        emailVerifiedAt: T0,
        status: 'suspended',
        suspendedAt: after(1),
      });
      await setPreferences(1, { followed_user_match: true });

      await expect(settingsExport.find(recipientIdOf(1))).resolves.toEqual({
        matchPreview: false,
        matchResult: false,
        followedUserMatch: true,
        followedUserAward: false,
        suppressedReason: null,
      });
    });

    test('退会済みの利用者は受信設定や抑止が残っていてもundefinedを返す', async () => {
      await insertRecipient(1, {
        email: 'owner@mail.example',
        deletedAt: after(1),
      });
      await setPreferences(1, { match_preview: true });
      await suppress('owner@mail.example', 'complaint', null);

      await expect(
        settingsExport.find(recipientIdOf(1)),
      ).resolves.toBeUndefined();
    });

    test('存在しない利用者はundefinedを返す', async () => {
      await expect(
        settingsExport.find(recipientIdOf(999)),
      ).resolves.toBeUndefined();
    });
  });
});
