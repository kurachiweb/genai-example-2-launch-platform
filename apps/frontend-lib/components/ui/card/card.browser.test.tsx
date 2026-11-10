import type { ComponentType, HTMLAttributes } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  isContentClipped,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../../test/overflow.ts';
import { Button } from '../button/button.tsx';
import { Card } from './card.tsx';
import { CardAction } from './card-action.tsx';
import { CardContent } from './card-content.tsx';
import { CardDescription } from './card-description.tsx';
import { CardFooter } from './card-footer.tsx';
import { CardHeader } from './card-header.tsx';
import { CardTitle } from './card-title.tsx';

interface CardPart {
  readonly name: string;
  readonly Component: ComponentType<HTMLAttributes<HTMLDivElement>>;
  readonly slot: string;
  readonly defaultClass: string;
  readonly overridingClass: string;
}

const CARD_PARTS: readonly CardPart[] = [
  {
    name: 'Card',
    Component: Card,
    slot: 'card',
    defaultClass: 'gap-6',
    overridingClass: 'gap-2',
  },
  {
    name: 'CardHeader',
    Component: CardHeader,
    slot: 'card-header',
    defaultClass: 'px-6',
    overridingClass: 'px-4',
  },
  {
    name: 'CardTitle',
    Component: CardTitle,
    slot: 'card-title',
    defaultClass: 'font-semibold',
    overridingClass: 'font-bold',
  },
  {
    name: 'CardDescription',
    Component: CardDescription,
    slot: 'card-description',
    defaultClass: 'text-sm',
    overridingClass: 'text-xs',
  },
  {
    name: 'CardAction',
    Component: CardAction,
    slot: 'card-action',
    defaultClass: 'justify-self-end',
    overridingClass: 'justify-self-start',
  },
  {
    name: 'CardContent',
    Component: CardContent,
    slot: 'card-content',
    defaultClass: 'px-6',
    overridingClass: 'px-4',
  },
  {
    name: 'CardFooter',
    Component: CardFooter,
    slot: 'card-footer',
    defaultClass: 'items-center',
    overridingClass: 'items-start',
  },
];

const PART_TEST_ID = 'card-part';
const NARROW_PARENT_TEST_ID = 'narrow-parent';
const NARROW_PARENT_WIDTH = 240;
const LONG_TITLE =
  'The progress of your latest launch and the next reservation for this product';
const LONG_ACTION_LABEL = 'Reserve the next launch of this product';

function OwnerCard({
  title = 'あなたのプロダクト',
  actionLabel = '編集',
}: {
  readonly title?: string;
  readonly actionLabel?: string;
}) {
  return (
    <Card role="region" aria-labelledby="owner-card-title">
      <CardHeader>
        <CardTitle>
          <h2 id="owner-card-title">{title}</h2>
        </CardTitle>
        <CardDescription>直近のローンチは予選の結果待ちです。</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            {actionLabel}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>次回のローンチの予約は、予選の結果が確定してからできます。</p>
      </CardContent>
      <CardFooter>
        <Button>再ローンチを予約</Button>
      </CardFooter>
    </Card>
  );
}

const part = () => page.getByTestId(PART_TEST_ID).element();

afterEach(() => {
  applyColorScheme('light');
});

describe('Card', () => {
  test.each(CARD_PARTS)(
    '$nameは、部分の名前のdata-slotを持つdivを描画する',
    async ({ Component, slot }) => {
      await render(<Component data-testid={PART_TEST_ID}>内容</Component>);

      expect(part().tagName).toBe('DIV');
      expect(part()).toHaveAttribute('data-slot', slot);
      expect(part()).toHaveTextContent('内容');
    },
  );

  test.each(CARD_PARTS)(
    '$nameは、渡したクラスを既定のクラスと合成し、衝突するクラスは渡した側を優先する',
    async ({ Component, defaultClass, overridingClass }) => {
      await render(
        <>
          <Component data-testid={PART_TEST_ID} className="custom-class" />
          <Component data-testid="overridden" className={overridingClass} />
        </>,
      );
      const overridden = page.getByTestId('overridden').element();

      expect(part()).toHaveClass('custom-class', defaultClass);
      expect(overridden).toHaveClass(overridingClass);
      expect(overridden).not.toHaveClass(defaultClass);
    },
  );

  test.each(CARD_PARTS)(
    '$nameは、受け取った属性を要素へ渡す',
    async ({ Component }) => {
      await render(
        <Component
          data-testid={PART_TEST_ID}
          id="owner-card"
          aria-label="あなたのプロダクト"
          translate="no"
        />,
      );

      expect(part()).toHaveAttribute('id', 'owner-card');
      expect(part()).toHaveAttribute('aria-label', 'あなたのプロダクト');
      expect(part()).toHaveAttribute('translate', 'no');
    },
  );

  test('見出しを置いたタイトルと、Cardに渡した役割と名前の関連付けで、名前の付いた区画として読める', async () => {
    await render(<OwnerCard />);

    await expect
      .element(page.getByRole('region', { name: 'あなたのプロダクト' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('heading', { name: 'あなたのプロダクト' }))
      .toBeInTheDocument();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、カードのトークンの背景と文字の色と、境界線のトークンの色の枠で描画し、説明は弱めた文字の色にする',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<OwnerCard />);
      const card = page.getByRole('region').element();
      const { backgroundColor, color, borderTopColor, borderTopWidth } =
        getComputedStyle(card);
      const description = page
        .getByText('直近のローンチは予選の結果待ちです。')
        .element();

      expect(backgroundColor).toBe(tokenColorOf('card'));
      expect(color).toBe(tokenColorOf('card-foreground'));
      expect(borderTopColor).toBe(tokenColorOf('border'));
      expect(borderTopWidth).toBe('1px');
      expect(getComputedStyle(description).color).toBe(
        tokenColorOf('muted-foreground'),
      );
    },
  );

  test('見出しの操作は、タイトルと説明の右側の上端に置く', async () => {
    await render(<OwnerCard />);
    const title = page.getByRole('heading').element().getBoundingClientRect();
    const description = page
      .getByText('直近のローンチは予選の結果待ちです。')
      .element()
      .getBoundingClientRect();
    const action = page
      .getByRole('button', { name: '編集' })
      .element()
      .getBoundingClientRect();

    expect(action.left).toBeGreaterThanOrEqual(title.right);
    expect(action.left).toBeGreaterThanOrEqual(description.right);
    expect(action.top).toBeLessThan(description.top);
  });

  test('幅を絞った親の中では、タイトルと操作の文言が翻訳で長くなっても折り返し、親から溢れず操作の文言が切れない', async () => {
    await render(
      <div
        data-testid={NARROW_PARENT_TEST_ID}
        style={{ width: NARROW_PARENT_WIDTH }}
      >
        <OwnerCard title={LONG_TITLE} actionLabel={LONG_ACTION_LABEL} />
      </div>,
    );
    const parent = page.getByTestId(NARROW_PARENT_TEST_ID).element();
    const action = page
      .getByRole('button', { name: LONG_ACTION_LABEL })
      .element();

    expect(elementsOverflowingContainer(parent)).toStrictEqual([]);
    expect(isContentClipped(action)).toBe(false);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('見出し・説明・操作・本文・フッターを持つカードで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="p-4">
          <OwnerCard />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
