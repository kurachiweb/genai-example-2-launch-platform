export const EXTERNAL_SERVICES = [
  'rekognition',
  'gcp-nl',
  'stripe',
  'email',
  'hibp',
  'disify',
] as const;

export type ExternalService = (typeof EXTERNAL_SERVICES)[number];

export type FailureKind = 'timeout' | 'auth' | 'quota' | 'bad-response';

export type OverrideWorker = 'api' | 'event';

export interface DegradationRow {
  readonly service: ExternalService;
  readonly failure: FailureKind;
  readonly expected: string;
  readonly evidence: readonly string[];
  readonly notifiesOperator: boolean;
  readonly owner: string;
}

export interface LocalOverride {
  readonly service: ExternalService;
  readonly worker: OverrideWorker;
  readonly vars: Readonly<Record<string, string>>;
  readonly unsetSecrets: readonly string[];
}

export interface DegradedLaunch {
  readonly worker: OverrideWorker;
  readonly services: readonly ExternalService[];
  readonly command: string;
}

const REKOGNITION_PROVIDER =
  'apps/event/src/infrastructure/media/rekognition-moderation-provider.worker.test.ts';
const MODERATE_IMAGE_HANDLER =
  'apps/event/src/application/media/moderate-image-handler.unit.test.ts';
const MODERATION_REQUEUE =
  'apps/api/src/application/media/media-daily-jobs.unit.test.ts';

const GOOGLE_NL_EXTRACTOR =
  'apps/event/src/infrastructure/search/google-natural-language-extractor.worker.test.ts';
const SEARCH_INCIDENT_REPORTER =
  'apps/event/src/infrastructure/search/sentry-search-incident-reporter.worker.test.ts';
const SEARCH_INDEX_REFRESH =
  'apps/event/src/application/search/search-index-refresh-handler.unit.test.ts';

const STRIPE_CLIENT =
  'apps/backend-lib/workers/payments/stripe-client.worker.test.ts';
const STRIPE_GATEWAY =
  'apps/backend-lib/workers/payments/stripe-gateway.worker.test.ts';
const CHECKOUT_STARTER =
  'apps/api/src/application/payments/checkout-starter.unit.test.ts';
const ULTRAS_PLAN_READER =
  'apps/api/src/application/ultras/ultras-plan-reader.unit.test.ts';
const REFUND_HANDLER =
  'apps/event/src/application/payments/refund-payment-handler.unit.test.ts';

const CLOUDFLARE_EMAIL_PROVIDER =
  'apps/event/src/infrastructure/email/providers/cloudflare-email-provider.worker.test.ts';
const MAILPIT_EMAIL_PROVIDER =
  'apps/event/src/infrastructure/email/providers/mailpit-email-provider.worker.test.ts';
const EMAIL_PROVIDER_OUTCOME =
  'apps/backend-lib/core/email/provider-outcome.unit.test.ts';
const SEND_EMAIL_HANDLER =
  'apps/event/src/application/email/send-email-handler.outcome.unit.test.ts';

const HIBP_CHECKER =
  'apps/api/src/infrastructure/auth/hibp-pwned-password-checker.worker.test.ts';
const PASSWORD_POLICY =
  'apps/api/src/application/auth/password-policy.unit.test.ts';
const AUTH_INCIDENT_REPORTER =
  'apps/api/src/infrastructure/auth/sentry-auth-incident-reporter.worker.test.ts';

const DISIFY_CLIENT =
  'apps/backend-lib/workers/identity/disify-client.worker.test.ts';
const DISPOSABLE_EMAIL_CHECK =
  'apps/api/src/application/identity/disposable-email-check.unit.test.ts';
const DISPOSABLE_RECHECK_HANDLER =
  'apps/event/src/application/identity/disposable-email-recheck-handler.unit.test.ts';
const DISPOSABLE_RECHECK_SWEEP =
  'apps/api/src/application/identity/jobs/disposable-recheck-sweep-job.unit.test.ts';

const MODERATION_RETRIES =
  '画像は公開のまま、キューで最大5回まで試し、その間に60・120・240・480秒の間隔で4回再試行する。使い切ると未判定として記録して完了し、4:21の`media-pipeline.moderation-requeue`が後で送り直す';

const SEARCH_FALLBACK =
  '抽出の入力を語にした縮退の索引(`fallback`)を書いて完了する';

const STRIPE_UNAVAILABLE =
  '一時的な失敗(`StripeUnavailableError`)になる。apiは`payments_unavailable`で決済の開始・価格の照会が縮退の案内を示し、eventの返金は再試行される';

const PWNED_FAIL_OPEN =
  '照合できない結果になり、パスワードを受け付けて(fail-open)照合を省いたことをwarningで通知する。再試行はしない';

const DISIFY_UNDETERMINED =
  '例外にせず未判定として保存する。遅延の再確認のメッセージと4:21の`identity-auth.disposable-recheck-sweep`が後で確かめ、warningで通知する';

export const DEGRADATION_MATRIX: readonly DegradationRow[] = [
  {
    service: 'rekognition',
    failure: 'timeout',
    expected: `10秒で打ち切り、一時的な失敗として扱う。${MODERATION_RETRIES}。上限の試行で未判定をwarningで通知する`,
    evidence: [
      REKOGNITION_PROVIDER,
      MODERATE_IMAGE_HANDLER,
      MODERATION_REQUEUE,
    ],
    notifiesOperator: true,
    owner: 'media-pipeline',
  },
  {
    service: 'rekognition',
    failure: 'auth',
    expected: `資格情報・権限・署名の誤りは設定の誤りとして、再試行の上限まで同様に再試行する。上限で未判定の記録に加えて設定の誤りをerrorで通知する。${MODERATION_RETRIES}`,
    evidence: [
      REKOGNITION_PROVIDER,
      MODERATE_IMAGE_HANDLER,
      MODERATION_REQUEUE,
    ],
    notifiesOperator: true,
    owner: 'media-pipeline',
  },
  {
    service: 'rekognition',
    failure: 'quota',
    expected: `上限(スロットリング)は一時的な失敗として扱う。${MODERATION_RETRIES}。上限の試行で未判定をwarningで通知する`,
    evidence: [
      REKOGNITION_PROVIDER,
      MODERATE_IMAGE_HANDLER,
      MODERATION_REQUEUE,
    ],
    notifiesOperator: true,
    owner: 'media-pipeline',
  },
  {
    service: 'rekognition',
    failure: 'bad-response',
    expected: `ラベルの一覧が欠けた・JSONでない応答は、検出なしにせず一時的な失敗として扱う。${MODERATION_RETRIES}。上限の試行で未判定をwarningで通知する`,
    evidence: [
      REKOGNITION_PROVIDER,
      MODERATE_IMAGE_HANDLER,
      MODERATION_REQUEUE,
    ],
    notifiesOperator: true,
    owner: 'media-pipeline',
  },
  {
    service: 'gcp-nl',
    failure: 'timeout',
    expected: `10秒で打ち切り、一時的な失敗として再試行する。使い切ると${SEARCH_FALLBACK}`,
    evidence: [GOOGLE_NL_EXTRACTOR, SEARCH_INDEX_REFRESH],
    notifiesOperator: false,
    owner: 'content-processing',
  },
  {
    service: 'gcp-nl',
    failure: 'auth',
    expected: `401・403・言語以外の400は設定の誤りとして、再試行せずに${SEARCH_FALLBACK}。種類と検索対象と状態コードだけをerrorで通知する`,
    evidence: [
      GOOGLE_NL_EXTRACTOR,
      SEARCH_INDEX_REFRESH,
      SEARCH_INCIDENT_REPORTER,
    ],
    notifiesOperator: true,
    owner: 'content-processing',
  },
  {
    service: 'gcp-nl',
    failure: 'quota',
    expected: `429は一時的な失敗として再試行する。使い切ると${SEARCH_FALLBACK}`,
    evidence: [GOOGLE_NL_EXTRACTOR, SEARCH_INDEX_REFRESH],
    notifiesOperator: false,
    owner: 'content-processing',
  },
  {
    service: 'gcp-nl',
    failure: 'bad-response',
    expected: `5xxは一時的な失敗として再試行し、使い切ると${SEARCH_FALLBACK}。状態200でJSONでない応答は設定の誤りとして直ちに縮退し、errorで通知する`,
    evidence: [
      GOOGLE_NL_EXTRACTOR,
      SEARCH_INDEX_REFRESH,
      SEARCH_INCIDENT_REPORTER,
    ],
    notifiesOperator: true,
    owner: 'content-processing',
  },
  {
    service: 'stripe',
    failure: 'timeout',
    expected: `10秒で打ち切り(apiは1回・eventは2回再試行)、接続の失敗とともに${STRIPE_UNAVAILABLE}。運用者へはwarnのログだけで、エラートラッキングへ送らない`,
    evidence: [
      STRIPE_CLIENT,
      STRIPE_GATEWAY,
      CHECKOUT_STARTER,
      ULTRAS_PLAN_READER,
      REFUND_HANDLER,
    ],
    notifiesOperator: false,
    owner: 'payments',
  },
  {
    service: 'stripe',
    failure: 'auth',
    expected:
      '認証の失敗(鍵の誤り)を含む429・5xx以外の4xxは恒久的な拒否(`StripeRejectedError`)になる。`payments_unavailable`には変換されず例外のまま呼び出し側へ伝わり、エラートラッキングへも送らない',
    evidence: [STRIPE_GATEWAY, CHECKOUT_STARTER],
    notifiesOperator: false,
    owner: 'payments',
  },
  {
    service: 'stripe',
    failure: 'quota',
    expected: `429は${STRIPE_UNAVAILABLE}`,
    evidence: [STRIPE_GATEWAY, CHECKOUT_STARTER, ULTRAS_PLAN_READER],
    notifiesOperator: false,
    owner: 'payments',
  },
  {
    service: 'stripe',
    failure: 'bad-response',
    expected: `5xx・Stripe側のAPIの誤りは${STRIPE_UNAVAILABLE}`,
    evidence: [STRIPE_GATEWAY, CHECKOUT_STARTER, ULTRAS_PLAN_READER],
    notifiesOperator: false,
    owner: 'payments',
  },
  {
    service: 'email',
    failure: 'timeout',
    expected:
      '30秒で打ち切り、一時的な障害として最大5回の試行まで再試行する。5回目の失敗で送信不能をerrorで通知して完了する',
    evidence: [CLOUDFLARE_EMAIL_PROVIDER, SEND_EMAIL_HANDLER],
    notifiesOperator: true,
    owner: 'email-delivery',
  },
  {
    service: 'email',
    failure: 'auth',
    expected:
      '送信元の未検証・バインディングの宛先の許可外・アカウントの停止など、再試行しても変わらない失敗は、初回でも送信不能をerrorで通知して完了する',
    evidence: [EMAIL_PROVIDER_OUTCOME, SEND_EMAIL_HANDLER],
    notifiesOperator: true,
    owner: 'email-delivery',
  },
  {
    service: 'email',
    failure: 'quota',
    expected:
      '送信レートの上限は警告を出さずに60秒待って送り直す。日次上限は3600秒延期し、間引きを取れたときに日次上限をwarningで通知する',
    evidence: [EMAIL_PROVIDER_OUTCOME, SEND_EMAIL_HANDLER],
    notifiesOperator: true,
    owner: 'email-delivery',
  },
  {
    service: 'email',
    failure: 'bad-response',
    expected:
      '未知のエラーのコード・Mailpitの不正な応答は一時的な障害として再試行し、使い切ると送信不能をerrorで通知する',
    evidence: [
      EMAIL_PROVIDER_OUTCOME,
      MAILPIT_EMAIL_PROVIDER,
      SEND_EMAIL_HANDLER,
    ],
    notifiesOperator: true,
    owner: 'email-delivery',
  },
  {
    service: 'hibp',
    failure: 'timeout',
    expected: `3秒で打ち切り、${PWNED_FAIL_OPEN}`,
    evidence: [HIBP_CHECKER, PASSWORD_POLICY, AUTH_INCIDENT_REPORTER],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'hibp',
    failure: 'auth',
    expected: `401・403などの状態コードは、${PWNED_FAIL_OPEN}`,
    evidence: [HIBP_CHECKER, PASSWORD_POLICY, AUTH_INCIDENT_REPORTER],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'hibp',
    failure: 'quota',
    expected: `429は、${PWNED_FAIL_OPEN}`,
    evidence: [HIBP_CHECKER, PASSWORD_POLICY, AUTH_INCIDENT_REPORTER],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'hibp',
    failure: 'bad-response',
    expected: `形式の違反の行を含む応答は漏洩済みと判断せず、${PWNED_FAIL_OPEN}`,
    evidence: [HIBP_CHECKER, PASSWORD_POLICY, AUTH_INCIDENT_REPORTER],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'disify',
    failure: 'timeout',
    expected: `3秒で打ち切り、${DISIFY_UNDETERMINED}`,
    evidence: [
      DISIFY_CLIENT,
      DISPOSABLE_EMAIL_CHECK,
      DISPOSABLE_RECHECK_HANDLER,
      DISPOSABLE_RECHECK_SWEEP,
    ],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'disify',
    failure: 'auth',
    expected: `401は${DISIFY_UNDETERMINED}`,
    evidence: [
      DISIFY_CLIENT,
      DISPOSABLE_EMAIL_CHECK,
      DISPOSABLE_RECHECK_HANDLER,
      DISPOSABLE_RECHECK_SWEEP,
    ],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'disify',
    failure: 'quota',
    expected: `429は${DISIFY_UNDETERMINED}`,
    evidence: [
      DISIFY_CLIENT,
      DISPOSABLE_EMAIL_CHECK,
      DISPOSABLE_RECHECK_HANDLER,
      DISPOSABLE_RECHECK_SWEEP,
    ],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
  {
    service: 'disify',
    failure: 'bad-response',
    expected: `形式の不正・HTMLの応答・5xxは${DISIFY_UNDETERMINED}`,
    evidence: [
      DISIFY_CLIENT,
      DISPOSABLE_EMAIL_CHECK,
      DISPOSABLE_RECHECK_HANDLER,
      DISPOSABLE_RECHECK_SWEEP,
    ],
    notifiesOperator: true,
    owner: 'identity-auth',
  },
];

// 認証の鍵に当たる値は形式の検証を通る必要が無く、本物と取り違えない固定の文字列にする
const INVALID_CREDENTIAL = 'degraded-invalid-credential';

// 接続を拒まれるポートで、Mailpitの本来の宛先(48041)から確実に外す
const UNREACHABLE_MAILPIT_URL = 'http://127.0.0.1:1';

// ローカルの`secrets.required`に無いキーは環境変数では渡らないため、`--var`で渡す。HIBPは宛先も鍵も設定に無いため含めない
export const LOCAL_OVERRIDES: readonly LocalOverride[] = [
  {
    service: 'rekognition',
    worker: 'event',
    vars: {
      MODERATION_PROVIDER: 'rekognition',
      REKOGNITION_ACCESS_KEY_ID: INVALID_CREDENTIAL,
      REKOGNITION_SECRET_ACCESS_KEY: INVALID_CREDENTIAL,
    },
    unsetSecrets: [],
  },
  {
    service: 'gcp-nl',
    worker: 'event',
    vars: {
      KEYWORD_EXTRACTOR: 'google-natural-language',
      GOOGLE_NL_API_KEY: INVALID_CREDENTIAL,
    },
    unsetSecrets: [],
  },
  // 無効な鍵では401が恒久的な拒否になり縮退の案内に倒れないため、鍵を渡さずに「未設定」の縮退にする
  {
    service: 'stripe',
    worker: 'api',
    vars: {},
    unsetSecrets: ['STRIPE_API_KEY'],
  },
  {
    service: 'stripe',
    worker: 'event',
    vars: {},
    unsetSecrets: ['STRIPE_API_KEY'],
  },
  {
    service: 'email',
    worker: 'event',
    vars: { MAILPIT_API_URL: UNREACHABLE_MAILPIT_URL },
    unsetSecrets: [],
  },
  {
    service: 'disify',
    worker: 'api',
    vars: { DISIFY_API_KEY: INVALID_CREDENTIAL },
    unsetSecrets: [],
  },
  {
    service: 'disify',
    worker: 'event',
    vars: { DISIFY_API_KEY: INVALID_CREDENTIAL },
    unsetSecrets: [],
  },
];

const WORKERS: readonly OverrideWorker[] = ['api', 'event'];

const WRANGLER_DEV_ARGS: Readonly<Record<OverrideWorker, string>> = {
  api: '--port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state --test-scheduled',
  event:
    '--port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state --inspector-port 9230',
};

const DELIVERY_CLI = '/workspace/scripts/delivery/cli.ts';

export const isExternalService = (value: string): value is ExternalService =>
  EXTERNAL_SERVICES.some((service) => service === value);

export const rowsWithoutEvidence = (
  matrix: readonly DegradationRow[],
): readonly DegradationRow[] =>
  matrix.filter(({ evidence }) => evidence.length === 0);

export const rowsWithoutNotification = (
  matrix: readonly DegradationRow[],
): readonly DegradationRow[] =>
  matrix.filter(({ notifiesOperator }) => !notifiesOperator);

export const servicesWithoutOverride = (
  services: readonly ExternalService[],
): readonly ExternalService[] =>
  EXTERNAL_SERVICES.filter(
    (service) =>
      services.includes(service) &&
      !LOCAL_OVERRIDES.some((override) => override.service === service),
  );

const launchOf = (
  worker: OverrideWorker,
  overrides: readonly LocalOverride[],
): DegradedLaunch => {
  const unset = overrides
    .flatMap(({ unsetSecrets }) => unsetSecrets)
    .toSorted();
  const vars = overrides
    .flatMap(({ vars: own }) => Object.entries(own))
    .toSorted(([left], [right]) => left.localeCompare(right));
  const envPrefix = unset.flatMap((key) => ['-u', key]);
  const wrangler = [
    'bunx wrangler dev',
    WRANGLER_DEV_ARGS[worker],
    ...vars.map(([key, value]) => `--var ${key}:${value}`),
  ].join(' ');
  const command = [
    `cd /workspace/apps/${worker} && bun ${DELIVERY_CLI} run-with-secrets --scope local --worker ${worker} --`,
    ...(envPrefix.length === 0 ? [] : ['env', ...envPrefix]),
    wrangler,
  ].join(' ');
  return {
    worker,
    services: overrides.map(({ service }) => service),
    command,
  };
};

export const buildDegradedLaunches = (
  services: readonly ExternalService[],
): readonly DegradedLaunch[] =>
  WORKERS.flatMap((worker) => {
    const overrides = EXTERNAL_SERVICES.flatMap((service) =>
      services.includes(service)
        ? LOCAL_OVERRIDES.filter(
            (override) =>
              override.worker === worker && override.service === service,
          )
        : [],
    );
    return overrides.length === 0 ? [] : [launchOf(worker, overrides)];
  });

export const buildDegradedCommands = (
  services: readonly ExternalService[],
): readonly string[] =>
  buildDegradedLaunches(services).map(({ command }) => command);
