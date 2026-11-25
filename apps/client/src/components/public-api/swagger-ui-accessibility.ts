import { API_DOCS_MESSAGES } from './api-docs-messages.ts';

const observedRoots = new WeakSet<HTMLElement>();

const nameUnlabeled = (
  root: HTMLElement,
  selector: string,
  nameOf: (element: Element) => string | undefined,
): void => {
  for (const element of root.querySelectorAll(
    `${selector}:not([aria-label], [aria-labelledby])`,
  )) {
    const name = nameOf(element);
    if (name !== undefined && name !== '') {
      element.setAttribute('aria-label', name);
    }
  }
};

// 表示の文言と異なる名前は、見えている文言で操作する音声入力の利用者が押せないため、表示の文言を名前にする
const dropMismatchedButtonNames = (root: HTMLElement): void => {
  for (const button of root.querySelectorAll('button[aria-label]')) {
    const visibleText = button.textContent.trim().toLowerCase();
    const label = (button.getAttribute('aria-label') ?? '').toLowerCase();
    if (visibleText !== '' && !label.includes(visibleText)) {
      button.removeAttribute('aria-label');
    }
  }
};

// 例と応答の表示は縦にスクロールする領域になるため、キーボードでもスクロールできるようフォーカスを受けられるようにする
const makeCodeBlocksFocusable = (root: HTMLElement): void => {
  for (const block of root.querySelectorAll(
    '.highlight-code > .microlight:not([tabindex])',
  )) {
    block.setAttribute('tabindex', '0');
  }
};

const applyAccessibility = (root: HTMLElement): void => {
  nameUnlabeled(
    root,
    'select#servers',
    () => API_DOCS_MESSAGES.serverSelectLabel,
  );
  nameUnlabeled(
    root,
    'tr[data-param-name] select',
    (select) =>
      select.closest<HTMLElement>('tr[data-param-name]')?.dataset.paramName,
  );
  nameUnlabeled(
    root,
    'button.close-modal',
    () => API_DOCS_MESSAGES.closeDialogLabel,
  );
  dropMismatchedButtonNames(root);
  makeCodeBlocksFocusable(root);
};

// Swagger UIは操作の開閉や試行のたびに部品を作り直すため、描画先への追加を見張り、作り直した部品にも名前とフォーカスを付け直す
export function observeSwaggerUiAccessibility(root: HTMLElement): void {
  applyAccessibility(root);
  if (observedRoots.has(root)) {
    return;
  }
  observedRoots.add(root);
  new MutationObserver(() => {
    applyAccessibility(root);
  }).observe(root, { childList: true, subtree: true });
}
