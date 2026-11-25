import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { DataExportFieldsFragment } from '../../graphql/generated/graphql.ts';
import { DataExportItem } from './data-export-item.tsx';
import {
  dataExportIdOf,
  EXPORT_COMPLETED_AT,
  EXPORT_COMPLETED_AT_TEXT,
  EXPORT_EXPIRES_AT,
  EXPORT_EXPIRES_AT_TEXT,
  EXPORT_FAILED_AT,
  EXPORT_FAILED_AT_TEXT,
  EXPORT_FILE_NAME,
  EXPORT_REQUESTED_AT,
  EXPORT_REQUESTED_AT_TEXT,
  EXPORT_SIZE_TEXT,
  expiredExportOf,
  failedExportOf,
  pendingExportOf,
  readyExportOf,
} from './data-export-fixtures.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const EXPIRED_MESSAGE =
  '有効期限を過ぎたため削除しました。必要な場合はもう一度要求してください。';
const FAILED_MESSAGE = 'エクスポートに失敗しました。もう一度要求してください。';
const TOO_LARGE_MESSAGE =
  'データが大きすぎるためエクスポートできませんでした。';

const renderItem = (item: DataExportFieldsFragment): Promise<unknown> => {
  const element: ReactNode = (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <ul>
          <DataExportItem item={item} />
        </ul>
      </main>
    </DisplayPreferencesProvider>
  );
  return renderInRouter(element, { path: '/settings/export' });
};

const entry = () => page.getByRole('listitem');
const downloadLink = () =>
  entry().getByRole('link', { name: /^ダウンロード/u });
const timeOf = (label: string) =>
  entry()
    .getByText(label, { exact: true })
    .element()
    .nextElementSibling?.querySelector('time') ?? null;

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('DataExportItem', () => {
  test('作成中は、状態を文言で示し、要求日時だけを`<time datetime>`で示し、ダウンロードのリンクを出さない', async () => {
    await renderItem(pendingExportOf(1));

    await expect.element(entry()).toHaveTextContent('作成中');
    const requestedAt = timeOf('要求日時');
    expect(requestedAt?.dateTime).toBe(EXPORT_REQUESTED_AT);
    expect(requestedAt?.textContent).toBe(EXPORT_REQUESTED_AT_TEXT);
    const text = entry().element().textContent;
    expect(text).not.toContain('完了日時');
    expect(text).not.toContain('有効期限');
    expect(text).not.toContain('失敗日時');
    expect(entry().getByRole('link').elements()).toHaveLength(0);
  });

  test('完了は、完了日時・有効期限・ファイル名・1,024を基数とする大きさを示し、`download`属性の無いダウンロードのリンクを出す', async () => {
    await renderItem(readyExportOf(2));

    await expect.element(entry()).toHaveTextContent('完了');
    expect(timeOf('完了日時')?.dateTime).toBe(EXPORT_COMPLETED_AT);
    expect(timeOf('完了日時')?.textContent).toBe(EXPORT_COMPLETED_AT_TEXT);
    expect(timeOf('有効期限')?.dateTime).toBe(EXPORT_EXPIRES_AT);
    expect(timeOf('有効期限')?.textContent).toBe(EXPORT_EXPIRES_AT_TEXT);
    await expect
      .element(entry().getByText(EXPORT_FILE_NAME, { exact: true }))
      .toBeVisible();
    await expect
      .element(entry().getByText(EXPORT_SIZE_TEXT, { exact: true }))
      .toBeVisible();
    const link = downloadLink();
    await expect
      .element(link)
      .toHaveAccessibleName(`ダウンロード(${EXPORT_SIZE_TEXT})`);
    await expect
      .element(link)
      .toHaveAttribute('href', `/_bff/exports/${dataExportIdOf(2)}`);
    expect(link.element().hasAttribute('download')).toBe(false);
    await expect
      .element(entry())
      .toHaveTextContent(`${EXPORT_EXPIRES_AT_TEXT}までダウンロードできます`);
  });

  test('完了でダウンロードの経路が無ければ、リンクを出さない', async () => {
    await renderItem(readyExportOf(3, { downloadPath: null }));

    await expect.element(entry()).toHaveTextContent('完了');
    expect(entry().getByRole('link').elements()).toHaveLength(0);
  });

  test('完了で大きさのバイト数が無ければ、大きさを添えないダウンロードのリンクを出す', async () => {
    await renderItem(readyExportOf(3, { byteSize: null }));

    await expect.element(downloadLink()).toHaveAccessibleName('ダウンロード');
  });

  test('期限切れは、完了日時・有効期限・ファイル名・大きさを残して削除した旨を示し、ダウンロードのリンクを出さない', async () => {
    await renderItem(expiredExportOf(4));

    await expect.element(entry()).toHaveTextContent('期限切れ');
    expect(timeOf('完了日時')?.dateTime).toBe(EXPORT_COMPLETED_AT);
    expect(timeOf('有効期限')?.dateTime).toBe(EXPORT_EXPIRES_AT);
    await expect
      .element(entry().getByText(EXPORT_FILE_NAME, { exact: true }))
      .toBeVisible();
    await expect
      .element(entry().getByText(EXPORT_SIZE_TEXT, { exact: true }))
      .toBeVisible();
    await expect.element(entry()).toHaveTextContent(EXPIRED_MESSAGE);
    expect(entry().getByRole('link').elements()).toHaveLength(0);
    expect(entry().element().textContent).not.toContain(
      'までダウンロードできます',
    );
  });

  test('失敗は、失敗日時と再要求の案内を示し、ダウンロードのリンクも問い合わせのリンクも出さない', async () => {
    await renderItem(failedExportOf(5, 'ERROR'));

    await expect.element(entry()).toHaveTextContent('失敗');
    expect(timeOf('失敗日時')?.dateTime).toBe(EXPORT_FAILED_AT);
    expect(timeOf('失敗日時')?.textContent).toBe(EXPORT_FAILED_AT_TEXT);
    await expect.element(entry()).toHaveTextContent(FAILED_MESSAGE);
    expect(entry().getByRole('link').elements()).toHaveLength(0);
  });

  test('大きすぎて失敗した要求は、その旨と問い合わせへのリンクを示す', async () => {
    await renderItem(failedExportOf(6, 'TOO_LARGE'));

    await expect
      .element(entry())
      .toHaveTextContent(`${TOO_LARGE_MESSAGE}お問い合わせください。`);
    await expect
      .element(entry().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    expect(entry().element().textContent).not.toContain(FAILED_MESSAGE);
  });

  test('大きさのバイト数が無い期限切れは、大きさの項目を出さない', async () => {
    await renderItem(expiredExportOf(7, { byteSize: null }));

    expect(entry().element().textContent).not.toContain('大きさ');
    await expect.element(entry()).toHaveTextContent(EXPIRED_MESSAGE);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['作成中', pendingExportOf(1)],
      ['完了', readyExportOf(2)],
      ['期限切れ', expiredExportOf(3)],
      ['失敗', failedExportOf(4, 'ERROR')],
      ['大きすぎる失敗', failedExportOf(5, 'TOO_LARGE')],
    ])('%sの項目で、アクセシビリティの検査の違反が0件', async (_name, item) => {
      applyColorScheme(scheme);
      await renderItem(item);
      await expect.element(entry()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
