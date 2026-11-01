import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { LinkRelToken } from '../../../common-lib/markdown/markdown-options.ts';
import type { RenderedMarkdown } from '../../../common-lib/markdown/render-markdown.ts';
import type { AppRuntime, RouterContext } from '../../start/router-context.ts';
import { MarkdownContent } from './markdown-content.tsx';
import { useMarkdownOptions } from './use-markdown-options.ts';
import { useRenderedMarkdown } from './use-rendered-markdown.ts';

const CLIENT_SITE_ORIGIN = 'https://client.example';

const RUNTIME: AppRuntime = {
  publicConfig: {
    environment: 'staging',
    turnstileSiteKey: '1x00000000000000000000BB',
    clientSiteOrigin: CLIENT_SITE_ORIGIN,
    imagesOrigin: 'https://images.example',
    sentry: { dsn: undefined, environment: 'staging', tracesSampleRate: 0.1 },
    webAnalyticsToken: undefined,
  },
  display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
};

const runtimeContext: Pick<RouterContext, 'runtime'> = {
  runtime: {
    get: () => RUNTIME,
    set: () => undefined,
  },
};

const LINKS = [
  '[同じサイト](https://client.example/p/launch)',
  '[外部](https://other.example/docs)',
].join(' ');

function createTestRouter(ui: ReactNode) {
  const rootRoute = createRootRouteWithContext<object>()({
    component: () => ui,
  });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
    context: runtimeContext,
  });
}

interface RenderLog {
  readonly results: RenderedMarkdown[];
}

interface MemoHarnessProps {
  readonly markdown: string;
  readonly externalLinkRel: readonly LinkRelToken[];
  readonly sameOriginLinkRel?: readonly LinkRelToken[];
  readonly idScope?: string;
  readonly log: RenderLog;
}

// 呼び出し側が描画のたびに指定のオブジェクトと配列を作り直しても、値が同じ間は同じ描画結果を使うことを確かめる
function MemoHarness({
  markdown,
  externalLinkRel,
  sameOriginLinkRel,
  idScope,
  log,
}: MemoHarnessProps) {
  const rendered = useRenderedMarkdown(markdown, {
    siteOrigin: CLIENT_SITE_ORIGIN,
    externalLinkRel: [...externalLinkRel],
    ...(sameOriginLinkRel === undefined
      ? {}
      : { sameOriginLinkRel: [...sameOriginLinkRel] }),
    ...(idScope === undefined ? {} : { idScope }),
  });
  log.results.push(rendered);
  return <MarkdownContent rendered={rendered} />;
}

interface OptionsHarnessProps {
  readonly markdown: string;
}

function OptionsHarness({ markdown }: OptionsHarnessProps) {
  const options = useMarkdownOptions({
    externalLinkRel: ['noopener', 'ugc'],
    sameOriginLinkRel: ['nofollow'],
    idScope: 'comment1',
  });
  const rendered = useRenderedMarkdown(markdown, options);
  return <MarkdownContent rendered={rendered} />;
}

const lastOf = (log: RenderLog): RenderedMarkdown | undefined =>
  log.results.at(-1);

afterEach(() => {
  document.body.replaceChildren();
});

describe('useRenderedMarkdown', () => {
  test('同じ本文と同じ値の指定で再描画しても、描画をやり直さず同じ結果を返す', async () => {
    const log: RenderLog = { results: [] };
    const screen = await render(
      <MemoHarness markdown={LINKS} externalLinkRel={['noopener']} log={log} />,
    );
    const first = lastOf(log);

    await screen.rerender(
      <MemoHarness markdown={LINKS} externalLinkRel={['noopener']} log={log} />,
    );

    expect(log.results.length).toBeGreaterThan(1);
    expect(new Set(log.results)).toStrictEqual(new Set([first]));
  });

  test('本文が変わると描画をやり直す', async () => {
    const log: RenderLog = { results: [] };
    const screen = await render(
      <MemoHarness markdown="最初の本文" externalLinkRel={[]} log={log} />,
    );
    const first = lastOf(log);

    await screen.rerender(
      <MemoHarness markdown="次の本文" externalLinkRel={[]} log={log} />,
    );

    expect(lastOf(log)).not.toBe(first);
    await expect.element(page.getByText('次の本文')).toBeVisible();
  });

  test.each<[string, Partial<MemoHarnessProps>, Partial<MemoHarnessProps>]>([
    [
      '別オリジンのリンクのrel',
      { externalLinkRel: ['noopener'] },
      { externalLinkRel: ['noopener', 'ugc'] },
    ],
    [
      '同一オリジンのリンクのrel',
      { externalLinkRel: [] },
      { externalLinkRel: [], sameOriginLinkRel: ['nofollow'] },
    ],
    [
      '本文の識別子',
      { externalLinkRel: [], idScope: 'first' },
      { externalLinkRel: [], idScope: 'second' },
    ],
  ])('%sが変わると描画をやり直す', async (_name, before, after) => {
    const log: RenderLog = { results: [] };
    const screen = await render(
      <MemoHarness
        markdown={`## 見出し\n\n${LINKS}`}
        externalLinkRel={[]}
        {...before}
        log={log}
      />,
    );
    const first = lastOf(log);

    await screen.rerender(
      <MemoHarness
        markdown={`## 見出し\n\n${LINKS}`}
        externalLinkRel={[]}
        {...after}
        log={log}
      />,
    );

    expect(lastOf(log)).not.toBe(first);
    expect(lastOf(log)?.html).not.toBe(first?.html);
  });

  test('指定を戻すと戻した指定で描画し直す', async () => {
    const log: RenderLog = { results: [] };
    const screen = await render(
      <MemoHarness markdown={LINKS} externalLinkRel={['noopener']} log={log} />,
    );
    const first = lastOf(log);

    await screen.rerender(
      <MemoHarness markdown={LINKS} externalLinkRel={['ugc']} log={log} />,
    );
    await screen.rerender(
      <MemoHarness markdown={LINKS} externalLinkRel={['noopener']} log={log} />,
    );

    expect(lastOf(log)?.html).toBe(first?.html);
    await expect
      .element(page.getByRole('link', { name: '外部' }))
      .toHaveAttribute('rel', 'noopener');
  });
});

describe('useMarkdownOptions', () => {
  test('サイトのオリジンをルーターの文脈の利用者側のオリジンから補い、同じオリジンのリンクを同じタブで開く', async () => {
    await render(
      <RouterProvider
        router={createTestRouter(<OptionsHarness markdown={LINKS} />)}
      />,
    );

    const sameSite = page.getByRole('link', { name: '同じサイト' });
    const external = page.getByRole('link', { name: '外部' });
    await expect.element(sameSite).not.toHaveAttribute('target');
    await expect.element(sameSite).toHaveAttribute('rel', 'nofollow');
    await expect.element(external).toHaveAttribute('target', '_blank');
    await expect.element(external).toHaveAttribute('rel', 'noopener ugc');
  });

  test('本文の識別子を見出しのIDの接頭辞に使う', async () => {
    await render(
      <RouterProvider
        router={createTestRouter(<OptionsHarness markdown="## Overview" />)}
      />,
    );

    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Overview' }))
      .toHaveAttribute('id', 'user-content-comment1-overview');
  });

  test('ページのサーバー側の描画でも同じ指定で描画する', () => {
    const router = createTestRouter(null);

    const html = renderToString(
      <RouterContextProvider router={router}>
        <OptionsHarness markdown={LINKS} />
      </RouterContextProvider>,
    );

    expect(html).toContain(
      '<a href="https://other.example/docs" target="_blank" rel="noopener ugc">外部</a>',
    );
    expect(html).toContain(
      '<a href="https://client.example/p/launch" rel="nofollow">同じサイト</a>',
    );
  });
});
