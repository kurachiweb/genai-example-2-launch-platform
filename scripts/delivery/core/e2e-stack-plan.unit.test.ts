import { describe, expect, test } from 'bun:test';

import {
  E2E_STACK_LOG_TAIL_LINES,
  E2E_STACK_SERVICES,
  E2E_STACK_WAIT_TIMEOUT_MS,
  LOCAL_STATE_DIR,
  e2eLogDirOf,
  planE2eStack,
  stackStartErrorReport,
} from './e2e-stack-plan.ts';

const INPUT = {
  cliPath: '/repo/scripts/delivery/cli.ts',
  mailpitBin: '/opt/mailpit/mailpit',
  logDir: '/runner-temp/e2e-logs',
} as const;

const commandLineOf = ({
  command,
  args,
}: {
  readonly command: string;
  readonly args: readonly string[];
}): string => [command, ...args].join(' ');

describe('E2E_STACK_SERVICES', () => {
  test('Mailpit・api・eventの3つだけを起動し、client・adminを起動しない', () => {
    expect(E2E_STACK_SERVICES.map(({ name }) => name)).toEqual([
      'mailpit',
      'api',
      'event',
    ]);
  });
});

describe('planE2eStack', () => {
  test('準備はapiでローカルのマイグレーションを適用する', () => {
    const { prepare } = planE2eStack(INPUT);

    expect(prepare).toEqual({
      dir: 'apps/api',
      command: 'bun',
      args: ['run', 'db:migrate:local'],
    });
  });

  test('Mailpitはルートで設計のポートを待ち受け、応答があれば起動したとみなす', () => {
    const [mailpit] = planE2eStack(INPUT).services;

    expect(mailpit).toEqual({
      name: 'mailpit',
      dir: '.',
      command: '/opt/mailpit/mailpit',
      args: ['--listen', '127.0.0.1:48041'],
      wait: { url: 'http://127.0.0.1:48041/', expectStatus: 'any' },
      logFile: '/runner-temp/e2e-logs/mailpit.log',
    });
  });

  test('api・eventは注入のコマンドをWorkerの指定付きで通してwrangler devを起動し、ヘルスチェックの200を待つ', () => {
    const [, api, event] = planE2eStack(INPUT).services;

    expect(api?.dir).toBe('apps/api');
    expect(api === undefined ? '' : commandLineOf(api)).toBe(
      `bun /repo/scripts/delivery/cli.ts run-with-secrets --scope checks --worker api -- bunx wrangler dev --port 48042 --ip 127.0.0.1 --persist-to ${LOCAL_STATE_DIR} --test-scheduled`,
    );
    expect(api?.wait).toEqual({
      url: 'http://127.0.0.1:48042/health',
      expectStatus: 200,
    });
    expect(api?.logFile).toBe('/runner-temp/e2e-logs/api.log');

    expect(event?.dir).toBe('apps/event');
    expect(event === undefined ? '' : commandLineOf(event)).toBe(
      `bun /repo/scripts/delivery/cli.ts run-with-secrets --scope checks --worker event -- bunx wrangler dev --port 48043 --ip 127.0.0.1 --persist-to ${LOCAL_STATE_DIR} --inspector-port 9230`,
    );
    expect(event?.wait).toEqual({
      url: 'http://127.0.0.1:48043/health',
      expectStatus: 200,
    });
    expect(event?.logFile).toBe('/runner-temp/e2e-logs/event.log');
  });

  test('ローカル状態の保存先は開発コンテナと同じ絶対パスにする', () => {
    expect(LOCAL_STATE_DIR).toBe('/workspace/.wrangler/state');
  });
});

describe('待ち合わせと表示の定数', () => {
  test('待ち合わせは各3分、ログは末尾50行を表示する', () => {
    expect(E2E_STACK_WAIT_TIMEOUT_MS).toBe(180_000);
    expect(E2E_STACK_LOG_TAIL_LINES).toBe(50);
  });

  test('ログはランナーの一時ディレクトリの下のe2e-logsに書く', () => {
    expect(e2eLogDirOf('/runner-temp')).toBe('/runner-temp/e2e-logs');
    expect(e2eLogDirOf('/runner-temp/')).toBe('/runner-temp/e2e-logs');
  });
});

describe('stackStartErrorReport', () => {
  test('起動しなかったサービスごとに名前・待ち合わせの対象・ログの末尾を並べる', () => {
    const report = stackStartErrorReport([
      {
        service: 'api',
        reason: 'http://127.0.0.1:48042/healthが3分以内に200を返しませんでした',
        logFile: '/runner-temp/e2e-logs/api.log',
        tail: 'line-1\nline-2\n',
      },
      {
        service: 'event',
        reason: '起動できませんでした: spawn failed',
        logFile: '/runner-temp/e2e-logs/event.log',
        tail: '',
      },
    ]);

    expect(report).toBe(
      [
        'apiが起動しませんでした(http://127.0.0.1:48042/healthが3分以内に200を返しませんでした)。ログ(/runner-temp/e2e-logs/api.log)の末尾50行:',
        'line-1',
        'line-2',
        'eventが起動しませんでした(起動できませんでした: spawn failed)。ログ(/runner-temp/e2e-logs/event.log)の末尾50行:',
        '(ログは空です)',
        '',
      ].join('\n'),
    );
  });
});
