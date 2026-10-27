import { describe, expect, test } from 'bun:test';

import { cn } from './class-names.ts';

describe('cn', () => {
  test('文字列・条件付きの値・配列・オブジェクトをつなぎ、偽の値を除く', () => {
    expect(
      cn('flex', false, null, undefined, ['items-center', ['gap-2']], {
        'font-bold': true,
        italic: false,
      }),
    ).toBe('flex items-center gap-2 font-bold');
  });

  test('衝突するユーティリティは後に書いたものを残す', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
    expect(cn('hover:bg-muted', 'hover:bg-accent')).toBe('hover:bg-accent');
  });

  test('デザイントークンの色・ブレークポイント・フォントを衝突の判定に含める', () => {
    expect(cn('bg-primary', 'bg-destructive')).toBe('bg-destructive');
    expect(cn('text-muted-foreground', 'text-gold-foreground')).toBe(
      'text-gold-foreground',
    );
    expect(cn('xs:px-2', 'xs:px-4')).toBe('xs:px-4');
    expect(cn('font-sans', 'font-display')).toBe('font-display');
  });

  test('種類の異なるユーティリティは両方を残す', () => {
    expect(cn('text-primary', 'text-sm')).toBe('text-primary text-sm');
    expect(cn('font-display', 'font-bold')).toBe('font-display font-bold');
  });

  test('何も渡さなければ空文字を返す', () => {
    expect(cn()).toBe('');
  });
});
