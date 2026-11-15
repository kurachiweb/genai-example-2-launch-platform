import { describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { AdminLegalDraftView } from '../../graphql/admin-legal-documents.ts';
import { LegalDraftStatus } from './legal-draft-status.tsx';

const SAVED_AT = '2026-11-03T01:02:03.000Z';

const DRAFT: AdminLegalDraftView = Object.freeze({
  body: '下書きの本文',
  savedAt: SAVED_AT,
  savedBy: { id: '01JC0ADMIN000000000000000000', nickname: '運営の担当' },
});

const DRAFT_BY_DELETED_ADMIN: AdminLegalDraftView = Object.freeze({
  ...DRAFT,
  savedBy: { id: '01JC0ADMIN0000000000000000DD', nickname: null },
});

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

// 日時の部品はアプリの文書の外枠が置く表示設定の内側で描く
const renderStatus = (draft: AdminLegalDraftView | null) =>
  render(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <LegalDraftStatus draft={draft} />
    </DisplayPreferencesProvider>,
  );

const valueOf = (term: string) => {
  const termElement = [...document.querySelectorAll('dt')].find(
    (element) => element.textContent === term,
  );
  return termElement?.nextElementSibling;
};

describe('下書きの状態', () => {
  test('下書きがあれば、その旨と年を含む最後の保存の日時・保存した管理者のニックネームを表示する', async () => {
    await renderStatus(DRAFT);

    await expect.element(page.getByText('下書きがあります')).toBeVisible();
    const savedAt = valueOf('最後に保存した日時')?.querySelector('time');
    expect(savedAt?.getAttribute('datetime')).toBe(SAVED_AT);
    expect(savedAt?.textContent).toContain('2026');
    expect(valueOf('保存した管理者')?.textContent).toBe('運営の担当');
    await expect
      .element(page.getByText('下書きはありません'))
      .not.toBeInTheDocument();
  });

  test('保存した管理者が削除済みなら、ニックネームに代えて削除済みの管理者である旨を表示する', async () => {
    await renderStatus(DRAFT_BY_DELETED_ADMIN);

    expect(valueOf('保存した管理者')?.textContent).toBe('削除済みの管理者');
  });

  test('下書きが無ければ、その旨だけを表示する', async () => {
    await renderStatus(null);

    await expect.element(page.getByText('下書きはありません')).toBeVisible();
    await expect
      .element(page.getByText('下書きがあります'))
      .not.toBeInTheDocument();
    expect(document.querySelector('time')).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([
    ['下書きがある', DRAFT_BY_DELETED_ADMIN],
    ['下書きが無い', null],
  ] as const)('%s状態のアクセシビリティの検査の違反が0件', async (_, draft) => {
    applyColorScheme(scheme);
    const { container } = await renderStatus(draft);

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
