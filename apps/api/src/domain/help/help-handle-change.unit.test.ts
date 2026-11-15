import { describe, expect, test } from 'bun:test';

import { planHelpHandleChange } from './help-handle-change.ts';

describe('planHelpHandleChange', () => {
  test('同じ表記ならnoneを返す', () => {
    expect(planHelpHandleChange('getting-started', 'getting-started')).toEqual({
      kind: 'none',
    });
  });

  test('ASCIIの英字の大文字小文字だけが違えばcase-onlyで新しい表記を返す', () => {
    expect(planHelpHandleChange('getting-started', 'Getting-Started')).toEqual({
      kind: 'case-only',
      next: 'Getting-Started',
    });
  });

  test('別の文字列ならchangedで新しいハンドルと変更前のハンドルを返す', () => {
    expect(planHelpHandleChange('getting-started', 'first-steps')).toEqual({
      kind: 'changed',
      next: 'first-steps',
      previous: 'getting-started',
    });
  });

  test('変更前の表記を大文字小文字のまま旧ハンドルに渡す', () => {
    expect(planHelpHandleChange('Getting-Started', 'faq')).toEqual({
      kind: 'changed',
      next: 'faq',
      previous: 'Getting-Started',
    });
  });
});
