import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import '../../styles/base.css';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { MarkdownEditor } from './markdown-editor.tsx';

const { creationFailures } = vi.hoisted(() => ({
  creationFailures: [] as Error[],
}));

// 実物の送信待ちの列へ積ませたまま、エラートラッキングへ送る関数の呼び出しを記録する
vi.mock('../../start/observability/browser-error-reporting.ts', { spy: true });

// 実物の編集領域の作成を拒否させるため、編集領域が組み込むプラグインの末尾に、予約した失敗を作成の途中で投げるプラグインを加える。エディタの型は遅延読み込みのモジュールの外へ出さないため、プラグインの形(文脈を受けて読み込みの処理を返す関数)だけを書く
vi.mock('./crepe/cjk-remark-plugins.ts', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly cjkRemarkPlugins: readonly unknown[];
  }>();
  const failReservedCreation = () => () => {
    const failure = creationFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
  };
  return {
    ...actual,
    cjkRemarkPlugins: [...actual.cjkRemarkPlugins, failReservedCreation],
  };
});

const LABEL_ID = 'markdown-editor-label';

const LABEL = '本文';

const LOAD_FAILED = 'エディタを読み込めませんでした。';

const INITIAL_VALUE = '失わない本文';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

// 作成の失敗の後も、編集領域が作成の途中で登録した通知が遅れて届き得るため、届くまで待ってから古い制御器を使っていないことを確かめる
const LATE_NOTIFICATION_WAIT_MS = 300;

function ControlledEditor() {
  const [value, setValue] = useState(INITIAL_VALUE);
  return (
    <div className="grid gap-2 p-4">
      <span id={LABEL_ID} className="text-sm font-medium">
        {LABEL}
      </span>
      <MarkdownEditor
        value={value}
        onValueChange={setValue}
        onBlur={() => undefined}
        labelId={LABEL_ID}
        maxGraphemes={2000}
        placeholder="コメントを入力してください"
        preview={PREVIEW}
      />
    </div>
  );
}

const editable = () => page.getByRole('textbox', { name: LABEL });

const toolbarButton = (name: string) =>
  page
    .getByRole('toolbar', { name: '書式' })
    .getByRole('button', { name, exact: true });

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const placeholderText = (container: Element): string | undefined =>
  container.querySelector(
    '[data-slot="editor-placeholder"] [data-slot="markdown-content"]',
  )?.textContent;

beforeEach(() => {
  creationFailures.length = 0;
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('MarkdownEditor', () => {
  describe('編集領域の作成の失敗', () => {
    test('作成が拒否されると、空の枠を残さずに読み込みの失敗と再試行の手段を表示し、それまでの値を仮の表示に出す', async () => {
      creationFailures.push(new Error('編集領域の作成の失敗'));
      const { container } = await render(<ControlledEditor />);

      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent(LOAD_FAILED);
      await expect
        .element(alert.getByRole('button', { name: '再試行' }))
        .toBeInTheDocument();
      expect(container.querySelector('[data-milkdown-root]')).toBeNull();
      expect(placeholderText(container)).toBe(INITIAL_VALUE);

      await sleep(LATE_NOTIFICATION_WAIT_MS);
      for (const name of ['見出し', '太字', 'リンク', '表']) {
        await expect.element(toolbarButton(name)).toBeDisabled();
      }
      expect(placeholderText(container)).toBe(INITIAL_VALUE);
    });

    test('作成の失敗は、描画の失敗と同じく想定外の失敗としてエラートラッキングへ送る', async () => {
      const failure = new Error('編集領域の作成の失敗');
      creationFailures.push(failure);
      await render(<ControlledEditor />);

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(LOAD_FAILED);
      expect(vi.mocked(reportUnexpectedErrorInBrowser)).toHaveBeenCalledTimes(
        1,
      );
      expect(vi.mocked(reportUnexpectedErrorInBrowser)).toHaveBeenCalledWith(
        failure,
        'render',
      );
    });

    test('再試行で新しい編集領域を作り、それまでの値を保って編集領域へフォーカスを移す', async () => {
      creationFailures.push(new Error('編集領域の作成の失敗'));
      await render(<ControlledEditor />);
      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent(LOAD_FAILED);

      await userEvent.click(alert.getByRole('button', { name: '再試行' }));

      await expect.element(editable()).toBeInTheDocument();
      await expect.element(toolbarButton('太字')).not.toBeDisabled();
      const body = editable().element() as HTMLElement;
      expect(body.textContent).toBe(INITIAL_VALUE);
      await expect.poll(() => document.activeElement).toBe(body);
      expect(page.getByRole('alert').query()).toBeNull();
      expect(vi.mocked(reportUnexpectedErrorInBrowser)).toHaveBeenCalledTimes(
        1,
      );
    });

    describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
      test('作成の失敗の表示でアクセシビリティの検査の違反が0件', async () => {
        applyColorScheme(scheme);
        creationFailures.push(new Error('編集領域の作成の失敗'));
        const { container } = await render(<ControlledEditor />);
        await expect
          .element(page.getByRole('alert'))
          .toHaveTextContent(LOAD_FAILED);

        expect(await runAxe(container)).toStrictEqual([]);
      });
    });
  });
});
