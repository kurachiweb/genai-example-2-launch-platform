import { expect, type Locator, type Page } from '@playwright/test';

import {
  cancelUpvoteLabel,
  upvoteLabel,
  VOTE_UNIT,
} from '../../../apps/client/src/components/match/match-card-messages.ts';
import {
  UPVOTE_CANCELLED_MESSAGE,
  UPVOTED_MESSAGE,
} from '../../../apps/client/src/components/match/upvote-messages.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { RETRY_TIMEOUT_MS } from '../../support/hydration-retry.ts';
import { expectUpvoteState } from '../match-steps.ts';

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// ボタンの名前は見えているUpvote数と単位を続け「<名称>にUpvote 12票」の形になる
const buttonOf = (card: Locator, label: string): Locator =>
  card.getByRole('button', {
    name: new RegExp(
      `^${escapeRegExp(label)}\\s+[\\d,]+\\s*${escapeRegExp(VOTE_UNIT)}$`,
      'u',
    ),
  });

async function pressForToast(
  operator: KeyboardOperator,
  page: Page,
  button: Locator,
  name: string,
  key: 'Enter' | 'Space',
  message: string,
): Promise<void> {
  await operator.activate(button, name, key);
  await expect(page.getByText(message, { exact: true })).toBeVisible({
    timeout: RETRY_TIMEOUT_MS,
  });
}

// 対戦カードのUpvoteをEnterで、取り消しをSpaceで押し、Upvote数と押した状態の表示が変わることを確かめる
export async function upvoteAndCancelByKeyboard(
  operator: KeyboardOperator,
  card: Locator,
  productName: string,
): Promise<void> {
  const { page } = operator;
  await pressForToast(
    operator,
    page,
    buttonOf(card, upvoteLabel(productName)),
    `${productName}のUpvote`,
    'Enter',
    UPVOTED_MESSAGE,
  );
  await expectUpvoteState(card, productName, { count: 1, upvoted: true });

  await expect(page.getByText(UPVOTED_MESSAGE, { exact: true })).toHaveCount(
    0,
    {
      timeout: RETRY_TIMEOUT_MS,
    },
  );
  await pressForToast(
    operator,
    page,
    buttonOf(card, cancelUpvoteLabel(productName)),
    `${productName}のUpvoteの取り消し`,
    'Space',
    UPVOTE_CANCELLED_MESSAGE,
  );
  await expectUpvoteState(card, productName, { count: 0, upvoted: false });
}
