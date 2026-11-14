export interface ExpectedToolVersions {
  readonly bun: string;
  readonly node: string;
  readonly opentofu: string;
  readonly infisicalCli: string;
  readonly wranglerTool: string;
  readonly mailpit: string;
  readonly playwright: string;
}

export type ToolName = keyof ExpectedToolVersions;

export interface ToolVersionOccurrence {
  readonly tool: ToolName;
  readonly key: string;
  readonly value: string;
}

export interface ToolVersionSources {
  readonly dockerfile: string;
  readonly liveVersionsTf: string;
  readonly rootPackageJson: string;
}

export type ExpectedToolVersionsResult =
  | { readonly ok: true; readonly versions: ExpectedToolVersions }
  | { readonly ok: false; readonly errors: readonly string[] };

export const LIVE_VERSIONS_TF_PATH = 'apps/infra/live/versions.tf';

const PLAYWRIGHT_PACKAGE = '@playwright/test';

const DOCKERFILE_ARGS: Readonly<Record<ToolName, string>> = {
  bun: 'BUN_IMAGE_TAG',
  node: 'NODE_VERSION',
  opentofu: 'OPENTOFU_VERSION',
  infisicalCli: 'INFISICAL_CLI_VERSION',
  wranglerTool: 'WRANGLER_VERSION',
  mailpit: 'MAILPIT_VERSION',
  playwright: 'PLAYWRIGHT_VERSION',
};

const TOOL_NAMES = Object.keys(DOCKERFILE_ARGS) as readonly ToolName[];

const ENV_TOOLS: Readonly<Record<string, ToolName>> = {
  BUN_VERSION: 'bun',
  NODE_VERSION: 'node',
  OPENTOFU_VERSION: 'opentofu',
  INFISICAL_CLI_VERSION: 'infisicalCli',
  WRANGLER_VERSION: 'wranglerTool',
  MAILPIT_VERSION: 'mailpit',
  PLAYWRIGHT_VERSION: 'playwright',
};

const SETUP_ACTIONS: Readonly<
  Record<string, { readonly tool: ToolName; readonly input: string }>
> = {
  'oven-sh/setup-bun': { tool: 'bun', input: 'bun-version' },
  'actions/setup-node': { tool: 'node', input: 'node-version' },
  'opentofu/setup-opentofu': { tool: 'opentofu', input: 'tofu_version' },
};

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

const BUN_IMAGE_TAG = /^(\d+\.\d+\.\d+)(?:-[a-z]+)?$/;

const DOCKERFILE_ARG = /^\s*ARG\s+([A-Z][A-Z\d_]*)=(\S+)\s*$/gm;

const QUOTED = /^(["'])(.*)\1$/;

const REQUIRED_VERSION = /^\s*required_version\s*=\s*"([^"]*)"/m;

// runの中の`wrangler@<版>`・`playwright@<版>`・`@playwright/test@<版>`を、書かれた順に拾う
const RUN_PACKAGE_VERSION =
  /(?<![\w@/.-])(?:(?<wrangler>wrangler)|@?playwright(?:\/test)?)@(?<version>[^\s"'`;|&)]+)/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const scalarText = (value: unknown): string =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'
    ? String(value)
    : '';

interface DockerfileArgConflict {
  readonly name: string;
  readonly previous: string;
  readonly value: string;
}

interface DockerfileArgs {
  readonly args: ReadonlyMap<string, string>;
  readonly conflicts: readonly DockerfileArgConflict[];
}

export type DockerfileToolVersion =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly error: string };

const readDockerfileArgs = (dockerfile: string): DockerfileArgs => {
  const args = new Map<string, string>();
  const conflicts: DockerfileArgConflict[] = [];
  for (const [, name = '', raw = ''] of dockerfile.matchAll(DOCKERFILE_ARG)) {
    const value = QUOTED.exec(raw)?.[2] ?? raw;
    const previous = args.get(name);
    if (previous === undefined) {
      args.set(name, value);
    } else if (previous !== value) {
      conflicts.push({ name, previous, value });
    }
  }
  return { args, conflicts };
};

const conflictMessageOf = ({
  name,
  previous,
  value,
}: DockerfileArgConflict): string =>
  `DockerfileのARG ${name}の既定値が食い違っています: ${previous}・${value}`;

const exactVersionOf = (tool: ToolName, value: string): string | undefined =>
  tool === 'bun'
    ? BUN_IMAGE_TAG.exec(value)?.[1]
    : EXACT_VERSION.test(value)
      ? value
      : undefined;

const toolVersionOf = (
  args: ReadonlyMap<string, string>,
  tool: ToolName,
): DockerfileToolVersion => {
  const name = DOCKERFILE_ARGS[tool];
  const value = args.get(name);
  if (value === undefined) {
    return { ok: false, error: `DockerfileにARG ${name}がありません` };
  }
  const version = exactVersionOf(tool, value);
  return version === undefined
    ? {
        ok: false,
        error: `DockerfileのARG ${name}が完全に固定した版ではありません: ${value}`,
      }
    : { ok: true, version };
};

const readDockerfileVersions = (
  dockerfile: string,
): {
  readonly versions: Partial<Record<ToolName, string>>;
  readonly errors: readonly string[];
} => {
  const { args, conflicts } = readDockerfileArgs(dockerfile);
  const versions: Partial<Record<ToolName, string>> = {};
  const versionErrors = TOOL_NAMES.flatMap((tool) => {
    const result = toolVersionOf(args, tool);
    if (!result.ok) return [result.error];
    versions[tool] = result.version;
    return [];
  });
  return {
    versions,
    errors: [...conflicts.map(conflictMessageOf), ...versionErrors],
  };
};

export function dockerfileToolVersion(
  dockerfile: string,
  tool: ToolName,
): DockerfileToolVersion {
  const { args, conflicts } = readDockerfileArgs(dockerfile);
  const conflict = conflicts.find(({ name }) => name === DOCKERFILE_ARGS[tool]);
  return conflict === undefined
    ? toolVersionOf(args, tool)
    : { ok: false, error: conflictMessageOf(conflict) };
}

const opentofuErrors = (
  liveVersionsTf: string,
  opentofu: string | undefined,
): readonly string[] => {
  const required = REQUIRED_VERSION.exec(liveVersionsTf)?.[1];
  if (required === undefined) {
    return [`${LIVE_VERSIONS_TF_PATH}にrequired_versionがありません`];
  }
  return opentofu === undefined || required === opentofu
    ? []
    : [
        `${LIVE_VERSIONS_TF_PATH}のrequired_version(${required})がDockerfileのOPENTOFU_VERSION(${opentofu})と一致しません`,
      ];
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const dependencyVersionOf = (
  manifest: Record<string, unknown>,
  name: string,
): string | undefined => {
  const { devDependencies, dependencies } = manifest;
  const declared =
    (isRecord(devDependencies) ? devDependencies[name] : undefined) ??
    (isRecord(dependencies) ? dependencies[name] : undefined);
  return declared === undefined ? undefined : scalarText(declared);
};

const playwrightErrors = (
  rootPackageJson: string,
  playwright: string | undefined,
): readonly string[] => {
  const manifest = parseJson(rootPackageJson);
  if (!isRecord(manifest)) return ['package.jsonをJSONとして読めません'];
  const declared = dependencyVersionOf(manifest, PLAYWRIGHT_PACKAGE);
  if (declared === undefined) {
    return [`package.jsonに${PLAYWRIGHT_PACKAGE}がありません`];
  }
  return playwright === undefined || declared === playwright
    ? []
    : [
        `package.jsonの${PLAYWRIGHT_PACKAGE}(${declared})がDockerfileのPLAYWRIGHT_VERSION(${playwright})と一致しません`,
      ];
};

const isComplete = (
  versions: Partial<Record<ToolName, string>>,
): versions is ExpectedToolVersions =>
  TOOL_NAMES.every((tool) => versions[tool] !== undefined);

export function readExpectedToolVersions(
  input: ToolVersionSources,
): ExpectedToolVersionsResult {
  const { versions, errors } = readDockerfileVersions(input.dockerfile);
  const allErrors = [
    ...errors,
    ...opentofuErrors(input.liveVersionsTf, versions.opentofu),
    ...playwrightErrors(input.rootPackageJson, versions.playwright),
  ];
  if (allErrors.length > 0 || !isComplete(versions)) {
    return { ok: false, errors: allErrors };
  }
  return { ok: true, versions };
}

export function toolVersionsInEnv(
  env: unknown,
): readonly ToolVersionOccurrence[] {
  if (!isRecord(env)) return [];
  return Object.entries(env).flatMap(([name, value]) => {
    const tool = ENV_TOOLS[name];
    return tool === undefined
      ? []
      : [{ tool, key: `env.${name}`, value: scalarText(value) }];
  });
}

const setupActionVersionOf = (
  step: Record<string, unknown>,
): readonly ToolVersionOccurrence[] => {
  const action = scalarText(step.uses).split('@')[0] ?? '';
  const setup = SETUP_ACTIONS[action];
  if (setup === undefined) return [];
  const inputs = isRecord(step.with) ? step.with : {};
  return [
    {
      tool: setup.tool,
      key: `with.${setup.input}`,
      value: scalarText(inputs[setup.input]),
    },
  ];
};

const runVersionsOf = (run: unknown): readonly ToolVersionOccurrence[] =>
  [...scalarText(run).matchAll(RUN_PACKAGE_VERSION)].flatMap(({ groups }) => {
    const version = groups?.version ?? '';
    if (version.startsWith('$')) return [];
    const tool: ToolName =
      groups?.wrangler === undefined ? 'playwright' : 'wranglerTool';
    return [{ tool, key: 'run', value: version }];
  });

export function toolVersionsInStep(
  step: unknown,
): readonly ToolVersionOccurrence[] {
  if (!isRecord(step)) return [];
  return [
    ...setupActionVersionOf(step),
    ...toolVersionsInEnv(step.env),
    ...runVersionsOf(step.run),
  ];
}
