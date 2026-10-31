import { useEffect, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import { renderMarkdown } from '../../../common-lib/markdown/render-markdown.ts';
import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
// 共用部品の検証規則は部品から読み込めないが、入力欄が渡す値を検証規則そのものに通して確かめるため、テストでだけ読み込む
// eslint-disable-next-line no-restricted-imports
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import '../../styles/base.css';
import {
  installPreloadRecovery,
  PRELOAD_ERROR_EVENT,
  PRELOAD_RECOVERY_STORAGE_KEY,
} from '../../start/preload-recovery.ts';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { runAxe } from '../../test/a11y.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import type {
  EditorController,
  EditorSurfaceProps,
} from './editor-controller.ts';
import {
  type ImportEditorSurface,
  importCrepeEditorSurface,
  loadCrepeEditor,
} from './load-crepe-editor.ts';
import {
  MarkdownEditor,
  type MarkdownEditorProps,
} from './markdown-editor.tsx';

// 実物の送信待ちの列へ積ませたまま、エラートラッキングへ送る関数の呼び出しを記録する
vi.mock('../../start/observability/browser-error-reporting.ts', { spy: true });

vi.mock('./load-crepe-editor.ts', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly loadCrepeEditor: typeof loadCrepeEditor;
  }>();
  return { ...actual, loadCrepeEditor: vi.fn(actual.loadCrepeEditor) };
});

const { loadCrepeEditor: actualLoadCrepeEditor } = await vi.importActual<{
  readonly loadCrepeEditor: typeof loadCrepeEditor;
}>('./load-crepe-editor.ts');

const LABEL_ID = 'markdown-editor-label';

const DESCRIPTION_ID = 'markdown-editor-description';

const LABEL = '本文';

const DESCRIPTION = 'マークダウンで書けます。';

const PLACEHOLDER = 'コメントを入力してください';

const KEYBOARD_HINT =
  'リストの項目の階層を下げる操作と表の次のセルへの移動はCtrl+]、階層を上げる操作と表の前のセルへの移動はCtrl+[で行います(macOSではCtrlの代わりにCommand)。';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

const SAMPLE = [
  '## 大会の見出し',
  '',
  '**投票**で競います。[要項](https://client.example/rules)と[外部](https://other.example/docs)。',
  '',
  '- 箇条書きの項目',
  '',
  '| 項目 | 説明 |',
  '| --- | --- |',
  '| 投票 | 1日1回まで |',
].join('\n');

const LOADING_STATUS = 'エディタを読み込んでいます';

const LOAD_FAILED = 'エディタを読み込めませんでした。';

const PREVIEW_EMPTY = 'プレビューする内容がありません。';

type EditorOverrides = Partial<Omit<MarkdownEditorProps, 'value'>>;

interface ControlledEditorProps extends EditorOverrides {
  readonly initialValue?: string;
}

function ControlledEditor({
  initialValue = '',
  onValueChange,
  ...overrides
}: ControlledEditorProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="grid gap-2 p-4">
      <button type="button">前の要素</button>
      <span id={LABEL_ID} className="text-sm font-medium">
        {LABEL}
      </span>
      <p id={DESCRIPTION_ID} className="text-sm text-muted-foreground">
        {DESCRIPTION}
      </p>
      <MarkdownEditor
        value={value}
        onValueChange={(next) => {
          onValueChange?.(next);
          setValue(next);
        }}
        onBlur={() => undefined}
        labelId={LABEL_ID}
        describedById={DESCRIPTION_ID}
        maxGraphemes={2000}
        placeholder={PLACEHOLDER}
        preview={PREVIEW}
        {...overrides}
      />
      <button
        type="button"
        onClick={() => {
          setValue('');
        }}
      >
        空にする
      </button>
      <button
        type="button"
        onClick={() => {
          setValue('## 定型の見出し\n\n定型の本文');
        }}
      >
        定型文を入れる
      </button>
      <button type="button">次の要素</button>
    </div>
  );
}

const bodySchema = z.object({ body: z.string() });

interface BodyFormProps {
  readonly disabled?: boolean;
}

function BodyForm({ disabled }: BodyFormProps) {
  const form = useAppForm(bodySchema, { defaultValues: { body: '' } });
  return (
    <AppForm
      form={form}
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      aria-label="投稿"
      className="grid gap-4 p-4"
    >
      <FormField
        control={form.control}
        name="body"
        label={LABEL}
        description={DESCRIPTION}
        {...(disabled === undefined ? {} : { disabled })}
      >
        {(control) => (
          <MarkdownEditor
            value={control.value}
            onValueChange={control.onChange}
            onBlur={control.onBlur}
            ref={control.ref}
            labelId={control.labelId}
            describedById={control['aria-describedby']}
            invalid={control['aria-invalid'] === true}
            disabled={control.disabled === true}
            maxGraphemes={2000}
            placeholder={PLACEHOLDER}
            preview={PREVIEW}
          />
        )}
      </FormField>
      <button
        type="button"
        onClick={() => {
          form.setFocus('body');
        }}
      >
        本文の欄へ移る
      </button>
    </AppForm>
  );
}

const editable = () => page.getByRole('textbox', { name: LABEL });

const toolbar = () => page.getByRole('toolbar', { name: '書式' });

const toolbarButton = (name: string) =>
  toolbar().getByRole('button', { name, exact: true });

const tab = (name: string) => page.getByRole('tab', { name });

async function waitForEditor(): Promise<HTMLElement> {
  await expect.element(editable()).toBeInTheDocument();
  await expect.element(toolbarButton('太字')).not.toHaveAttribute('disabled');
  return editable().element() as HTMLElement;
}

// サーバー側の描画の結果を、ブラウザが受け取ったHTMLと同じく解析して要素にする
const parseServerHtml = (html: string): HTMLElement => {
  const container = document.createElement('div');
  container.replaceChildren(
    ...new DOMParser().parseFromString(html, 'text/html').body.childNodes,
  );
  return container;
};

const counterText = (container: Element): string =>
  container.querySelector('[data-slot="markdown-length-counter"] p')
    ?.textContent ?? '';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const loadOnceWith = (importSurface: ImportEditorSurface): void => {
  vi.mocked(loadCrepeEditor).mockImplementationOnce(() =>
    actualLoadCrepeEditor(importSurface),
  );
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const staleControllerCalls: string[] = [];

// Milkdownは破棄した後も制御器の操作を受け付けて例外を投げるため、破棄の後の呼び出しを記録して例外を投げる偽物にする
const staleController = (isDestroyed: () => boolean): EditorController => {
  const guard = (name: string) => (): never => {
    if (isDestroyed()) {
      staleControllerCalls.push(name);
    }
    throw new Error(`contextNotFound: ${name}`);
  };
  return {
    run: guard('run'),
    currentLink: guard('currentLink'),
    applyLink: guard('applyLink'),
    replaceMarkdown: guard('replaceMarkdown'),
    readMarkdown: () => '',
    focus: guard('focus'),
  };
};

// 最初の描画で制御器を渡し、制御器を受け取った入力欄が描き直した時の描画で例外を投げる編集領域。入力欄は描画のたびに通知の関数を作り直すため、関数が変わったことで描き直しを見分ける
function SurfaceFailingAfterReady({ onReady }: EditorSurfaceProps) {
  const [firstOnReady] = useState(() => onReady);
  useEffect(() => {
    let destroyed = false;
    firstOnReady(staleController(() => destroyed));
    return () => {
      destroyed = true;
    };
  }, [firstOnReady]);
  if (onReady !== firstOnReady) {
    throw new Error('制御器を渡した後の描画の失敗');
  }
  return <div />;
}

beforeEach(() => {
  staleControllerCalls.length = 0;
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  vi.mocked(loadCrepeEditor).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownEditor', () => {
  describe('読み込み前と読み込み後の表示', () => {
    test('サーバー側の描画では、現在の値の描画結果と読み込み中の通知、操作できないツールバーを表示する', () => {
      const html = renderToString(
        <MarkdownEditor
          value={SAMPLE}
          onValueChange={() => undefined}
          onBlur={() => undefined}
          labelId={LABEL_ID}
          maxGraphemes={2000}
          placeholder={PLACEHOLDER}
          preview={PREVIEW}
        />,
      );
      const container = parseServerHtml(html);

      const placeholder = container.querySelector(
        '[data-slot="editor-placeholder"]',
      );
      expect(placeholder?.querySelector('[role="status"]')?.textContent).toBe(
        LOADING_STATUS,
      );
      expect(
        placeholder?.querySelector('[aria-busy="true"] h2')?.textContent,
      ).toBe('大会の見出し');
      expect(container.querySelector('[contenteditable]')).toBeNull();
      const buttons = container.querySelectorAll('[role="toolbar"] button');
      expect(buttons).toHaveLength(10);
      for (const button of buttons) {
        expect(button.hasAttribute('disabled')).toBe(true);
      }
      expect(
        container
          .querySelector('[role="toolbar"]')
          ?.hasAttribute('aria-controls'),
      ).toBe(false);
      expect(
        Array.from(
          container.querySelectorAll('[role="tab"]'),
          (element) => element.textContent,
        ),
      ).toStrictEqual(['書く', 'プレビュー']);
      expect(counterText(container)).toBe(
        `${countGraphemes(SAMPLE).toLocaleString('ja-JP')} / 2,000`,
      );
    });

    test('サーバー側の描画で値が空なら、プレースホルダーの文を表示する', () => {
      const html = renderToString(
        <MarkdownEditor
          value="  "
          onValueChange={() => undefined}
          onBlur={() => undefined}
          labelId={LABEL_ID}
          maxGraphemes={2000}
          placeholder={PLACEHOLDER}
          preview={PREVIEW}
        />,
      );
      const container = parseServerHtml(html);

      expect(container.querySelector('[aria-busy="true"]')?.textContent).toBe(
        PLACEHOLDER,
      );
    });

    test('読み込み後は仮の表示を編集領域に切り替え、ツールバーを操作できるようにする', async () => {
      const { container } = await render(
        <ControlledEditor initialValue={SAMPLE} />,
      );

      const body = await waitForEditor();

      expect(container.querySelector('[data-slot="editor-placeholder"]')).toBe(
        null,
      );
      expect(body.querySelector('h2')?.textContent).toBe('大会の見出し');
      await expect.element(toolbar()).toHaveAttribute('aria-controls', body.id);
      await expect
        .element(editable())
        .toHaveAccessibleDescription(`${DESCRIPTION} ${KEYBOARD_HINT}`);
      expect(vi.mocked(loadCrepeEditor)).toHaveBeenCalledTimes(1);
    });

    test('ツールバーの操作は読み込んだ編集領域の内容に書式を適用する', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      await render(<ControlledEditor onValueChange={onValueChange} />);
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('見出しの文');

      await userEvent.click(toolbarButton('見出し'));

      await expect
        .element(toolbarButton('見出し'))
        .toHaveAttribute('aria-pressed', 'true');
      expect(body.querySelector('h2')?.textContent).toBe('見出しの文');
      await expect
        .poll(() => onValueChange.mock.calls.at(-1)?.[0])
        .toBe('## 見出しの文');
    });

    test('リンクの操作はダイアログを開き、設定したリンクを編集領域へ適用してフォーカスを戻す', async () => {
      await render(<ControlledEditor initialValue="要項" />);
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');

      await userEvent.click(toolbarButton('リンク'));
      await userEvent.fill(
        page.getByRole('textbox', { name: 'URL' }),
        'https://client.example/rules',
      );
      await userEvent.click(page.getByRole('button', { name: '設定' }));

      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
      expect(body.querySelector('a')?.getAttribute('href')).toBe(
        'https://client.example/rules',
      );
      await expect.poll(() => document.activeElement).toBe(body);
    });
  });

  describe('値の受け渡し', () => {
    test('フォーカスを外すと、変更の通知を待たずに最新の値を渡してから離脱を伝える', async () => {
      const calls: string[] = [];
      await render(
        <ControlledEditor
          onValueChange={(markdown) => {
            calls.push(`change:${markdown}`);
          }}
          onBlur={() => {
            calls.push('blur');
          }}
        />,
      );
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('abc');

      await userEvent.tab();

      expect(calls).toStrictEqual(['change:abc', 'blur']);
    });

    test('変更していなければ、フォーカスを外しても値を渡さずに離脱だけを伝える', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      const onBlur = vi.fn<() => void>();
      await render(
        <ControlledEditor
          initialValue="本文"
          onValueChange={onValueChange}
          onBlur={onBlur}
        />,
      );
      const body = await waitForEditor();
      await userEvent.click(body);

      await userEvent.tab();

      expect(onBlur).toHaveBeenCalledTimes(1);
      expect(onValueChange).not.toHaveBeenCalled();
    });

    test('入力中の変更は間引いてフォームへ渡し、最後の値を必ず渡してカウンターに反映する', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      const { container } = await render(
        <ControlledEditor onValueChange={onValueChange} />,
      );
      const body = await waitForEditor();
      await userEvent.click(body);

      for (const character of 'abcdefgh') {
        await userEvent.keyboard(character);
      }

      await expect
        .poll(() => onValueChange.mock.calls.at(-1)?.[0])
        .toBe('abcdefgh');
      expect(onValueChange.mock.calls.length).toBeLessThan(8);
      await expect.poll(() => counterText(container)).toBe('8 / 2,000');
    });

    test('編集領域が直列化の末尾に付ける改行を除いて渡し、上限ちょうどの入力は上限内として検証を通る', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      const { container } = await render(
        <ControlledEditor maxGraphemes={3} onValueChange={onValueChange} />,
      );
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('abc');

      await userEvent.tab();

      const sent = onValueChange.mock.calls.at(-1)?.[0];
      expect(sent).toBe('abc');
      expect(counterText(container)).toBe('3 / 3');
      expect(
        markdownTextSchema({
          label: LABEL,
          maxGraphemes: 3,
          required: true,
        }).safeParse(sent).success,
      ).toBe(true);
    });

    test('末尾に改行を持つ値を外部から渡しても、改行だけの違いでは編集領域を置き換えず値も送り返さない', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      await render(
        <ControlledEditor
          initialValue={'本文\n'}
          onValueChange={onValueChange}
        />,
      );
      const body = await waitForEditor();
      await userEvent.click(body);

      await userEvent.tab();
      await sleep(400);

      expect(onValueChange).not.toHaveBeenCalled();
      expect(body.textContent).toBe('本文');
    });

    test('外部から値を置き換えると、編集領域の内容を新しい値にし、置き換えた値を送り返さない', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      await render(
        <ControlledEditor
          initialValue={SAMPLE}
          onValueChange={onValueChange}
        />,
      );
      const body = await waitForEditor();

      await userEvent.click(page.getByRole('button', { name: '空にする' }));

      await expect.poll(() => body.textContent).toBe('');

      await userEvent.click(
        page.getByRole('button', { name: '定型文を入れる' }),
      );

      await expect
        .poll(() => body.querySelector('h2')?.textContent)
        .toBe('定型の見出し');
      await sleep(400);
      expect(onValueChange).not.toHaveBeenCalled();
    });

    test('無効のときは編集とツールバーの操作を受け付けない', async () => {
      const onValueChange = vi.fn<(markdown: string) => void>();
      await render(
        <ControlledEditor
          initialValue="本文"
          disabled
          onValueChange={onValueChange}
        />,
      );
      await expect.element(editable()).toBeInTheDocument();
      const body = editable().element() as HTMLElement;

      await expect.element(editable()).toHaveAttribute('aria-disabled', 'true');
      expect(body.getAttribute('contenteditable')).toBe('false');
      for (const name of ['見出し', '太字', 'リンク', '表']) {
        await expect.element(toolbarButton(name)).toBeDisabled();
      }
      body.focus();
      await userEvent.keyboard('追記');
      await sleep(300);
      expect(body.textContent).toBe('本文');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('プレビュー', () => {
    test('プレビューでは表示場所と同じ指定で描画した本文を表示し、ツールバーを操作できないことを示す', async () => {
      await render(<ControlledEditor initialValue={SAMPLE} />);
      await waitForEditor();

      await userEvent.click(tab('プレビュー'));

      const panel = page.getByRole('tabpanel', { name: 'プレビュー' });
      const content = panel
        .element()
        .querySelector('[data-slot="markdown-content"]');
      expect(content?.innerHTML).toBe(renderMarkdown(SAMPLE, PREVIEW).html);
      await expect
        .element(toolbarButton('太字'))
        .toHaveAttribute('aria-disabled', 'true');
      expect(
        (editable().query() as HTMLElement | null)?.checkVisibility(),
      ).not.toBe(true);
    });

    test('プレビューから書く側へ戻ると、編集中の内容と編集領域をそのまま使う', async () => {
      await render(<ControlledEditor initialValue="本文" />);
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('の続き');

      await userEvent.click(tab('プレビュー'));
      await userEvent.click(tab('書く'));

      expect(editable().element()).toBe(body);
      expect(body.textContent).toBe('本文の続き');
      expect(vi.mocked(loadCrepeEditor)).toHaveBeenCalledTimes(1);
    });

    test('内容が空白だけなら、プレビューに空の文言を表示する', async () => {
      await render(<ControlledEditor initialValue={'  \n'} />);
      await waitForEditor();

      await userEvent.click(tab('プレビュー'));

      await expect
        .element(page.getByRole('tabpanel', { name: 'プレビュー' }))
        .toHaveTextContent(PREVIEW_EMPTY);
    });
  });

  describe('読み込みの失敗', () => {
    test('読み込みに失敗すると、ページを再読み込みさせずに失敗を表示し、再試行で新しく読み込んで値を保つ', async () => {
      const items = new Map<string, string>();
      const reload = vi.fn<() => void>();
      const uninstall = installPreloadRecovery({
        target: window,
        storage: {
          getItem: (key) => items.get(key) ?? null,
          setItem: (key, value) => {
            items.set(key, value);
          },
        },
        reload,
      });
      const dispatched: Event[] = [];
      loadOnceWith(() => {
        const event = new Event(PRELOAD_ERROR_EVENT, { cancelable: true });
        dispatched.push(event);
        window.dispatchEvent(event);
        return Promise.resolve(undefined);
      });

      try {
        const { container } = await render(
          <ControlledEditor initialValue="失わない本文" />,
        );

        const alert = page.getByRole('alert');
        await expect.element(alert).toHaveTextContent(LOAD_FAILED);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.defaultPrevented).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        expect(items.has(PRELOAD_RECOVERY_STORAGE_KEY)).toBe(false);
        expect(
          vi.mocked(reportUnexpectedErrorInBrowser),
        ).not.toHaveBeenCalled();
        expect(await runAxe(container)).toStrictEqual([]);

        await userEvent.click(alert.getByRole('button', { name: '再試行' }));

        const body = await waitForEditor();
        expect(body.textContent).toBe('失わない本文');
        expect(vi.mocked(loadCrepeEditor)).toHaveBeenCalledTimes(2);
        await expect.poll(() => document.activeElement).toBe(body);
      } finally {
        uninstall();
      }
    });

    test('読み込みの後の編集領域の描画の失敗は、外へ伝えず想定外の描画の失敗として報告する', async () => {
      const failure = new Error('編集領域の描画の失敗');
      loadOnceWith(() =>
        Promise.resolve({
          default: () => {
            throw failure;
          },
        }),
      );

      await render(<ControlledEditor initialValue="本文" />);

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(LOAD_FAILED);
      expect(vi.mocked(reportUnexpectedErrorInBrowser)).toHaveBeenCalledWith(
        failure,
        'render',
      );
    });

    test('制御器を渡した後に編集領域の描画が失敗すると、古い制御器を使わずに失敗を表示し、再試行で値を保って編集領域へフォーカスを移す', async () => {
      const failure = new Error('制御器を渡した後の描画の失敗');
      loadOnceWith(() =>
        Promise.resolve({ default: SurfaceFailingAfterReady }),
      );
      const { container } = await render(
        <ControlledEditor initialValue="失わない本文" />,
      );

      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent(LOAD_FAILED);
      expect(vi.mocked(reportUnexpectedErrorInBrowser)).toHaveBeenCalledWith(
        expect.objectContaining({ message: failure.message }),
        'render',
      );
      for (const name of ['見出し', '太字', 'リンク', '表']) {
        await expect.element(toolbarButton(name)).toBeDisabled();
      }
      await expect.element(toolbar()).not.toHaveAttribute('aria-controls');
      expect(page.getByRole('dialog').query()).toBeNull();
      expect(
        container.querySelector(
          '[data-slot="editor-placeholder"] [data-slot="markdown-content"]',
        )?.textContent,
      ).toBe('失わない本文');
      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.click(page.getByRole('button', { name: '空にする' }));
      await expect.poll(() => counterText(container)).toBe('0 / 2,000');
      await userEvent.click(
        page.getByRole('button', { name: '定型文を入れる' }),
      );

      await userEvent.click(alert.getByRole('button', { name: '再試行' }));

      const body = await waitForEditor();
      expect(body.querySelector('h2')?.textContent).toBe('定型の見出し');
      await expect.poll(() => document.activeElement).toBe(body);
      expect(staleControllerCalls).toStrictEqual([]);
    });
  });

  describe('フォームとの結合', () => {
    test('欄のラベルで編集領域に名前を付け、説明とキー操作の説明を関連付ける', async () => {
      await render(<BodyForm />);

      await waitForEditor();

      await expect
        .element(editable())
        .toHaveAccessibleDescription(`${DESCRIPTION} ${KEYBOARD_HINT}`);
    });

    test('欄へのフォーカスの要求は、読み込みの前なら保留して読み込みの後に編集領域へ移す', async () => {
      const gate = deferred();
      loadOnceWith(() => gate.promise.then(importCrepeEditorSurface));
      await render(<BodyForm />);
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(LOADING_STATUS);

      await userEvent.click(
        page.getByRole('button', { name: '本文の欄へ移る' }),
      );
      gate.resolve();

      const body = await waitForEditor();
      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('読み込みの後の欄へのフォーカスの要求は、プレビュー中でも書く側へ戻して編集領域へ移す', async () => {
      await render(<BodyForm />);
      const body = await waitForEditor();
      await userEvent.click(tab('プレビュー'));

      await userEvent.click(
        page.getByRole('button', { name: '本文の欄へ移る' }),
      );

      await expect
        .element(tab('書く'))
        .toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('入力を最初にフォーカスを外した時にフォームへ渡し、欄を無効にすると編集を受け付けない', async () => {
      const { rerender } = await render(<BodyForm />);
      const body = await waitForEditor();
      await userEvent.click(body);
      await userEvent.keyboard('投稿の本文');
      await userEvent.tab();

      await expect.poll(() => body.textContent).toBe('投稿の本文');

      await rerender(<BodyForm disabled />);

      await expect.element(editable()).toHaveAttribute('aria-disabled', 'true');
      await expect.element(toolbarButton('太字')).toBeDisabled();
    });
  });
});
