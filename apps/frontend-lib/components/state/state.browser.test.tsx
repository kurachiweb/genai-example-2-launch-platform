import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { emulateReducedMotion } from '../../test/reduced-motion.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { Skeleton } from '../ui/skeleton/skeleton.tsx';
import { EmptyState } from './empty-state.tsx';
import { ErrorState } from './error-state.tsx';
import { LoadingSkeleton } from './loading-skeleton.tsx';
import { PartialErrorState } from './partial-error-state.tsx';
import { UnavailableNotice } from './unavailable-notice.tsx';

const PAGE_LOAD_ERROR =
  'プロダクト情報を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
const EMPTY_DIRECTORY = 'ディレクトリに掲載されたプロダクトはまだありません。';
const EMPTY_DIRECTORY_DESCRIPTION =
  '予選マッチに勝利したプロダクトがここに並びます。最初の勝者を目指して、ローンチを予約しましょう。';
const PARTIAL_LOAD_ERROR = 'コメントを読み込めませんでした。';
const DEGRADED_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';
const DEGRADED_MESSAGE =
  '現在ご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';
const CONTACT_HREF = '/contact';

const retryButton = () =>
  page.getByRole('button', { name: '再試行', exact: true });
const contactLink = () =>
  page.getByRole('link', { name: 'お問い合わせ', exact: true });

function AllStates() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <LoadingSkeleton />
      <EmptyState
        title={EMPTY_DIRECTORY}
        headingLevel={2}
        description={EMPTY_DIRECTORY_DESCRIPTION}
        action={<a href="/launch">ローンチを予約</a>}
      />
      <ErrorState
        message={PAGE_LOAD_ERROR}
        onRetry={() => undefined}
        contactHref={CONTACT_HREF}
      />
      <PartialErrorState
        message={PARTIAL_LOAD_ERROR}
        onRetry={() => undefined}
      />
      <UnavailableNotice reason={DEGRADED_REASON} />
    </div>
  );
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('LoadingSkeleton', () => {
  test('読み込み中であることを状態の領域の文言で支援技術へ伝え、スケルトンの形は読み上げの対象にしない', async () => {
    await render(<LoadingSkeleton />);

    const status = page.getByRole('status');
    await expect.element(status).toHaveTextContent('読み込み中');
    const skeletons = status
      .element()
      .querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(
      status
        .element()
        .querySelector('[aria-hidden="true"]')
        ?.contains(skeletons[0] ?? null),
    ).toBe(true);
  });

  test('読み込む対象の文言と、項目の形を保ったスケルトンを渡せる', async () => {
    await render(
      <LoadingSkeleton label="プロダクト一覧を読み込み中">
        <Skeleton data-testid="logo" className="size-14" />
      </LoadingSkeleton>,
    );

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('プロダクト一覧を読み込み中');
    await expect.element(page.getByTestId('logo')).toBeInTheDocument();
  });

  test('視差効果を減らす設定で動きが止まっても、読み込み中であることを文言で伝える', async () => {
    await emulateReducedMotion('reduce');
    await render(<LoadingSkeleton />);

    const status = page.getByRole('status');
    const skeleton = status.element().querySelector('[data-slot="skeleton"]');

    expect(skeleton && getComputedStyle(skeleton).animationIterationCount).toBe(
      '1',
    );
    await expect.element(status).toHaveTextContent('読み込み中');
  });

  test('読み込み中の状態はTabの移動先にならない', async () => {
    await render(
      <>
        <LoadingSkeleton />
        <button type="button">戻る</button>
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '戻る' }))
      .toHaveFocus();
  });
});

describe('EmptyState', () => {
  test('空であることの文言と説明に、次の行動への導線を添える', async () => {
    await render(
      <EmptyState
        title={EMPTY_DIRECTORY}
        description={EMPTY_DIRECTORY_DESCRIPTION}
        action={<a href="/launch">ローンチを予約</a>}
      />,
    );

    await expect.element(page.getByText(EMPTY_DIRECTORY)).toBeVisible();
    await expect
      .element(page.getByText(EMPTY_DIRECTORY_DESCRIPTION))
      .toBeVisible();
    await userEvent.tab();
    await expect
      .element(page.getByRole('link', { name: 'ローンチを予約' }))
      .toHaveFocus();
  });

  test('説明と導線を省くと、空であることの文言だけを表示する', async () => {
    const { container } = await render(
      <EmptyState title="まだUpvoteしたマッチはありません。" />,
    );

    expect(container.textContent).toBe('まだUpvoteしたマッチはありません。');
  });

  test('見出しのレベルを省くと、表題を見出しにしない', async () => {
    await render(<EmptyState title={EMPTY_DIRECTORY} />);

    expect(page.getByRole('heading').elements()).toHaveLength(0);
  });

  test('見出しのレベルを渡すと、表題をそのレベルの見出しにし、見出しを名前とする区画にする', async () => {
    await render(<EmptyState title={EMPTY_DIRECTORY} headingLevel={2} />);

    await expect
      .element(page.getByRole('heading', { level: 2, name: EMPTY_DIRECTORY }))
      .toBeVisible();
    await expect
      .element(page.getByRole('region', { name: EMPTY_DIRECTORY }))
      .toBeVisible();
  });
});

describe('ErrorState', () => {
  test('エラーの文言を警告として伝え、再試行の操作と問い合わせへの導線を出す', async () => {
    const onRetry = vi.fn();
    await render(
      <ErrorState
        message={PAGE_LOAD_ERROR}
        onRetry={onRetry}
        contactHref={CONTACT_HREF}
      />,
    );

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(PAGE_LOAD_ERROR);
    await expect.element(contactLink()).toHaveAttribute('href', CONTACT_HREF);
    await userEvent.click(retryButton());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('再試行はキーボードでも操作でき、Tabの順は再試行、問い合わせの順になる', async () => {
    const onRetry = vi.fn();
    await render(
      <ErrorState
        message={PAGE_LOAD_ERROR}
        onRetry={onRetry}
        contactHref={CONTACT_HREF}
      />,
    );

    await userEvent.tab();
    await expect.element(retryButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    await expect.element(contactLink()).toHaveFocus();
  });

  test('管理者側のように問い合わせの導線を受けなければ、問い合わせのリンクを描かず再試行だけを出す', async () => {
    const message =
      '一覧を読み込めませんでした。時間をおいて再度お試しください。';
    const { container } = await render(
      <ErrorState message={message} onRetry={() => undefined} />,
    );

    await expect.element(retryButton()).toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(container.textContent).toBe(`${message}再試行`);
  });

  test('失敗の利用者向けの文言だけを表示し、エラーコードや状態コードなどの技術的な詳細を出さない', async () => {
    const error = new GraphQLClientError({
      code: 'internal_error',
      message: '問題が発生しました。時間をおいて再度お試しください。',
      status: 500,
    });
    const { container } = await render(
      <ErrorState
        message={error.message}
        onRetry={() => undefined}
        contactHref={CONTACT_HREF}
      />,
    );

    expect(container.textContent).toBe(
      '問題が発生しました。時間をおいて再度お試しください。再試行お問い合わせ',
    );
  });
});

describe('PartialErrorState', () => {
  test('ページの他の部分を保ったまま、失敗した区画にだけ警告と再試行の操作を出す', async () => {
    const onRetry = vi.fn();
    await render(
      <main>
        <h1>Pitch Notes</h1>
        <p>会議のメモを要点に整理するアプリです。</p>
        <section aria-label="コメント">
          <PartialErrorState message={PARTIAL_LOAD_ERROR} onRetry={onRetry} />
        </section>
      </main>,
    );

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    const region = page.getByRole('region', { name: 'コメント' });
    await expect
      .element(region.getByRole('alert'))
      .toHaveTextContent(PARTIAL_LOAD_ERROR);
    await userEvent.click(region.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('UnavailableNotice', () => {
  test('「現在ご利用いただけません。」と理由を、文言規則の表の文言どおりに状態として伝える', async () => {
    await render(<UnavailableNotice reason={DEGRADED_REASON} />);

    const status = page.getByRole('status');
    await expect.element(status).toBeVisible();
    expect(status.element().textContent).toBe(DEGRADED_MESSAGE);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('すべての状態表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(<AllStates />);

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
