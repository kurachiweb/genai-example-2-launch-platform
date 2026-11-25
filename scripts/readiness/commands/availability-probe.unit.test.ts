import { describe, expect, test } from 'bun:test';

import type { PollerFetch } from '../adapters/http-poller.ts';
import { createVirtualClock } from '../test-fixtures/virtual-clock.ts';
import { createAvailabilityProbeCommand } from './availability-probe.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/readiness-command.ts';

interface Harness {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly urls: string[];
  readonly headers: Headers[];
  readonly execute: (args: readonly string[]) => Promise<number>;
}

const setup = (
  respond: (url: string) => Promise<Response> | Response,
): Harness => {
  const clock = createVirtualClock();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetch: PollerFetch = async (url, init) => {
    urls.push(url);
    headers.push(new Headers(init.headers));
    await clock.sleep(5);
    return respond(url);
  };
  const { run } = createAvailabilityProbeCommand({ fetch, clock });
  return {
    stdout,
    stderr,
    urls,
    headers,
    execute: (args) =>
      clock.run(
        run(args, {
          stdout: { write: (text) => stdout.push(text) },
          stderr: { write: (text) => stderr.push(text) },
        }),
      ),
  };
};

const ok = (): Response => new Response('ok', { status: 200 });

describe('availability-probe', () => {
  test('既定ではローカルの4つのアプリの経路へ1秒ごとにGETし、失敗が0件なら終了コード0で集計を表示する', async () => {
    const harness = setup(ok);

    const code = await harness.execute(['--duration', '60']);

    expect(code).toBe(EXIT_SUCCESS);
    expect(harness.urls).toHaveLength(240);
    expect([...new Set(harness.urls)].toSorted()).toEqual([
      'http://localhost:48042/health',
      'http://localhost:48043/health',
      'http://localhost:48044/',
      'http://localhost:48045/auth/login',
    ]);
    const output = harness.stdout.join('');
    expect(output).toContain(
      '- 利用者側 http://localhost:48044/: 60件、失敗0件、最大の応答時間5ms',
    );
    expect(output).toContain(
      '- 管理者側 http://localhost:48045/auth/login: 60件、失敗0件、最大の応答時間5ms',
    );
    expect(output).toContain(
      '- APIサーバー http://localhost:48042/health: 60件、失敗0件、最大の応答時間5ms',
    );
    expect(output).toContain(
      '- イベントサーバー http://localhost:48043/health: 60件、失敗0件、最大の応答時間5ms',
    );
    expect(output).toContain('判定: 成功(全対象で失敗0件)');
    expect(harness.stderr).toEqual([]);
  });

  test('3xxの応答は失敗に数えない', async () => {
    const harness = setup(() => new Response(null, { status: 302 }));

    expect(await harness.execute(['--duration', '3'])).toBe(EXIT_SUCCESS);
  });

  test('1つの対象が2xx・3xx以外を返すと終了コード1にし、その対象の失敗と内訳を表示する', async () => {
    const harness = setup(
      (url) =>
        new Response('x', {
          status: url.endsWith(':48043/health') ? 503 : 200,
        }),
    );

    const code = await harness.execute(['--duration', '3']);

    expect(code).toBe(EXIT_FAILURE);
    const output = harness.stdout.join('');
    expect(output).toContain(
      '- イベントサーバー http://localhost:48043/health: 3件、失敗3件',
    );
    expect(output).toContain(
      '- 利用者側 http://localhost:48044/: 3件、失敗0件',
    );
    expect(output).toContain('503(5ms)');
    expect(output).toContain('判定: 失敗');
    expect(harness.stderr.join('')).toContain('失敗した応答があります');
  });

  test('通信の失敗と時間切れも失敗に数えて終了コード1にする', async () => {
    const harness = setup((url) => {
      if (url.includes(':48042')) throw new TypeError('ECONNREFUSED');
      if (url.includes(':48045')) {
        throw new DOMException('timed out', 'TimeoutError');
      }
      return ok();
    });

    const code = await harness.execute(['--duration', '2']);

    expect(code).toBe(EXIT_FAILURE);
    const output = harness.stdout.join('');
    expect(output).toContain('通信の失敗(5ms)');
    expect(output).toContain('時間切れ(5ms)');
  });

  test('全ての要求に識別のためのUser-Agentを付ける', async () => {
    const harness = setup(ok);

    await harness.execute(['--duration', '1']);

    expect(harness.headers).toHaveLength(4);
    for (const headers of harness.headers) {
      expect(headers.get('user-agent')).toMatch(/availability-probe/);
    }
  });

  test('各アプリのURLを引数で上書きでき、経路は既定のまま付ける', async () => {
    const harness = setup(ok);

    await harness.execute([
      '--duration',
      '1',
      '--client-url',
      'https://client.example',
      '--admin-url',
      'https://admin.example',
      '--api-url',
      'https://api.example',
      '--event-url',
      'https://event.example',
    ]);

    expect([...harness.urls].toSorted()).toEqual([
      'https://admin.example/auth/login',
      'https://api.example/health',
      'https://client.example/',
      'https://event.example/health',
    ]);
  });

  test('監視の開始時に対象と時間を表示する', async () => {
    const harness = setup(ok);

    await harness.execute(['--duration', '2']);

    const output = harness.stdout.join('');
    expect(output).toContain('2秒間、1秒ごとに監視します');
    expect(output.indexOf('監視します')).toBeLessThan(output.indexOf('判定'));
  });

  test.each([
    [['--duration', 'abc'], '--duration'],
    [['--duration', '0'], '--duration'],
    [['--duration', '-5'], '--duration'],
    [['--duration', '1.5'], '--duration'],
    [['--duration'], '--duration'],
    [['--client-url', 'not a url'], '--client-url'],
    [['--api-url', 'ftp://api.example'], '--api-url'],
    [['--unknown'], '--unknown'],
    [['extra'], 'extra'],
  ])('不正な引数%sは使い方の誤りとして拒否する', async (args, mention) => {
    const harness = setup(ok);

    const error = await harness.execute(args).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain(mention);
    expect(harness.urls).toEqual([]);
  });

  describe('--help', () => {
    test.each(['--help', '-h'])(
      '%sは使い方を標準出力へ出して成功し、HTTPの要求をしない',
      async (flag) => {
        const harness = setup(ok);

        const code = await harness.execute([flag]);

        expect(code).toBe(EXIT_SUCCESS);
        expect(harness.urls).toEqual([]);
        expect(harness.stderr).toEqual([]);
        const output = harness.stdout.join('');
        expect(output).toContain('使い方: availability-probe');
        expect(output).not.toContain('監視します');
      },
    );

    test('他の引数と並べても使い方だけを表示してHTTPの要求をしない', async () => {
      const harness = setup(ok);

      const code = await harness.execute(['--duration', '5', '--help']);

      expect(code).toBe(EXIT_SUCCESS);
      expect(harness.urls).toEqual([]);
      expect(harness.stdout.join('')).toContain('--duration');
    });

    test('全てのオプションと既定値と終了コードの意味を示す', async () => {
      const harness = setup(ok);

      await harness.execute(['--help']);

      const output = harness.stdout.join('');
      for (const option of [
        '--duration',
        '--client-url',
        '--admin-url',
        '--api-url',
        '--event-url',
      ]) {
        expect(output).toContain(option);
      }
      for (const defaultValue of [
        '1200',
        'http://localhost:48044',
        'http://localhost:48045',
        'http://localhost:48042',
        'http://localhost:48043',
        '/health',
        '/auth/login',
      ]) {
        expect(output).toContain(defaultValue);
      }
      expect(output).toContain('終了コード0');
      expect(output).toContain('終了コード1');
      expect(output).toContain('終了コード2');
    });
  });
});
