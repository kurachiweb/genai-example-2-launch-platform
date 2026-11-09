import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、子プロセスのbunで評価した値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const BACKEND_LAUNCH_STATUS = 'apps/backend-lib/core/product/launch-status.ts';
const CLIENT_PRODUCT_BUSINESS_TIME =
  'apps/client/src/components/product/business-time.ts';

const INPUT_VARIABLE = 'LAUNCH_TIME_CONTRACT_INPUT';

const COMPARISON_SCRIPT = `
const { modules, name } = JSON.parse(process.env.${INPUT_VARIABLE});
const [backend, client] = await Promise.all([
  import(modules.backend),
  import(modules.client),
]);
console.log(JSON.stringify({ backend: backend[name], client: client[name] }));
`;

const valuesOf = (
  name: string,
): { readonly backend: unknown; readonly client: unknown } => {
  const result = Bun.spawnSync(
    [process.execPath, '--eval', COMPARISON_SCRIPT],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        [INPUT_VARIABLE]: JSON.stringify({
          modules: {
            backend: join(REPO_ROOT, BACKEND_LAUNCH_STATUS),
            client: join(REPO_ROOT, CLIENT_PRODUCT_BUSINESS_TIME),
          },
          name,
        }),
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return JSON.parse(result.stdout.toString()) as {
    readonly backend: unknown;
    readonly client: unknown;
  };
};

describe('業務時刻の境界の写し(components/product/business-time.ts)', () => {
  test('マッチ直前の固定の始まりがbackend-libのPAIRING_TIMEと一致する', () => {
    const { backend, client } = valuesOf('PAIRING_TIME');

    expect(backend).toEqual({ hour: 23, minute: 45 });
    expect(client).toEqual(backend);
  });
});
