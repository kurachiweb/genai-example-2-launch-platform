import { isContentClipped } from './computed-style.ts';

export function hasHorizontalScroll(): boolean {
  const root = document.documentElement;
  return root.scrollWidth > root.clientWidth;
}

function describeElement(element: Element): string {
  return element.outerHTML.slice(0, 80);
}

// 親のoverflowで切り取られた子や左端の外へのはみ出しは文書の横スクロールに現れないため、描画された要素ごとに画面の左右の端の内側にあるかを見る
export function elementsBeyondViewportEdges(
  rootSelector: string,
): readonly string[] {
  return Array.from(
    document.querySelectorAll(`:is(${rootSelector}), :is(${rootSelector}) *`),
  )
    .filter((element) => {
      const { width, left, right } = element.getBoundingClientRect();
      return width > 0 && (left < 0 || right > window.innerWidth);
    })
    .map(describeElement);
}

export function elementsOverflowingContainer(
  container: Element,
): readonly string[] {
  const bounds = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll('*'))
    .filter((element) => {
      const { width, left, right } = element.getBoundingClientRect();
      return width > 0 && (left < bounds.left || right > bounds.right);
    })
    .map(describeElement);
}

export function elementsWithClippedContent(
  elements: Iterable<Element>,
): readonly string[] {
  return Array.from(elements).filter(isContentClipped).map(describeElement);
}
