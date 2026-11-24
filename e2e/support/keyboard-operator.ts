import { expect, type Locator, type Page } from '@playwright/test';

import {
  describeFocusProblem,
  type FocusIndicatorStyle,
  hasVisibleFocusIndicator,
} from './keyboard-focus.ts';

// 1つの要素へTabで届くまでの上限。ヘッダーとナビゲーションの項目を通るため多めにとる
const MAX_FOCUS_PRESSES = 150;

const MAX_ARROW_PRESSES = 250;

// フォーカスの輪郭は`transition-all`の部品で0から2pxへ動くため、動きが終わるまで待つ
const FOCUS_INDICATOR_TIMEOUT_MS = 2_000;

const ESCAPE_RETRY_INTERVAL_MS = 1_500;

const ESCAPE_TIMEOUT_MS = 15_000;

// 開いた直後の受け付けの遅れで許す押し直しを含めた、Escapeの回数の上限
const MAX_POPUP_ESCAPE_PRESSES = 2;

const MAX_TRAP_PRESSES = 400;

interface FocusSnapshot extends FocusIndicatorStyle {
  readonly id: string;
  readonly isDocument: boolean;
}

type DirectionToTarget = 'focused' | 'forward' | 'backward';

// ページの中で動かす。要素の識別子は、同じ要素の再検査を避けるために付ける
function snapshotActiveElement(): FocusSnapshot {
  const host = globalThis as unknown as {
    __keyboardIds?: { readonly map: WeakMap<Element, number>; count: number };
  };
  host.__keyboardIds ??= { map: new WeakMap<Element, number>(), count: 0 };
  const ids = host.__keyboardIds;
  const element = document.activeElement ?? document.body;
  if (!ids.map.has(element)) {
    ids.count += 1;
    ids.map.set(element, ids.count);
  }
  const labelText = (element as HTMLInputElement).labels?.[0]?.textContent;
  const name = (
    element.getAttribute('aria-label') ??
    labelText ??
    element.getAttribute('title') ??
    element.textContent
  )
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .slice(0, 40);
  const role = element.getAttribute('role');
  const style = getComputedStyle(element);
  return {
    id: `${String(performance.timeOrigin)}-${String(ids.map.get(element) ?? 0)}`,
    isDocument:
      element === document.body || element === document.documentElement,
    description: `${element.tagName.toLowerCase()}${role === null ? '' : `[role=${role}]`}「${name}」`,
    focusVisible: element.matches(':focus-visible'),
    outlineStyle: style.outlineStyle,
    outlineWidthPx: Number.parseFloat(style.outlineWidth),
    outlineColor: style.outlineColor,
    boxShadow: style.boxShadow,
  };
}

// ターゲットが今のフォーカスより文書の前にあるか後にあるかで、Tabを押す向きを決める
function directionTo(target: Element): DirectionToTarget {
  const active = document.activeElement;
  if (target === active) {
    return 'focused';
  }
  if (active === null || active === document.body) {
    return 'forward';
  }
  return active.compareDocumentPosition(target) &
    Node.DOCUMENT_POSITION_FOLLOWING
    ? 'forward'
    : 'backward';
}

// 描画が終わった要素にだけ付くReactの内部の印。ハイドレーションの前に押した操作は何も起こさず、入力した値も状態に入らない
function carriesReactProps(element: Element): boolean {
  return Object.keys(element).some((key) => key.startsWith('__reactProps$'));
}

// 文書の先頭にフォーカスを置き、最後のTabの停止位置を控える。表示されていない要素と、ロービングで停止位置から外れるラジオと、自動で消えるトーストは除く
function focusFirstAndMarkLastTabbable(): string | null {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]):not([type="radio"]), select, textarea, [tabindex]',
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !(element as HTMLButtonElement).disabled &&
      element.closest(
        '[inert], [aria-hidden="true"], [data-sonner-toaster]',
      ) === null &&
      element.checkVisibility(),
  );
  const first = candidates.at(0);
  const last = candidates.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const host = globalThis as unknown as { __keyboardLast?: Element };
  host.__keyboardLast = last;
  first.focus();
  const name = (last.getAttribute('aria-label') ?? last.textContent)
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .slice(0, 40);
  return `${last.tagName.toLowerCase()}「${name}」`;
}

function isMarkedLastTabbableFocused(): boolean {
  const host = globalThis as unknown as { __keyboardLast?: Element };
  return document.activeElement === host.__keyboardLast;
}

// Radix UIは、開いたダイアログの層が最上位になった後の描画でEscapeの受け付けを付け替える。フォーカスが中へ移ってから数ミリ秒の間は、Tabで通り過ぎたツールチップのように閉じる途中の層がEscapeを受け取って捨てる。人は開いたダイアログが見えてから押すため、ダイアログの開く動きと、閉じる途中の層の動きが終わってから押す
function hasSettledLayerAnimations(dialog: Element): boolean {
  return document.getAnimations().every((animation) => {
    const target =
      animation.effect instanceof KeyframeEffect
        ? animation.effect.target
        : null;
    if (target === null) {
      return true;
    }
    const settling =
      target === dialog || target.getAttribute('data-state') === 'closed';
    return !settling || animation.playState !== 'running';
  });
}

export async function isHydrated(target: Locator): Promise<boolean> {
  return target.evaluate(carriesReactProps);
}

// キーボードだけの操作者。フォーカスの移動は`page.keyboard`のTab・Shift+Tab・矢印キーだけで行い、クリックと`fill`を使わない
export class KeyboardOperator {
  readonly #page: Page;
  readonly #inspectedStops = new Set<string>();
  readonly #stopLog: string[] = [];

  constructor(page: Page) {
    this.#page = page;
  }

  get page(): Page {
    return this.#page;
  }

  async #snapshot(): Promise<FocusSnapshot> {
    return this.#page.evaluate(snapshotActiveElement);
  }

  // 止まった要素のフォーカスが見えることを確かめる。同じ要素は一度だけ確かめ、見えない場合は後続の確認を続けるため、ソフトな失敗にする
  async #inspectActiveElement(): Promise<void> {
    const snapshot = await this.#snapshot();
    if (snapshot.isDocument || this.#inspectedStops.has(snapshot.id)) {
      return;
    }
    this.#inspectedStops.add(snapshot.id);
    this.#stopLog.push(snapshot.description);
    let latest = snapshot;
    try {
      await expect
        .poll(
          async () => {
            latest = await this.#snapshot();
            // 検査の間にフォーカスが別の要素へ移った場合は、その要素の停止で改めて検査する
            return (
              latest.id !== snapshot.id || hasVisibleFocusIndicator(latest)
            );
          },
          { timeout: FOCUS_INDICATOR_TIMEOUT_MS },
        )
        .toBe(true);
    } catch {
      expect.soft(false, describeFocusProblem(latest)).toBe(true);
    }
  }

  // ターゲットがフォーカスを持つまでTabかShift+Tabを押し、止まった全ての要素のフォーカスが見えることを確かめる
  async focus(target: Locator, name: string): Promise<void> {
    await expect(target, `${name}が表示されている`).toBeVisible();
    const startedAt = this.#stopLog.length;
    for (let presses = 0; presses <= MAX_FOCUS_PRESSES; presses += 1) {
      const direction = await target.evaluate(directionTo);
      if (direction === 'focused') {
        await this.#inspectActiveElement();
        return;
      }
      await this.#page.keyboard.press(
        direction === 'forward' ? 'Tab' : 'Shift+Tab',
      );
      await this.#inspectActiveElement();
    }
    throw new Error(
      `${name}へキーボードで${String(MAX_FOCUS_PRESSES)}回以内に到達できませんでした。確かめた停止位置: ${this.#stopLog.slice(startedAt).join(' → ')}`,
    );
  }

  async waitUntilHydrated(target: Locator, name: string): Promise<void> {
    await expect
      .poll(() => isHydrated(target), {
        message: `${name}がハイドレーションされる`,
        timeout: 30_000,
      })
      .toBe(true);
  }

  async press(key: string): Promise<void> {
    await this.#page.keyboard.press(key);
  }

  // ハイドレーションの前に押した操作は何も起こさないため、押せる状態を待ってから押す
  async activate(
    target: Locator,
    name: string,
    key: 'Enter' | 'Space' = 'Enter',
  ): Promise<void> {
    await expect(target, `${name}が表示されている`).toBeVisible();
    await this.waitUntilHydrated(target, name);
    await this.focus(target, name);
    await this.#page.keyboard.press(key);
  }

  async type(target: Locator, name: string, text: string): Promise<void> {
    await expect(target, `${name}が表示されている`).toBeVisible();
    await this.waitUntilHydrated(target, name);
    await this.focus(target, name);
    await this.#page.keyboard.type(text);
    await expect(target, `${name}に入力した値`).toHaveValue(text);
  }

  // チェックボックスはSpaceで切り替える
  async check(target: Locator, name: string): Promise<void> {
    await expect(target, `${name}が表示されている`).toBeVisible();
    await this.waitUntilHydrated(target, name);
    await this.focus(target, name);
    await this.#page.keyboard.press('Space');
    await expect(target, `${name}がSpaceで選ばれる`).toBeChecked();
  }

  // 矢印キーで移るグループ(ラジオ・メニュー・選択肢)で、ターゲットがフォーカスを持つまで押し続ける
  async arrowTo(
    target: Locator,
    name: string,
    key: 'ArrowDown' | 'ArrowUp' | 'ArrowRight' = 'ArrowDown',
    // カレンダーのように、矢印キーで移った先の月にターゲットが描かれる場合は、最初から表示されていなくてよい
    {
      appearsWhileMoving = false,
    }: { readonly appearsWhileMoving?: boolean } = {},
  ): Promise<void> {
    if (!appearsWhileMoving) {
      await expect(target, `${name}が表示されている`).toBeVisible();
    }
    for (let presses = 0; presses <= MAX_ARROW_PRESSES; presses += 1) {
      if (
        (await target.count()) === 1 &&
        (await target.evaluate(directionTo)) === 'focused'
      ) {
        await this.#inspectActiveElement();
        return;
      }
      await this.#page.keyboard.press(key);
    }
    throw new Error(
      `${name}へ${key}で${String(MAX_ARROW_PRESSES)}回以内に到達できませんでした`,
    );
  }

  // ラジオのグループ(星の評価を含む)は、グループへTabで入り、矢印キーで選ぶ
  async chooseRadio(
    group: Locator,
    radio: Locator,
    name: string,
    // 星の評価は、右と上が次の星、左と下が前の星である
    forwardKey: 'ArrowDown' | 'ArrowRight' = 'ArrowDown',
  ): Promise<void> {
    await this.focusInto(group, `${name}のグループ`);
    await this.arrowTo(radio, name, forwardKey);
    await expect(radio, `${name}が選ばれる`).toBeChecked();
  }

  // グループの中のどれかの要素がフォーカスを持つまでTabを押す
  async focusInto(group: Locator, name: string): Promise<void> {
    await expect(group, `${name}が表示されている`).toBeVisible();
    const startedAt = this.#stopLog.length;
    for (let presses = 0; presses <= MAX_FOCUS_PRESSES; presses += 1) {
      const inside = await group.evaluate((element) =>
        element.contains(document.activeElement),
      );
      if (inside) {
        return;
      }
      const forward = await group.evaluate(
        (element) =>
          document.activeElement === null ||
          document.activeElement === document.body ||
          (document.activeElement.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      );
      await this.#page.keyboard.press(forward ? 'Tab' : 'Shift+Tab');
      await this.#inspectActiveElement();
    }
    throw new Error(
      `${name}へキーボードで${String(MAX_FOCUS_PRESSES)}回以内に到達できませんでした。確かめた停止位置: ${this.#stopLog.slice(startedAt).join(' → ')}`,
    );
  }

  // 選択の部品(Radix UIのSelect)は、Enterで開き、矢印キーで選択肢へ移り、Enterで確定する
  async chooseOption(
    trigger: Locator,
    optionName: string,
    name: string,
    // 選択肢が多い一覧の末尾の選択肢は、Endで末尾へ移ってから矢印キーで探す
    { fromEnd = false }: { readonly fromEnd?: boolean } = {},
  ): Promise<void> {
    await this.activate(trigger, name);
    const option = this.#page.getByRole('option', {
      name: optionName,
      exact: true,
    });
    await expect(option, `${name}の選択肢「${optionName}」`).toBeVisible();
    if (fromEnd) {
      await this.#page.keyboard.press('End');
    }
    await this.arrowTo(
      option,
      `${name}の選択肢「${optionName}」`,
      fromEnd ? 'ArrowUp' : 'ArrowDown',
    );
    await this.#page.keyboard.press('Enter');
    await expect(trigger, `${name}の選択肢が閉じる`).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(trigger, `${name}の選んだ値`).toContainText(optionName);
  }

  // メニューは、トリガーのEnterで開き、矢印キーで項目へ移り、Enterで実行する
  async chooseMenuItem(
    trigger: Locator,
    itemName: string,
    name: string,
  ): Promise<void> {
    await this.activate(trigger, name);
    const item = this.#page.getByRole('menuitem', {
      name: itemName,
      exact: true,
    });
    await expect(item, `${name}の項目「${itemName}」`).toBeVisible();
    await this.arrowTo(item, `${name}の項目「${itemName}」`);
    await this.#page.keyboard.press('Enter');
  }

  // ダイアログの規約。フォーカスが中へ移ったことを確かめた後、1回のEscapeで閉じ、フォーカスが開いた要素へ戻ることを確かめる。Tabで外へ出られない場合の脱出の手段である
  async expectDialogEscapeCloses(
    dialog: Locator,
    name: string,
    opener: Locator,
  ): Promise<void> {
    await this.expectFocusInside(dialog, name);
    await expect
      .poll(() => dialog.evaluate(hasSettledLayerAnimations), {
        message: `${name}の開く動きと、閉じる途中の他の層の動きが終わる`,
      })
      .toBe(true);
    await this.#page.keyboard.press('Escape');
    await expect(dialog, `${name}が1回のEscapeで閉じる`).toHaveCount(0);
    await expect(opener, `${name}を閉じた後のフォーカス`).toBeFocused();
  }

  // メニューと選択肢の一覧の規約。開いた直後はEscapeの受け付けが整う前に届くことがあるため、人と同じく閉じるまで押し直す。押した回数が上限を超えたら、失敗に残す
  async expectPopupEscapeCloses(
    popup: Locator,
    name: string,
    trigger: Locator,
  ): Promise<void> {
    let presses = 0;
    await expect(async () => {
      if ((await popup.count()) > 0) {
        await this.#page.keyboard.press('Escape');
        presses += 1;
      }
      await expect(popup, `${name}がEscapeで閉じる`).toHaveCount(0, {
        timeout: ESCAPE_RETRY_INTERVAL_MS,
      });
    }).toPass({ timeout: ESCAPE_TIMEOUT_MS });
    expect
      .soft(
        presses,
        `${name}を閉じるのにEscapeを${String(presses)}回押しました(上限${String(MAX_POPUP_ESCAPE_PRESSES)}回)`,
      )
      .toBeLessThanOrEqual(MAX_POPUP_ESCAPE_PRESSES);
    await expect(trigger, `${name}を閉じた後のフォーカス`).toBeFocused();
  }

  // ダイアログを開いた直後のフォーカスが、ダイアログの中にあることを確かめる
  async expectFocusInside(container: Locator, name: string): Promise<void> {
    await expect
      .poll(
        () =>
          container.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        { message: `${name}を開いた直後のフォーカスが中にある` },
      )
      .toBe(true);
  }

  // 文書の最初の操作できる要素からTabを押し続け、最後の操作できる要素へ届くことを確かめる。途中で同じ要素へ戻るか文書の外へ出ると、小さな範囲を巡って先へ進めない、キーボードの罠である。止まった全ての要素のフォーカスも確かめる
  async expectTabAdvancesThroughPage(pageName: string): Promise<void> {
    const lastTabbable = await this.#page.evaluate(
      focusFirstAndMarkLastTabbable,
    );
    if (lastTabbable === null) {
      return;
    }
    // 直前の操作がマウスだと、プログラムによるフォーカスは:focus-visibleに一致しない。先頭の要素へはキーボードで戻して、人がTabで着く時と同じ状態にする
    await this.#page.keyboard.press('Tab');
    await this.#page.keyboard.press('Shift+Tab');
    await this.#inspectActiveElement();
    const seen = new Set<string>();
    const path: string[] = [];
    let reachedLast = await this.#page.evaluate(isMarkedLastTabbableFocused);
    for (
      let presses = 0;
      !reachedLast && presses < MAX_TRAP_PRESSES;
      presses += 1
    ) {
      await this.#page.keyboard.press('Tab');
      const snapshot = await this.#snapshot();
      if (snapshot.isDocument || seen.has(snapshot.id)) {
        break;
      }
      seen.add(snapshot.id);
      path.push(snapshot.description);
      await this.#inspectActiveElement();
      reachedLast = await this.#page.evaluate(isMarkedLastTabbableFocused);
    }
    expect(
      reachedLast,
      `${pageName}でTabを押し続けても最後の要素${lastTabbable}へ届きません。経由した停止位置: ${path.join(' → ')}`,
    ).toBe(true);
  }
}
