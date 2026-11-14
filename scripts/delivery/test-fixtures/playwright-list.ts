interface ListedSpec {
  readonly title: string;
  readonly tags: readonly string[];
  readonly projects: readonly string[];
}

const specOf = ({ title, tags, projects }: ListedSpec) => ({
  title,
  tags,
  tests: projects.map((projectName) => ({ projectName, results: [] })),
});

const SETUP_SPEC: ListedSpec = {
  title: 'E2E対象に到達できる',
  tags: [],
  projects: ['client-reachability', 'admin-reachability'],
};

export const smokeSpec = (title: string): ListedSpec => ({
  title,
  tags: ['smoke'],
  projects: ['client'],
});

// Playwrightの`--list --reporter=json`の出力のうち、件数の数え方に関わる部分だけを持つ
export const playwrightListJson = (
  specs: readonly ListedSpec[],
  { withSetup = true, errors = [] as readonly unknown[] } = {},
): string =>
  JSON.stringify({
    config: { version: '1.64.1' },
    suites: [
      ...(withSetup
        ? [
            {
              title: 'e2e/support/reachability.setup.ts',
              file: 'e2e/support/reachability.setup.ts',
              specs: [specOf(SETUP_SPEC)],
              suites: [],
            },
          ]
        : []),
      ...(specs.length === 0
        ? []
        : [
            {
              title: 'e2e/client/system-status.e2e.test.ts',
              file: 'e2e/client/system-status.e2e.test.ts',
              specs: [],
              suites: [
                {
                  title: '利用者側の疎通確認の画面',
                  specs: specs.map(specOf),
                  suites: [],
                },
              ],
            },
          ]),
    ],
    errors,
    stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
  });
