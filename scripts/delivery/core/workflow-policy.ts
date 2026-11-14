import { DEPLOY_STAGES } from './deploy-stages.ts';
import {
  type ExpectedToolVersions,
  type ToolName,
  type ToolVersionOccurrence,
  scalarText,
  toolVersionsInEnv,
  toolVersionsInStep,
} from './tool-versions.ts';
import type { ContractViolation } from './violation.ts';

export interface WorkflowDocument {
  readonly file: string;
  readonly parsed: unknown;
}

export interface WorkflowPolicyInput {
  readonly workflows: readonly WorkflowDocument[];
  readonly setupAction: WorkflowDocument;
  readonly versions: ExpectedToolVersions;
}

type Rule = (input: WorkflowPolicyInput) => readonly ContractViolation[];

type YamlMap = Readonly<Record<string, unknown>>;

interface Node {
  readonly path: string;
  readonly value: YamlMap;
}

export const WORKFLOWS_DIR = '.github/workflows';

const CHECKS = 'checks.yml';
const DEPLOY = 'deploy.yml';
const RELEASE_PR = 'release-pr.yml';
const JOBS_PREFIX = 'jobs.';
const DEPLOY_JOB = 'deploy';
const CI_GATE_JOB = 'ci-gate';
const RELEASE_PR_JOB = 'release-pr';

const ID_TOKEN_JOBS: Readonly<Record<string, readonly string[]>> = {
  [CHECKS]: ['tests', 'e2e'],
  [DEPLOY]: [DEPLOY_JOB],
  'pull-request.yml': ['checks'],
  'delivery.yml': ['checks', DEPLOY_JOB],
};

const FORBIDDEN_TRIGGERS: readonly string[] = [
  'pull_request_target',
  'workflow_run',
];

const SETUP_ACTION_TOOLS: readonly ToolName[] = [
  'bun',
  'node',
  'opentofu',
  'infisicalCli',
  'wranglerTool',
  'mailpit',
];

const PINNED_USES = /^[^@\s]+@[\da-f]{40}$/;

const EXPRESSION = /\$\{\{.*?\}\}/gs;

const UNTRUSTED_CONTEXT = /\binputs\.|\bgithub\.event\b|\bgithub\.head_ref\b/;

const DEPLOY_ENVIRONMENT = '${{ inputs.environment }}';
const DEPLOY_CONCURRENCY_GROUP = 'deploy-${{ inputs.environment }}';
const ALWAYS = 'always()';
const ALWAYS_CONDITIONS: readonly string[] = [ALWAYS, '${{always()}}'];

const MISSING = 'なし';
const PRESENT = 'あり';

const violation = (
  rule: string,
  file: string,
  path: string,
  actual: string,
  expected: string,
): ContractViolation => ({ rule, file, path, actual, expected });

const isRecord = (value: unknown): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mapOf = (value: unknown): YamlMap => (isRecord(value) ? value : {});

const compact = (text: string): string => text.replaceAll(/\s+/g, '');

const listOf = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.map(scalarText)
    : value === undefined
      ? []
      : [scalarText(value)];

const fileNameOf = (file: string): string =>
  file.slice(file.lastIndexOf('/') + 1);

const documentsOf = (
  input: WorkflowPolicyInput,
): readonly WorkflowDocument[] => [...input.workflows, input.setupAction];

const jobsOf = (parsed: unknown): readonly Node[] =>
  Object.entries(mapOf(mapOf(parsed).jobs)).flatMap(([id, job]) =>
    isRecord(job) ? [{ path: `${JOBS_PREFIX}${id}`, value: job }] : [],
  );

// ワークフローのジョブと、複合アクションの`runs`を、手順を持つ単位として並べる
const stepOwnersOf = (parsed: unknown): readonly Node[] => {
  const { runs } = mapOf(parsed);
  return [
    ...jobsOf(parsed),
    ...(isRecord(runs) ? [{ path: 'runs', value: runs }] : []),
  ];
};

const stepsOf = (owner: Node): readonly Node[] => {
  const { steps } = owner.value;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step: unknown, index) =>
    isRecord(step)
      ? [{ path: `${owner.path}.steps[${String(index)}]`, value: step }]
      : [],
  );
};

const allStepsOf = (parsed: unknown): readonly Node[] =>
  stepOwnersOf(parsed).flatMap(stepsOf);

const usesNodesOf = (parsed: unknown): readonly Node[] =>
  stepOwnersOf(parsed).flatMap((owner) =>
    [owner, ...stepsOf(owner)].filter(({ value }) => value.uses !== undefined),
  );

const isPinned = (uses: string): boolean =>
  uses.startsWith('./') || PINNED_USES.test(uses);

const unpinnedActions: Rule = (input) =>
  documentsOf(input).flatMap(({ file, parsed }) =>
    usesNodesOf(parsed).flatMap(({ path, value }) => {
      const uses = scalarText(value.uses);
      return isPinned(uses)
        ? []
        : [
            violation(
              'W1',
              file,
              `${path}.uses`,
              uses,
              '40桁のコミットSHAで固定した参照',
            ),
          ];
    }),
  );

const allowedTopLevelLevels = (scope: string): readonly string[] =>
  scope === 'contents' ? ['read', 'none'] : ['none'];

const topLevelPermissions: Rule = (input) =>
  input.workflows.flatMap(({ file, parsed }) => {
    const { permissions } = mapOf(parsed);
    if (!isRecord(permissions)) {
      return [
        violation(
          'W2',
          file,
          'permissions',
          scalarText(permissions),
          'contents: read以下の権限',
        ),
      ];
    }
    return Object.entries(permissions).flatMap(([scope, level]) => {
      const allowed = allowedTopLevelLevels(scope);
      const actual = scalarText(level);
      return allowed.includes(actual)
        ? []
        : [
            violation(
              'W2',
              file,
              `permissions.${scope}`,
              actual,
              allowed[0] ?? '',
            ),
          ];
    });
  });

const levelOf = (permissions: unknown, scope: string): string => {
  if (permissions === 'write-all') return 'write';
  if (permissions === 'read-all') return 'read';
  return scalarText(mapOf(permissions)[scope]);
};

interface JobGrant {
  readonly scope: string;
  readonly expected: string;
  readonly isAllowed: (fileName: string, jobId: string) => boolean;
}

const jobGrantViolations = (
  input: WorkflowPolicyInput,
  rule: string,
  grants: readonly JobGrant[],
): readonly ContractViolation[] =>
  input.workflows.flatMap(({ file, parsed }) =>
    jobsOf(parsed).flatMap(({ path, value }) => {
      const jobId = path.slice(JOBS_PREFIX.length);
      return grants.flatMap(({ scope, expected, isAllowed }) =>
        levelOf(value.permissions, scope) !== 'write' ||
        isAllowed(fileNameOf(file), jobId)
          ? []
          : [
              violation(
                rule,
                file,
                `${path}.permissions.${scope}`,
                'write',
                expected,
              ),
            ],
      );
    }),
  );

const idTokenGrants: Rule = (input) =>
  jobGrantViolations(input, 'W3', [
    {
      scope: 'id-token',
      expected: 'none',
      isAllowed: (fileName, jobId) =>
        ID_TOKEN_JOBS[fileName]?.includes(jobId) ?? false,
    },
  ]);

const writeGrants: Rule = (input) =>
  jobGrantViolations(input, 'W4', [
    {
      scope: 'pull-requests',
      expected: 'none',
      isAllowed: (fileName, jobId) =>
        fileName === RELEASE_PR && jobId === RELEASE_PR_JOB,
    },
    { scope: 'contents', expected: 'read', isAllowed: () => false },
    { scope: 'actions', expected: 'none', isAllowed: () => false },
  ]);

const triggersOf = (on: unknown): readonly string[] =>
  isRecord(on) ? Object.keys(on) : listOf(on);

const forbiddenTriggers = (
  file: string,
  parsed: unknown,
): readonly ContractViolation[] =>
  triggersOf(mapOf(parsed).on)
    .filter((trigger) => FORBIDDEN_TRIGGERS.includes(trigger))
    .map((trigger) =>
      violation(
        'W5',
        file,
        `on.${trigger}`,
        trigger,
        'pull_request_targetとworkflow_runを使わない',
      ),
    );

const actionNameOf = (uses: unknown): string =>
  scalarText(uses).split('@')[0] ?? '';

const persistedCredentials = (
  file: string,
  parsed: unknown,
): readonly ContractViolation[] =>
  allStepsOf(parsed)
    .filter(({ value }) => actionNameOf(value.uses) === 'actions/checkout')
    .flatMap(({ path, value }) => {
      const actual = scalarText(mapOf(value.with)['persist-credentials']);
      return actual === 'false'
        ? []
        : [
            violation(
              'W5',
              file,
              `${path}.with.persist-credentials`,
              actual,
              'false',
            ),
          ];
    });

const unsafeTriggersAndCheckouts: Rule = (input) =>
  documentsOf(input).flatMap(({ file, parsed }) => [
    ...forbiddenTriggers(file, parsed),
    ...persistedCredentials(file, parsed),
  ]);

const untrustedExpansions: Rule = (input) =>
  documentsOf(input).flatMap(({ file, parsed }) =>
    allStepsOf(parsed).flatMap(({ path, value }) =>
      [...scalarText(value.run).matchAll(EXPRESSION)]
        .map(([expression]) => expression)
        .filter((expression) => UNTRUSTED_CONTEXT.test(expression))
        .map((expression) =>
          violation(
            'W6',
            file,
            `${path}.run`,
            expression,
            '環境変数を経由した参照',
          ),
        ),
    ),
  );

type RequiredJob =
  | {
      readonly found: true;
      readonly document: WorkflowDocument;
      readonly job: Node;
    }
  | {
      readonly found: false;
      readonly violations: readonly ContractViolation[];
    };

const requiredJob = (
  input: WorkflowPolicyInput,
  fileName: string,
  jobId: string,
  rule: string,
): RequiredJob => {
  const document = input.workflows.find(
    ({ file }) => fileNameOf(file) === fileName,
  );
  if (document === undefined) {
    const file = `${WORKFLOWS_DIR}/${fileName}`;
    return {
      found: false,
      violations: [violation(rule, file, '', MISSING, PRESENT)],
    };
  }
  const path = `${JOBS_PREFIX}${jobId}`;
  const job = jobsOf(document.parsed).find((node) => node.path === path);
  return job === undefined
    ? {
        found: false,
        violations: [violation(rule, document.file, path, MISSING, PRESENT)],
      }
    : { found: true, document, job };
};

const withRequiredJob =
  (
    fileName: string,
    jobId: string,
    rule: string,
    check: (
      file: string,
      job: Node,
      parsed: unknown,
    ) => readonly ContractViolation[],
  ): Rule =>
  (input) => {
    const required = requiredJob(input, fileName, jobId, rule);
    return required.found
      ? check(required.document.file, required.job, required.document.parsed)
      : required.violations;
  };

const environmentNameOf = (environment: unknown): string =>
  scalarText(isRecord(environment) ? environment.name : environment);

const concurrencyOf = (
  concurrency: unknown,
): { readonly group: string; readonly cancelInProgress: string } =>
  isRecord(concurrency)
    ? {
        group: scalarText(concurrency.group),
        cancelInProgress: scalarText(concurrency['cancel-in-progress']),
      }
    : { group: scalarText(concurrency), cancelInProgress: '' };

const deployJobSettings = withRequiredJob(
  DEPLOY,
  DEPLOY_JOB,
  'W7',
  (file, { path, value }) => {
    const environment = environmentNameOf(value.environment);
    const { group, cancelInProgress } = concurrencyOf(value.concurrency);
    const checks = [
      {
        key: 'environment',
        actual: environment,
        expected: DEPLOY_ENVIRONMENT,
        ok: compact(environment) === compact(DEPLOY_ENVIRONMENT),
      },
      {
        key: 'concurrency.group',
        actual: group,
        expected: DEPLOY_CONCURRENCY_GROUP,
        ok: compact(group) === compact(DEPLOY_CONCURRENCY_GROUP),
      },
      {
        key: 'concurrency.cancel-in-progress',
        actual: cancelInProgress,
        expected: 'false',
        ok: cancelInProgress === 'false',
      },
    ];
    return checks
      .filter(({ ok }) => !ok)
      .map(({ key, actual, expected }) =>
        violation('W7', file, `${path}.${key}`, actual, expected),
      );
  },
);

const deployStageOrder = withRequiredJob(
  DEPLOY,
  DEPLOY_JOB,
  'W8',
  (file, job) => {
    const actual = stepsOf(job)
      .map(({ value }) => scalarText(value.id))
      .filter((id) => id !== '')
      .join('→');
    const expected = DEPLOY_STAGES.join('→');
    return actual === expected
      ? []
      : [violation('W8', file, `${job.path}.steps[].id`, actual, expected)];
  },
);

const prefixed = (
  path: string,
  occurrences: readonly ToolVersionOccurrence[],
): readonly ToolVersionOccurrence[] =>
  occurrences.map((occurrence) => ({
    ...occurrence,
    key: path === '' ? occurrence.key : `${path}.${occurrence.key}`,
  }));

const versionOccurrencesOf = (
  parsed: unknown,
): readonly ToolVersionOccurrence[] => [
  ...prefixed('', toolVersionsInEnv(mapOf(parsed).env)),
  ...stepOwnersOf(parsed).flatMap((owner) => [
    ...prefixed(owner.path, toolVersionsInEnv(owner.value.env)),
    ...stepsOf(owner).flatMap(({ path, value }) =>
      prefixed(path, toolVersionsInStep(value)),
    ),
  ]),
];

const mismatchedVersions = (
  file: string,
  occurrences: readonly ToolVersionOccurrence[],
  versions: ExpectedToolVersions,
): readonly ContractViolation[] =>
  occurrences
    .filter(({ tool, value }) => value !== versions[tool])
    .map(({ tool, key, value }) =>
      violation('W9', file, key, value, versions[tool]),
    );

const missingSetupTools = (
  file: string,
  occurrences: readonly ToolVersionOccurrence[],
  versions: ExpectedToolVersions,
): readonly ContractViolation[] =>
  SETUP_ACTION_TOOLS.filter(
    (tool) => !occurrences.some((occurrence) => occurrence.tool === tool),
  ).map((tool) =>
    violation('W9', file, 'runs.steps', '', `${tool} ${versions[tool]}`),
  );

const toolVersions: Rule = (input) => {
  const { setupAction, versions } = input;
  const actionOccurrences = versionOccurrencesOf(setupAction.parsed);
  return [
    ...input.workflows.flatMap(({ file, parsed }) =>
      mismatchedVersions(file, versionOccurrencesOf(parsed), versions),
    ),
    ...mismatchedVersions(setupAction.file, actionOccurrences, versions),
    ...missingSetupTools(setupAction.file, actionOccurrences, versions),
  ];
};

const ciGateNeeds = withRequiredJob(
  CHECKS,
  CI_GATE_JOB,
  'W10',
  (file, { path, value }, parsed) => {
    const needs = listOf(value.needs);
    const jobIds = jobsOf(parsed)
      .map((job) => job.path.slice(JOBS_PREFIX.length))
      .filter((jobId) => jobId !== CI_GATE_JOB);
    const condition = scalarText(value.if);
    return [
      ...(jobIds.every((jobId) => needs.includes(jobId))
        ? []
        : [
            violation(
              'W10',
              file,
              `${path}.needs`,
              needs.join('・'),
              jobIds.join('・'),
            ),
          ]),
      ...(ALWAYS_CONDITIONS.includes(compact(condition))
        ? []
        : [violation('W10', file, `${path}.if`, condition, ALWAYS)]),
    ];
  },
);

const RULES: readonly Rule[] = [
  unpinnedActions,
  topLevelPermissions,
  idTokenGrants,
  writeGrants,
  unsafeTriggersAndCheckouts,
  untrustedExpansions,
  deployJobSettings,
  deployStageOrder,
  toolVersions,
  ciGateNeeds,
];

export function checkWorkflowPolicy(
  input: WorkflowPolicyInput,
): readonly ContractViolation[] {
  return RULES.flatMap((rule) => rule(input));
}
