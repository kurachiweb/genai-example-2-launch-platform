import type { RepoFiles } from '../adapters/repo-files.ts';
import {
  type ExpectedToolVersions,
  LIVE_VERSIONS_TF_PATH,
  readExpectedToolVersions,
} from '../core/tool-versions.ts';
import {
  WORKFLOWS_DIR,
  type WorkflowDocument,
  type WorkflowPolicyInput,
  checkWorkflowPolicy,
} from '../core/workflow-policy.ts';
import { type DeliveryCommand, UsageError } from './shared/delivery-command.ts';
import {
  type Loaded,
  allLoaded,
  errorsOf,
  failed,
  loaded,
  parseInput,
  readInput,
} from './shared/load-input.ts';
import {
  reportInputErrors,
  reportViolations,
} from './shared/report-violations.ts';

const TITLE = 'ワークフローの検査';

export const SETUP_ACTION_PATH = '.github/actions/setup-toolchain/action.yml';

const WORKFLOW_PATTERN = `${WORKFLOWS_DIR}/*.{yml,yaml}`;

const DOCKERFILE_PATH = 'Dockerfile';

const ROOT_PACKAGE_JSON_PATH = 'package.json';

const loadVersions = async (
  files: RepoFiles,
): Promise<Loaded<ExpectedToolVersions>> => {
  const [dockerfile, liveVersionsTf, rootPackageJson] = await Promise.all([
    readInput(files, DOCKERFILE_PATH),
    readInput(files, LIVE_VERSIONS_TF_PATH),
    readInput(files, ROOT_PACKAGE_JSON_PATH),
  ]);
  if (!dockerfile.ok || !liveVersionsTf.ok || !rootPackageJson.ok) {
    return failed(errorsOf([dockerfile, liveVersionsTf, rootPackageJson]));
  }
  const result = readExpectedToolVersions({
    dockerfile: dockerfile.value,
    liveVersionsTf: liveVersionsTf.value,
    rootPackageJson: rootPackageJson.value,
  });
  return result.ok ? loaded(result.versions) : failed(result.errors);
};

const loadDocument = async (
  files: RepoFiles,
  file: string,
): Promise<Loaded<WorkflowDocument>> => {
  const text = await readInput(files, file);
  if (!text.ok) return text;
  const parsed = parseInput(file, text.value, 'YAML', (yaml) =>
    Bun.YAML.parse(yaml),
  );
  return parsed.ok ? loaded({ file, parsed: parsed.value }) : parsed;
};

const loadWorkflows = async (
  files: RepoFiles,
): Promise<Loaded<readonly WorkflowDocument[]>> => {
  const paths = await files.list(WORKFLOW_PATTERN);
  return allLoaded(
    await Promise.all(paths.map((path) => loadDocument(files, path))),
  );
};

// 複合アクションが無い時は、版の宣言の欠落として違反に出すため、空の文書として扱う
const loadSetupAction = async (
  files: RepoFiles,
): Promise<Loaded<WorkflowDocument>> =>
  (await files.exists(SETUP_ACTION_PATH))
    ? loadDocument(files, SETUP_ACTION_PATH)
    : loaded({ file: SETUP_ACTION_PATH, parsed: undefined });

export async function loadWorkflowPolicyInput(
  files: RepoFiles,
): Promise<Loaded<WorkflowPolicyInput>> {
  const [versions, workflows, setupAction] = await Promise.all([
    loadVersions(files),
    loadWorkflows(files),
    loadSetupAction(files),
  ]);
  if (!versions.ok || !workflows.ok || !setupAction.ok) {
    return failed(errorsOf([versions, workflows, setupAction]));
  }
  return loaded({
    workflows: workflows.value,
    setupAction: setupAction.value,
    versions: versions.value,
  });
}

export const command: DeliveryCommand = {
  name: 'policy-check',
  description:
    '全ワークフローと複合アクションの権限・固定・版・段階の順序を検査する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const input = await loadWorkflowPolicyInput(deps.files);
    if (!input.ok) return reportInputErrors(TITLE, input.errors, deps);
    return reportViolations(TITLE, checkWorkflowPolicy(input.value), deps);
  },
};
