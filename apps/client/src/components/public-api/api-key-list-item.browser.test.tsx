import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import {
  API_KEY_CREATED_AT,
  API_KEY_CREATED_AT_TEXT,
  apiKeyOf,
} from './api-key-list-fixtures.ts';
import {
  type ApiKeyActionRequest,
  type ApiKeyDisabledActions,
  ApiKeyListItem,
} from './api-key-list-item.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const API_KEY = apiKeyOf(1, { name: '集計スクリプト' });

type ActionMock = ReturnType<
  typeof vi.fn<(request: ApiKeyActionRequest) => void>
>;

interface HarnessProps {
  readonly apiKey: ApiKeyFieldsFragment;
  readonly disabledActions?: ApiKeyDisabledActions;
  readonly onAction: ActionMock;
}

const renderItem = ({ apiKey, disabledActions, onAction }: HarnessProps) =>
  render(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <h1>APIキー</h1>
        <ul aria-label="APIキーの一覧">
          <ApiKeyListItem
            apiKey={apiKey}
            disabledActions={disabledActions}
            onAction={onAction}
          />
        </ul>
      </main>
    </DisplayPreferencesProvider>,
  );

// 表示中に停止中へ変わる(操作の失敗で停止中を知る)場面を再現する
function SuspendingHarness({ onAction }: { readonly onAction: ActionMock }) {
  const [suspended, setSuspended] = useState(false);
  return (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <ul aria-label="APIキーの一覧">
          <ApiKeyListItem
            apiKey={API_KEY}
            disabledActions={
              suspended ? { edit: true, reissue: true } : undefined
            }
            onAction={(request) => {
              onAction(request);
              setSuspended(true);
            }}
          />
        </ul>
        <button type="button">次の操作</button>
      </main>
    </DisplayPreferencesProvider>
  );
}

const item = () => page.getByRole('listitem');

const scopeSummary = () => item().getByRole('definition').first();

const actionButton = (name: string) => item().getByRole('button', { name });

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('ApiKeyListItem', () => {
  test('見出しに名前を示し、項目「権限」と「発行日時」を並べる', async () => {
    await renderItem({ apiKey: API_KEY, onAction: vi.fn() });

    await expect
      .element(item().getByRole('heading', { level: 2 }))
      .toHaveTextContent('集計スクリプト');
    const terms = item().getByRole('term');
    expect(terms.elements().map((term) => term.textContent)).toStrictEqual([
      '権限',
      '発行日時',
    ]);
  });

  test('権限の要約は値ごとに1行で、機能の表示名を表示の順に並べ無効の機能を示さない', async () => {
    await renderItem({
      apiKey: apiKeyOf(1, {
        scopes: {
          products: 'READ',
          launches: 'READ',
          upvotes: 'NONE',
          comments: 'NONE',
          ratings: 'NONE',
          profile: 'READ_WRITE',
          productDescriptions: 'NONE',
        },
      }),
      onAction: vi.fn(),
    });

    const lines = scopeSummary().element().children;
    expect([...lines].map((line) => line.textContent)).toStrictEqual([
      '読み取り: プロダクト、ローンチ履歴',
      '読み書き: プロフィール',
    ]);
  });

  test('全ての機能が無効なら権限の要約を「権限なし」にする', async () => {
    await renderItem({
      apiKey: apiKeyOf(1, {
        scopes: {
          products: 'NONE',
          launches: 'NONE',
          upvotes: 'NONE',
          comments: 'NONE',
          ratings: 'NONE',
          profile: 'NONE',
          productDescriptions: 'NONE',
        },
      }),
      onAction: vi.fn(),
    });

    await expect.element(scopeSummary()).toHaveTextContent(/^権限なし$/);
  });

  test('発行日時を年と曜日を含む日付と時刻で<time datetime>に示す', async () => {
    await renderItem({ apiKey: API_KEY, onAction: vi.fn() });

    const time = item().getByText(API_KEY_CREATED_AT_TEXT, { exact: true });
    await expect.element(time).toBeVisible();
    expect(time.element().tagName).toBe('TIME');
    await expect.element(time).toHaveAttribute('datetime', API_KEY_CREATED_AT);
  });

  test('操作の読み上げの名前に対象のキーの名前を含め、見えている文言は操作名にする', async () => {
    await renderItem({ apiKey: API_KEY, onAction: vi.fn() });

    const buttons = item().getByRole('button');
    expect(
      buttons
        .elements()
        .map((button) => [
          button.getAttribute('aria-label'),
          button.textContent,
        ]),
    ).toStrictEqual([
      ['集計スクリプトを編集', '編集'],
      ['集計スクリプトを再発行', '再発行'],
      ['集計スクリプトを削除', '削除'],
    ]);
  });

  test.each([
    ['edit', '集計スクリプトを編集'],
    ['reissue', '集計スクリプトを再発行'],
    ['delete', '集計スクリプトを削除'],
  ] as const)(
    '操作%sの押下を、対象のキーと押したボタンとともに親へ渡す',
    async (action, name) => {
      const onAction: ActionMock = vi.fn();
      await renderItem({ apiKey: API_KEY, onAction });

      await actionButton(name).click();

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith({
        action,
        apiKey: API_KEY,
        trigger: actionButton(name).element(),
      });
    },
  );

  test('無効にした「編集」「再発行」は押せず、「削除」は押せる', async () => {
    const onAction: ActionMock = vi.fn();
    await renderItem({
      apiKey: API_KEY,
      disabledActions: { edit: true, reissue: true },
      onAction,
    });

    await expect.element(actionButton('集計スクリプトを編集')).toBeDisabled();
    await expect.element(actionButton('集計スクリプトを再発行')).toBeDisabled();
    await expect.element(actionButton('集計スクリプトを削除')).toBeEnabled();

    await actionButton('集計スクリプトを削除').click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0].action).toBe('delete');
  });

  test('フォーカスのある操作が表示中に無効になった時は、フォーカスが離れるまでaria-disabledにして押しても親へ渡さない', async () => {
    const onAction: ActionMock = vi.fn();
    await render(<SuspendingHarness onAction={onAction} />);
    const edit = actionButton('集計スクリプトを編集');

    await edit.click();

    await expect.element(edit).toHaveAttribute('aria-disabled', 'true');
    await expect.element(edit).not.toHaveAttribute('disabled');
    await expect.element(edit).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledTimes(1);

    await userEvent.tab();

    await expect.element(edit).toBeDisabled();
    await expect.element(edit).not.toHaveAttribute('aria-disabled');
    await expect.element(actionButton('集計スクリプトを再発行')).toBeDisabled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each<[string, ApiKeyDisabledActions | undefined]>([
      ['通常', undefined],
      ['停止中', { edit: true, reissue: true }],
    ])('%sの項目にアクセシビリティの違反が無い', async (_label, disabled) => {
      await renderItem({
        apiKey: API_KEY,
        disabledActions: disabled,
        onAction: vi.fn(),
      });

      await expect.element(item()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
