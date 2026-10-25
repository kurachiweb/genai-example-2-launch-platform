import { describe, expect, test } from 'bun:test';

import type { Hono } from 'hono';
import { Container, ContainerModule } from 'inversify';

import type { AppModule } from './app-module.ts';

const GREETING = Symbol.for('test.Greeting');

const greetingBindings = new ContainerModule(({ bind }) => {
  bind(GREETING).toConstantValue('こんにちは');
});

const greetingModule: AppModule = {
  name: 'greeting',
  bindings: greetingBindings,
  routes: (app) => {
    app.get('/greetings', (c) => c.text('こんにちは'));
  },
};

describe('AppModule', () => {
  test('束縛を処理単位のコンテナへ同期で読み込める', () => {
    const container = new Container({ defaultScope: 'Transient' });

    expect(greetingModule.bindings).toBe(greetingBindings);
    container.load(greetingBindings);

    expect(container.get<string>(GREETING)).toBe('こんにちは');
  });

  test('ルートの登録関数が受け取ったHonoのアプリへ経路を登録する', () => {
    const registeredPaths: string[] = [];
    // coreはHonoを値として読み込めないため、経路の登録だけを記録するアプリで代用する
    const recordingApp = {
      get: (path: string) => {
        registeredPaths.push(path);
        return recordingApp;
      },
    } as unknown as Hono;

    greetingModule.routes?.(recordingApp);

    expect(registeredPaths).toEqual(['/greetings']);
  });

  test('環境の型を指定したHonoのアプリを受け取るモジュールを定義できる', () => {
    interface SampleHonoEnv {
      Bindings: { readonly HASH_PEPPER: string };
      Variables: { readonly correlationId: string };
    }
    const registeredPaths: string[] = [];
    const recordingApp = {
      get: (path: string) => {
        registeredPaths.push(path);
        return recordingApp;
      },
    } as unknown as Hono<SampleHonoEnv>;
    const typedModule: AppModule<Hono<SampleHonoEnv>> = {
      name: 'typed',
      routes: (app) => {
        app.get('/correlation', (c) => c.text(c.get('correlationId')));
      },
    };

    typedModule.routes?.(recordingApp);

    expect(registeredPaths).toEqual(['/correlation']);
  });
});
