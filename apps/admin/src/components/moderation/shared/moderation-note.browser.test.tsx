import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { DisplayPreferencesProvider } from '../../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../../lib/test/display-emulation.ts';
import {
  ModerationNote,
  type ModerationNoteProps,
} from './moderation-note.tsx';

const MODERATION_DISPLAY = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const SUSPENDED_AT = '2026-11-12T03:00:00.000Z';

const MULTILINE_REASON = '利用規約の禁止事項に当たる投稿\n<b>警告済み</b>';

const renderNote = (props: ModerationNoteProps) =>
  render(
    <DisplayPreferencesProvider initial={MODERATION_DISPLAY}>
      <ModerationNote {...props} />
    </DisplayPreferencesProvider>,
  );

const valueOf = (term: string) =>
  page.getByRole('term').filter({ hasText: term }).element().nextElementSibling;

beforeEach(async () => {
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('最新の措置の理由と日時', () => {
  test('措置の日時を閲覧者のタイムゾーンで<time datetime>に示し、理由を改行を保った文字列として示す', async () => {
    await renderNote({
      dateLabel: '停止日時',
      occurredAt: SUSPENDED_AT,
      note: { reason: MULTILINE_REASON, occurredAt: SUSPENDED_AT },
    });

    const time = valueOf('停止日時')?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(SUSPENDED_AT);
    expect(time?.textContent).toContain('12:00');
    const reason = valueOf('理由');
    expect(reason?.textContent).toBe(MULTILINE_REASON);
    expect(reason?.querySelector('b')).toBeNull();
    expect(reason === null ? '' : getComputedStyle(reason).whiteSpace).toBe(
      'pre-wrap',
    );
  });

  test('状態の日時が無ければ措置の記録の日時を示す', async () => {
    await renderNote({
      dateLabel: '無効化した日時',
      occurredAt: null,
      note: { reason: '不正な評価', occurredAt: SUSPENDED_AT },
    });

    expect(
      valueOf('無効化した日時')
        ?.querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe(SUSPENDED_AT);
  });

  test('措置の記録が無ければ、理由を「記録なし」と示し、日時は状態の日時だけを示す', async () => {
    await renderNote({
      dateLabel: '非公開化した日時',
      occurredAt: SUSPENDED_AT,
      note: null,
    });

    expect(valueOf('理由')?.textContent).toBe('記録なし');
    expect(
      valueOf('非公開化した日時')
        ?.querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe(SUSPENDED_AT);
  });

  test('日時がどちらにも無ければ日時の項目を置かない', async () => {
    await renderNote({ dateLabel: '停止日時', occurredAt: null, note: null });

    expect(page.getByRole('term').all()).toHaveLength(1);
    expect(valueOf('理由')?.textContent).toBe('記録なし');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await renderNote({
      dateLabel: '停止日時',
      occurredAt: SUSPENDED_AT,
      note: { reason: MULTILINE_REASON, occurredAt: SUSPENDED_AT },
    });

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
