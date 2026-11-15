import { useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  notificationSettings,
  SAVED_MESSAGE,
  updatedNotificationSettingsResult,
} from '../../../test/notification-settings-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import {
  ClientUpdateNotificationPreferenceDocument,
  type NotificationSettingsFragment,
} from '../../graphql/generated/graphql.ts';
import {
  notificationSettingsQueryOptions,
  toNotificationSettingsView,
} from '../../graphql/notification-settings.ts';
import { NotificationTopicSwitch } from './notification-topic-switch.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const RESULT_LABEL = '勝敗結果';

const AWARD_LABEL = 'フォロー中ユーザーの受賞結果';

const RESULT_DESCRIPTION =
  '自分のプロダクトのマッチの当日の夜に、結果をお知らせします。勝ち進んだ場合は翌日のマッチの予告もまとめてお送りします。';

const UNAVAILABLE_MESSAGE =
  'このアカウントは現在ご利用いただけません。お問い合わせください。';

// 部品の親と同じく、キャッシュの通知設定から受信可否と変更の可否を読んで描く
function SwitchFromCache({ topic }: { readonly topic: NotificationTopic }) {
  const { data } = useSuspenseQuery({
    ...notificationSettingsQueryOptions(VIEWER_ID),
    select: toNotificationSettingsView,
  });
  const preference = data.preferences.find((item) => item.topic === topic);
  return (
    <NotificationTopicSwitch
      viewerId={VIEWER_ID}
      topic={topic}
      enabled={preference?.enabled ?? false}
      editable={data.editable}
    />
  );
}

const renderSwitches = async (
  topics: readonly NotificationTopic[],
  settings: NotificationSettingsFragment = notificationSettings(),
) => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    notificationSettingsQueryOptions(VIEWER_ID).queryKey,
    settings,
  );
  await renderInRouter(
    <>
      {topics.map((topic) => (
        <SwitchFromCache key={topic} topic={topic} />
      ))}
      <Toaster />
    </>,
    { context, cachedViewer: signedInViewerQuery() },
  );
  return context;
};

const renderSwitch = async (
  settings: NotificationSettingsFragment = notificationSettings(),
) => renderSwitches(['match_result'], settings);

const resultSwitch = () => page.getByRole('switch', { name: RESULT_LABEL });

const awardSwitch = () => page.getByRole('switch', { name: AWARD_LABEL });

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('NotificationTopicSwitch', () => {
  test('通知種別の名称をスイッチの名前に、説明を補足の説明に結び付け、受信可否を示す', async () => {
    await renderSwitch(
      notificationSettings({ enabledTopics: ['MATCH_RESULT'] }),
    );

    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(resultSwitch())
      .toHaveAccessibleDescription(RESULT_DESCRIPTION);
    await expect.element(resultSwitch()).toBeEnabled();
    await expect.element(resultSwitch()).not.toHaveAttribute('aria-busy');
  });

  test('切り替えるとその通知種別の受信可否だけを送り、成功でサーバーのその種別の値をスイッチとキャッシュに反映して保存した旨を通知する', async () => {
    executeGraphQL.mockResolvedValue(
      updatedNotificationSettingsResult(
        notificationSettings({
          enabledTopics: ['MATCH_RESULT', 'FOLLOWED_USER_AWARD'],
          emailVerified: false,
        }),
      ),
    );
    const context = await renderSwitch();

    await userEvent.click(resultSwitch());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'true');
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientUpdateNotificationPreferenceDocument,
      { input: { topic: 'MATCH_RESULT', enabled: true } },
      { turnstileToken: undefined },
    );
    expect(
      context.queryClient.getQueryData(
        notificationSettingsQueryOptions(VIEWER_ID).queryKey,
      ),
    ).toStrictEqual(notificationSettings({ enabledTopics: ['MATCH_RESULT'] }));
  });

  test('2つの通知種別を同時に保存し、後から届いた応答に先の種別の古い値があっても、両方のスイッチとキャッシュが保存した値を示す', async () => {
    const resultSaved = deferred<unknown>();
    const awardSaved = deferred<unknown>();
    executeGraphQL
      .mockReturnValueOnce(resultSaved.promise)
      .mockReturnValueOnce(awardSaved.promise);
    const context = await renderSwitches(
      ['match_result', 'followed_user_award'],
      notificationSettings({ suppression: { reason: 'BOUNCE', until: null } }),
    );

    await userEvent.click(resultSwitch());
    await userEvent.click(awardSwitch());
    await expect.element(awardSwitch()).toHaveAttribute('aria-busy', 'true');
    resultSaved.resolve(
      updatedNotificationSettingsResult(
        notificationSettings({ enabledTopics: ['MATCH_RESULT'] }),
      ),
    );
    await expect.element(resultSwitch()).not.toHaveAttribute('aria-busy');
    awardSaved.resolve(
      updatedNotificationSettingsResult(
        notificationSettings({ enabledTopics: ['FOLLOWED_USER_AWARD'] }),
      ),
    );

    await expect.element(awardSwitch()).not.toHaveAttribute('aria-busy');
    await expect.element(awardSwitch()).toHaveAttribute('aria-checked', 'true');
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'true');
    expect(
      context.queryClient.getQueryData(
        notificationSettingsQueryOptions(VIEWER_ID).queryKey,
      ),
    ).toStrictEqual(
      notificationSettings({
        enabledTopics: ['MATCH_RESULT', 'FOLLOWED_USER_AWARD'],
        suppression: { reason: 'BOUNCE', until: null },
      }),
    );
  });

  test('送信中は`disabled`にせず`aria-disabled`と`aria-busy`にし、フォーカスを保ったまま重ねての押下を無視する', async () => {
    const pending = deferred<unknown>();
    executeGraphQL.mockReturnValue(pending.promise);
    await renderSwitch();
    (resultSwitch().element() as HTMLElement).focus();

    await userEvent.keyboard(' ');

    await expect.element(resultSwitch()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(resultSwitch()).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(resultSwitch().element());
    await userEvent.keyboard(' ');
    await userEvent.click(resultSwitch(), { force: true });
    expect(executeGraphQL).toHaveBeenCalledTimes(1);

    pending.resolve(
      updatedNotificationSettingsResult(
        notificationSettings({ enabledTopics: ['MATCH_RESULT'] }),
      ),
    );

    await expect.element(resultSwitch()).not.toHaveAttribute('aria-busy');
    await expect.element(resultSwitch()).not.toHaveAttribute('aria-disabled');
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(resultSwitch().element());
  });

  test('保存を拒否されたら、スイッチを操作の前の状態に戻し、理由の文言を通知する', async () => {
    executeGraphQL.mockResolvedValue({
      ok: false,
      error: new GraphQLClientError({
        code: 'account_unavailable',
        message: UNAVAILABLE_MESSAGE,
        status: 403,
      }),
    });
    await renderSwitch();

    await userEvent.click(resultSwitch());

    await expect.element(page.getByText(UNAVAILABLE_MESSAGE)).toBeVisible();
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'false');
    await expect.element(resultSwitch()).not.toHaveAttribute('aria-busy');
    expect(page.getByText(SAVED_MESSAGE).query()).toBeNull();
  });

  test('想定外の失敗では、問い合わせを促す想定外のエラーの文言を通知し、操作の前の状態に戻す', async () => {
    executeGraphQL.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderSwitch(
      notificationSettings({ enabledTopics: ['MATCH_RESULT'] }),
    );

    await userEvent.click(resultSwitch());

    await expect
      .element(page.getByText(UNEXPECTED_ERROR_MESSAGE))
      .toBeVisible();
    await expect
      .element(resultSwitch())
      .toHaveAttribute('aria-checked', 'true');
  });

  test('変更できない利用者にはスイッチを無効にし、押しても送らない', async () => {
    await renderSwitch(notificationSettings({ editable: false }));

    await expect.element(resultSwitch()).toBeDisabled();
    await userEvent.click(resultSwitch(), { force: true });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['変更できる', notificationSettings({ enabledTopics: ['MATCH_RESULT'] })],
      ['変更できない', notificationSettings({ editable: false })],
    ])(
      '%sスイッチで、アクセシビリティの検査の違反が0件',
      async (_label, settings) => {
        await renderSwitch(settings);

        await expect.element(resultSwitch()).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );

    test('送信中のスイッチで、アクセシビリティの検査の違反が0件', async () => {
      executeGraphQL.mockReturnValue(deferred<unknown>().promise);
      await renderSwitch();

      await userEvent.click(resultSwitch());

      await expect.element(resultSwitch()).toHaveAttribute('aria-busy', 'true');
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
