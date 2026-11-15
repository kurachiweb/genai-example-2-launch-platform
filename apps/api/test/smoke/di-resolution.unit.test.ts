import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import { Greeting, greetingModule, SMOKE_TYPES } from './fixtures/greeting.ts';

describe('Bunの変換経路でのDIの解決', () => {
  test('@injectを付けたコンストラクタ引数へ識別子ごとの依存を注入して解決する', () => {
    const container = new Container({ defaultScope: 'Transient' });
    container.load(greetingModule);

    const greeting = container.get<Greeting>(SMOKE_TYPES.Greeting);

    expect(greeting).toBeInstanceOf(Greeting);
    expect(greeting.message()).toBe('こんにちは、Inversify');
  });
});
