import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { type ReactNode, use, useId } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { RecoverableSlot } from './recoverable-slot.tsx';

vi.mock('../../start/observability/browser-error-reporting.ts', {
  spy: true,
});

const CONTACT_HREF = '/contact';
const RETRY_LABEL = '再試行';
const CONTACT_LABEL = 'お問い合わせ';
const CONTACT_GUIDANCE = '解決しない場合はお問い合わせください。';
const UNEXPECTED_MESSAGE_WITH_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
const UNEXPECTED_MESSAGE_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';
const SECTION_TITLE = '問い合わせカテゴリ';
const RENDERED_TEXT = '区画の本文';

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

let sectionFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingSection() {
  if (sectionFailing) {
    throw new Error('区画の描画の失敗');
  }
  return <RenderedSection />;
}

function ThrowingGraphQLSection(): never {
  throw UNAVAILABLE;
}

function RenderedSection() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{SECTION_TITLE}</h2>
      <p>{RENDERED_TEXT}</p>
    </section>
  );
}

let finishLoading: () => void = () => undefined;
let loading: Promise<void> = Promise.resolve();

function SuspendingSection() {
  use(loading);
  return <RenderedSection />;
}

const fetchSection = vi.fn<() => Promise<string>>();

// 最初の取得の失敗だけを境界へ投げ、取り直しの失敗では表示中のデータを残す区画の取得の形
function QuerySection() {
  const { data } = useQuery({
    queryKey: ['section'],
    queryFn: fetchSection,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  return data === undefined ? null : <p>{data}</p>;
}

// 区画の部品が描けない読み込み中と失敗の間だけ見出しを補う
function SectionFallback({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const frameOf = (content: ReactNode) => (
  <SectionFallback title={SECTION_TITLE}>{content}</SectionFallback>
);

interface RenderOptions {
  readonly contactAvailable?: boolean;
  readonly contactHref?: string;
  readonly withFrame?: boolean;
  readonly fallback?: ReactNode;
}

const renderSlot = (
  children: ReactNode,
  {
    contactAvailable = true,
    contactHref,
    withFrame = false,
    fallback,
  }: RenderOptions = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <main className="p-4">
        <button type="button">外のボタン</button>
        <RecoverableSlot
          contactAvailable={contactAvailable}
          contactHref={contactHref}
          frame={withFrame ? frameOf : undefined}
          fallback={fallback}
          className="rounded-sm"
        >
          {children}
        </RecoverableSlot>
      </main>
    </QueryClientProvider>,
  );
};

const alert = () => page.getByRole('alert');
const retryButton = () => page.getByRole('button', { name: RETRY_LABEL });
const contactLink = () => page.getByRole('link', { name: CONTACT_LABEL });
const sectionHeading = () =>
  page.getByRole('heading', { level: 2, name: SECTION_TITLE });

beforeEach(() => {
  sectionFailing = false;
  fetchSection.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('RecoverableSlot', () => {
  describe('失敗の文言と問い合わせの導線', () => {
    test('問い合わせの導線があるアプリでは、GraphQL以外の失敗に問い合わせを促す文言と問い合わせのリンクを示し、エラートラッキングへ送る', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />, {
        contactAvailable: true,
        contactHref: CONTACT_HREF,
      });

      await expect
        .element(alert())
        .toHaveTextContent(UNEXPECTED_MESSAGE_WITH_CONTACT);
      await expect.element(contactLink()).toHaveAttribute('href', CONTACT_HREF);
      await expect.element(retryButton()).toBeVisible();
      expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
        expect.objectContaining({ message: '区画の描画の失敗' }),
        'render',
      );
    });

    test('問い合わせの導線が無いアプリでは、問い合わせを促す文を含めず、問い合わせのリンクも描かない', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />, { contactAvailable: false });

      await expect
        .element(alert())
        .toHaveTextContent(UNEXPECTED_MESSAGE_WITHOUT_CONTACT);
      expect(document.body.textContent).not.toContain(CONTACT_GUIDANCE);
      expect(page.getByRole('link').elements()).toHaveLength(0);
    });

    test('GraphQLの失敗はAPIの文言をそのまま示し、取得の補助が送っているためエラートラッキングへ送り直さない', async () => {
      await renderSlot(<ThrowingGraphQLSection />, {
        contactAvailable: true,
        contactHref: CONTACT_HREF,
      });

      await expect.element(alert()).toHaveTextContent(UNAVAILABLE.message);
      expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
    });
  });

  describe('再試行', () => {
    test('再試行で描画の失敗の境界を解除して部品を描き直し、消えた再試行のボタンから描き直した部品の見出しへフォーカスを移す', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />);
      await expect.element(alert()).toBeVisible();
      sectionFailing = false;

      await userEvent.click(retryButton());

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      expect(alert().query()).toBeNull();
      await expect.element(sectionHeading()).toHaveFocus();
    });

    test('再試行で取得の失敗の記録も解除し、最初の取得で失敗した区画が取得し直して描画される', async () => {
      fetchSection
        .mockRejectedValueOnce(UNAVAILABLE)
        .mockResolvedValueOnce('取得し直した本文');
      await renderSlot(<QuerySection />);
      await expect.element(alert()).toHaveTextContent(UNAVAILABLE.message);

      await userEvent.click(retryButton());

      await expect.element(page.getByText('取得し直した本文')).toBeVisible();
      expect(fetchSection).toHaveBeenCalledTimes(2);
      expect(alert().query()).toBeNull();
    });

    test('再試行でも描画に失敗したときは、フォーカスを新しい再試行のボタンへ移す', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />);
      await expect.element(alert()).toBeVisible();

      await userEvent.click(retryButton());

      await expect.element(alert()).toBeVisible();
      await expect.element(retryButton()).toHaveFocus();
    });

    test('再試行の後の読み込みを待つ間に利用者が枠の外へフォーカスを移したときは、描き終えてもフォーカスを奪い返さない', async () => {
      sectionFailing = true;
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      function SlowlyRecoveringSection() {
        if (sectionFailing) {
          throw new Error('区画の描画の失敗');
        }
        return <SuspendingSection />;
      }
      await renderSlot(<SlowlyRecoveringSection />);
      await expect.element(alert()).toBeVisible();
      sectionFailing = false;

      await userEvent.click(retryButton());
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent('読み込み中');
      const outsideButton = page.getByRole('button', { name: '外のボタン' });
      await userEvent.click(outsideButton);
      finishLoading();

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      await expect.element(outsideButton).toHaveFocus();
    });
  });

  describe('見出しの補い', () => {
    test('読み込み中は、補った見出しと読み込み中の状態をその位置に示す', async () => {
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      await renderSlot(<SuspendingSection />, { withFrame: true });

      await expect.element(sectionHeading()).toBeVisible();
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent('読み込み中');
      expect(page.getByText(RENDERED_TEXT).query()).toBeNull();

      finishLoading();

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      expect(page.getByRole('status').query()).toBeNull();
      expect(sectionHeading().elements()).toHaveLength(1);
    });

    test('失敗の間は、補った見出しの下に失敗の表示を置き、再試行の後は部品が描く見出しへフォーカスを移す', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />, {
        withFrame: true,
        contactHref: CONTACT_HREF,
      });

      await expect.element(sectionHeading()).toBeVisible();
      await expect
        .element(
          page.getByRole('region', { name: SECTION_TITLE }).getByRole('alert'),
        )
        .toBeVisible();
      sectionFailing = false;

      await userEvent.click(retryButton());

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      expect(sectionHeading().elements()).toHaveLength(1);
      await expect.element(sectionHeading()).toHaveFocus();
    });

    test('補いが無いときは、読み込み中と失敗の表示だけをその位置に示す', async () => {
      sectionFailing = true;
      await renderSlot(<ThrowingSection />);

      await expect.element(alert()).toBeVisible();
      expect(page.getByRole('heading').elements()).toHaveLength(0);
    });
  });

  describe('読み込み中の表示の差し替え', () => {
    const CUSTOM_FALLBACK = (
      <div role="status" data-testid="custom-fallback">
        一覧を読み込み中
      </div>
    );

    test('fallbackを渡すと、既定のスケルトンの代わりにそれを読み込み中の位置に示し、解決すると内容に替わる', async () => {
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      await renderSlot(<SuspendingSection />, { fallback: CUSTOM_FALLBACK });

      await expect
        .element(page.getByTestId('custom-fallback'))
        .toHaveTextContent('一覧を読み込み中');
      expect(page.getByText('読み込み中', { exact: true }).query()).toBeNull();

      finishLoading();

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      expect(page.getByTestId('custom-fallback').query()).toBeNull();
    });

    test('fallbackは補った見出しの枠の中に示す', async () => {
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      await renderSlot(<SuspendingSection />, {
        withFrame: true,
        fallback: CUSTOM_FALLBACK,
      });

      await expect
        .element(
          page
            .getByRole('region', { name: SECTION_TITLE })
            .getByTestId('custom-fallback'),
        )
        .toBeVisible();
      finishLoading();
      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
    });

    test('fallbackを渡しても、再試行の後に保留する部品が解決するまでフォーカスが文書の先頭へ落ちず、描き終えた見出しへ移る', async () => {
      sectionFailing = true;
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      function SlowlyRecoveringSection() {
        if (sectionFailing) {
          throw new Error('区画の描画の失敗');
        }
        return <SuspendingSection />;
      }
      await renderSlot(<SlowlyRecoveringSection />, {
        fallback: CUSTOM_FALLBACK,
      });
      await expect.element(alert()).toBeVisible();
      sectionFailing = false;

      await userEvent.click(retryButton());
      await expect.element(page.getByTestId('custom-fallback')).toBeVisible();
      expect(document.activeElement).not.toBe(document.body);

      finishLoading();

      await expect.element(page.getByText(RENDERED_TEXT)).toBeVisible();
      await expect.element(sectionHeading()).toHaveFocus();
    });

    test('fallbackを渡した読み込み中の表示でも、アクセシビリティの検査の違反が0件', async () => {
      loading = new Promise<void>(() => undefined);
      await renderSlot(<SuspendingSection />, { fallback: CUSTOM_FALLBACK });
      await expect.element(page.getByTestId('custom-fallback')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('問い合わせの導線付きの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      sectionFailing = true;
      const { container } = await renderSlot(<ThrowingSection />, {
        withFrame: true,
        contactHref: CONTACT_HREF,
      });
      await expect.element(alert()).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('読み込み中の表示で、アクセシビリティの検査の違反が0件', async () => {
      loading = new Promise<void>(() => undefined);
      const { container } = await renderSlot(<SuspendingSection />, {
        withFrame: true,
      });
      await expect.element(page.getByRole('status')).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
