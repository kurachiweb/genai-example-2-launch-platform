export type StressCondition =
  'plain' | 'text-spacing' | 'text-expansion' | 'font-scale';

export type LayoutIssueKind =
  'horizontal-scroll' | 'element-overflow' | 'overlap';

export interface LayoutIssue {
  readonly kind: LayoutIssueKind;
  readonly detail: string;
  readonly targets: readonly string[];
}

export interface MeasureOptions {
  readonly condition: StressCondition;
  readonly ratio: number;
}

// ページの中で動かすため、外の値を参照せず、補助の関数も全てこの関数の中に置く
export async function measureLayout(
  options: MeasureOptions,
): Promise<readonly LayoutIssue[]> {
  const { condition, ratio } = options;
  const MAX_REPORTED = 10;
  const EDGE_TOLERANCE_PX = 0.5;
  const MIN_VISIBLE_PX = 1;
  const MIN_OVERLAP_PX = 2;
  const MIN_OVERLAP_HEIGHT_RATIO = 0.3;
  const SKIPPED_TEXT_PARENTS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'TITLE',
  ]);
  const CONTROL_SELECTOR =
    'a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"]';
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

  interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  }

  interface Item {
    readonly owner: Element;
    readonly box: Box;
  }

  const toBox = (rect: DOMRect | Box): Box => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  });

  const describe = (element: Element): string => {
    const testId = element.getAttribute('data-testid');
    const slot = element.getAttribute('data-slot');
    const classes = [...element.classList].slice(0, 3).join('.');
    const text = element.textContent.replace(/\s+/g, ' ').trim();
    return [
      element.tagName.toLowerCase(),
      element.id === '' ? '' : `#${element.id}`,
      classes === '' ? '' : `.${classes}`,
      testId === null ? '' : `[data-testid=${testId}]`,
      slot === null ? '' : `[data-slot=${slot}]`,
      text === '' ? '' : ` "${text.slice(0, 24)}"`,
    ].join('');
  };

  const ancestorsOf = (element: Element): readonly Element[] => {
    const found: Element[] = [];
    for (
      let current = element.parentElement;
      current !== null;
      current = current.parentElement
    ) {
      found.push(current);
    }
    return found;
  };

  // 閉じた`details`の中身は描画されないのに、文字の矩形は返るため、見えない扱いにする
  const isInClosedDetails = (element: Element): boolean =>
    ancestorsOf(element).some(
      (ancestor) =>
        ancestor instanceof HTMLDetailsElement &&
        !ancestor.open &&
        !ancestor.querySelector(':scope > summary')?.contains(element),
    );

  const isInvisible = (element: Element): boolean => {
    if (
      getComputedStyle(element).visibility === 'hidden' ||
      isInClosedDetails(element)
    ) {
      return true;
    }
    return [element, ...ancestorsOf(element)].some((current) => {
      const style = getComputedStyle(current);
      return style.opacity === '0' || style.position === 'fixed';
    });
  };

  const clipByAncestors = (
    element: Element,
    box: Box,
    includeSelf: boolean,
  ): Box | null => {
    let clipped = box;
    const clippers = includeSelf
      ? [element, ...ancestorsOf(element)]
      : ancestorsOf(element);
    for (const ancestor of clippers) {
      if (ancestor === document.documentElement) {
        continue;
      }
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        clipped = {
          ...clipped,
          left: Math.max(clipped.left, rect.left),
          right: Math.min(clipped.right, rect.right),
        };
      }
      if (style.overflowY !== 'visible') {
        clipped = {
          ...clipped,
          top: Math.max(clipped.top, rect.top),
          bottom: Math.min(clipped.bottom, rect.bottom),
        };
      }
    }
    return clipped.right - clipped.left > MIN_VISIBLE_PX &&
      clipped.bottom - clipped.top > MIN_VISIBLE_PX
      ? clipped
      : null;
  };

  const applyStyleSheet = (css: string): (() => void) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (current) => current !== sheet,
      );
    };
  };

  const extendText = (text: string): string => {
    const target = Math.ceil(text.length * ratio);
    const trimmed = text.trim();
    const pieces = /\s/.test(trimmed)
      ? trimmed.split(/\s+/)
      : Array.from(trimmed);
    const joiner = /\s/.test(trimmed) ? ' ' : '';
    let extended = text;
    for (let index = 0; extended.length < target; index += 1) {
      extended += `${joiner}${pieces[index % pieces.length] ?? ''}`;
    }
    return extended;
  };

  const stretchTextNodes = (): (() => void) => {
    const originals: [Text, string][] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = node as Text;
      const parent = text.parentElement;
      if (
        parent !== null &&
        !SKIPPED_TEXT_PARENTS.has(parent.tagName) &&
        /\p{L}/u.test(text.data)
      ) {
        originals.push([text, text.data]);
      }
    }
    for (const [text, original] of originals) {
      text.data = extendText(original);
    }
    return () => {
      for (const [text, original] of originals) {
        text.data = original;
      }
    };
  };

  const applyCondition = (): (() => void) => {
    switch (condition) {
      case 'plain':
        return () => undefined;
      case 'text-spacing':
        return applyStyleSheet(
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
        );
      case 'font-scale':
        return applyStyleSheet(
          `html { font-size: ${String(ratio * 100)}% !important; }`,
        );
      case 'text-expansion':
        return stretchTextNodes();
    }
  };

  const settle = async (): Promise<void> => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

  const findOverflows = (): readonly LayoutIssue[] => {
    const issues: LayoutIssue[] = [];
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    if (root.scrollWidth > viewportWidth) {
      issues.push({
        kind: 'horizontal-scroll',
        detail: `文書の幅${String(root.scrollWidth)}pxが画面の幅${String(viewportWidth)}pxを超える`,
        targets: [],
      });
    }
    const beyond = new Set<Element>();
    for (const element of document.body.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= MIN_VISIBLE_PX ||
        rect.height <= MIN_VISIBLE_PX ||
        (rect.left >= -EDGE_TOLERANCE_PX &&
          rect.right <= viewportWidth + EDGE_TOLERANCE_PX) ||
        isInvisible(element)
      ) {
        continue;
      }
      const clippedInside = ancestorsOf(element).some(
        (ancestor) =>
          ancestor !== document.body &&
          ancestor !== root &&
          getComputedStyle(ancestor).overflowX !== 'visible',
      );
      if (!clippedInside) {
        beyond.add(element);
      }
    }
    // 外側の容器は子に押し広げられた結果のため、原因になる最も内側の要素だけを示す
    const innermost = [...beyond].filter(
      (element) =>
        !Array.from(element.children).some((child) => beyond.has(child)),
    );
    for (const element of innermost.slice(0, MAX_REPORTED)) {
      const rect = element.getBoundingClientRect();
      issues.push({
        kind: 'element-overflow',
        detail: `左端${String(Math.round(rect.left))}px・右端${String(Math.round(rect.right))}pxが画面の幅${String(viewportWidth)}pxの外へ出る`,
        targets: [describe(element)],
      });
    }
    return issues;
  };

  const ownerOfText = (text: Text): Element | null => {
    const parent = text.parentElement;
    if (parent === null) {
      return null;
    }
    const control = parent.closest(CONTROL_SELECTOR);
    if (control !== null) {
      return control;
    }
    const heading = parent.closest(HEADING_SELECTOR);
    if (heading !== null) {
      return heading;
    }
    let current: Element | null = parent;
    while (current !== null) {
      const { display } = getComputedStyle(current);
      if (!display.startsWith('inline') && display !== 'contents') {
        return current;
      }
      current = current.parentElement;
    }
    return parent;
  };

  const collectItems = (): readonly Item[] => {
    const items: Item[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = node as Text;
      const parent = text.parentElement;
      const owner = ownerOfText(text);
      if (
        parent === null ||
        owner === null ||
        text.data.trim() === '' ||
        SKIPPED_TEXT_PARENTS.has(parent.tagName) ||
        isInvisible(parent)
      ) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        const box = clipByAncestors(parent, toBox(rect), true);
        if (box !== null) {
          items.push({ owner, box });
        }
      }
    }
    // 折り返した行内のリンクは外接の矩形が行をまたいで隣と重なって見えるため、行ごとの矩形で測る
    for (const control of document.body.querySelectorAll(CONTROL_SELECTOR)) {
      if (isInvisible(control)) {
        continue;
      }
      for (const rect of control.getClientRects()) {
        const box =
          rect.width > MIN_VISIBLE_PX && rect.height > MIN_VISIBLE_PX
            ? clipByAncestors(control, toBox(rect), false)
            : null;
        if (box !== null) {
          items.push({ owner: control, box });
        }
      }
    }
    return items;
  };

  const intersection = (first: Box, second: Box) => ({
    width:
      Math.min(first.right, second.right) - Math.max(first.left, second.left),
    height:
      Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  });

  const heightOf = ({ top, bottom }: Box): number => bottom - top;

  const findOverlaps = (): readonly LayoutIssue[] => {
    const items = collectItems();
    const reported = new Map<string, LayoutIssue>();
    for (let first = 0; first < items.length; first += 1) {
      for (let second = first + 1; second < items.length; second += 1) {
        const a = items[first];
        const b = items[second];
        if (a === undefined || b === undefined || a.owner === b.owner) {
          continue;
        }
        // 項目の多い画面で高くつく包含の判定は、矩形が交わる対だけで行う
        const { width, height } = intersection(a.box, b.box);
        if (
          width > MIN_OVERLAP_PX &&
          height > MIN_OVERLAP_PX &&
          height / Math.min(heightOf(a.box), heightOf(b.box)) >
            MIN_OVERLAP_HEIGHT_RATIO &&
          !a.owner.contains(b.owner) &&
          !b.owner.contains(a.owner)
        ) {
          const targets = [describe(a.owner), describe(b.owner)];
          reported.set(targets.join(' / '), {
            kind: 'overlap',
            detail: `重なり${String(Math.round(width))}x${String(Math.round(height))}px`,
            targets,
          });
        }
      }
    }
    return [...reported.values()].slice(0, MAX_REPORTED);
  };

  const restore = applyCondition();
  try {
    await settle();
    return [...findOverflows(), ...findOverlaps()];
  } finally {
    restore();
  }
}
