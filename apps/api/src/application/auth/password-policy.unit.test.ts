import { describe, expect, test } from 'bun:test';

import type {
  AuthIncident,
  AuthIncidentReporter,
  PwnedCheckResult,
  PwnedPasswordChecker,
} from './ports.ts';
import { CheckingPasswordPolicy } from './password-policy.ts';

const ACCEPTABLE_PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

const IDENTIFIERS = {
  handle: 'launcher',
  nickname: 'ローンチ太郎',
  email: 'launch-owner@launch.example',
} as const;

interface FakePwnedChecker extends PwnedPasswordChecker {
  readonly checked: readonly string[];
}

function createPwnedChecker(result: PwnedCheckResult): FakePwnedChecker {
  const checked: string[] = [];
  return {
    checked,
    check(password) {
      checked.push(password);
      return Promise.resolve(result);
    },
  };
}

interface FakeReporter extends AuthIncidentReporter {
  readonly incidents: readonly AuthIncident[];
}

function createReporter(): FakeReporter {
  const incidents: AuthIncident[] = [];
  return {
    incidents,
    report(incident) {
      incidents.push(incident);
    },
  };
}

describe('CheckingPasswordPolicy', () => {
  test.each([
    ['8文字未満', 'short', 'too-short'],
    ['128文字超え', 'a'.repeat(129), 'too-long'],
    ['ハンドルと大文字小文字を区別せずに一致', 'LAUNCHER', 'matches-identity'],
    ['メールアドレスのローカル部と一致', 'Launch-Owner', 'matches-identity'],
  ] as const)(
    '%sのパスワードは規則の違反として拒否し、漏洩照合を呼ばない',
    async (_label, password, violation) => {
      const checker = createPwnedChecker({ kind: 'not-pwned' });
      const reporter = createReporter();
      const policy = new CheckingPasswordPolicy(checker, reporter);

      const result = await policy.validateNewPassword(password, IDENTIFIERS);

      expect(result).toEqual({ ok: false, violation });
      expect(checker.checked).toEqual([]);
      expect(reporter.incidents).toEqual([]);
    },
  );

  test('規則を満たし漏洩していないパスワードは照合済みとして受け付ける', async () => {
    const checker = createPwnedChecker({ kind: 'not-pwned' });
    const reporter = createReporter();
    const policy = new CheckingPasswordPolicy(checker, reporter);

    const result = await policy.validateNewPassword(
      ACCEPTABLE_PASSWORD,
      IDENTIFIERS,
    );

    expect(result).toEqual({ ok: true, pwnedCheck: 'checked' });
    expect(checker.checked).toEqual([ACCEPTABLE_PASSWORD]);
    expect(reporter.incidents).toEqual([]);
  });

  test('漏洩済みと判明したパスワードは漏洩として拒否する', async () => {
    const checker = createPwnedChecker({ kind: 'pwned' });
    const reporter = createReporter();
    const policy = new CheckingPasswordPolicy(checker, reporter);

    const result = await policy.validateNewPassword(
      ACCEPTABLE_PASSWORD,
      IDENTIFIERS,
    );

    expect(result).toEqual({ ok: false, violation: 'pwned' });
    expect(reporter.incidents).toEqual([]);
  });

  test.each(['timeout', 'network', 'status', 'invalid-response'] as const)(
    '漏洩照合が%sで使えないときは照合を省いて受け付け、運用者への通知を理由付きで1回だけ出す',
    async (reason) => {
      const checker = createPwnedChecker({ kind: 'unavailable', reason });
      const reporter = createReporter();
      const policy = new CheckingPasswordPolicy(checker, reporter);

      const result = await policy.validateNewPassword(
        ACCEPTABLE_PASSWORD,
        IDENTIFIERS,
      );

      expect(result).toEqual({ ok: true, pwnedCheck: 'skipped' });
      expect(reporter.incidents).toEqual([
        { kind: 'pwned-password-check-unavailable', reason },
      ]);
    },
  );

  test('運用者への通知にパスワードの平文を含めない', async () => {
    const checker = createPwnedChecker({
      kind: 'unavailable',
      reason: 'timeout',
    });
    const reporter = createReporter();
    const policy = new CheckingPasswordPolicy(checker, reporter);

    await policy.validateNewPassword(ACCEPTABLE_PASSWORD, IDENTIFIERS);

    expect(JSON.stringify(reporter.incidents)).not.toContain(
      ACCEPTABLE_PASSWORD,
    );
  });
});
