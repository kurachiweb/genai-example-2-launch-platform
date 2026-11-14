import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = join(import.meta.dir, '..');

const WRANGLER_DEFAULT_INSPECTOR_PORT = 9229;

const readRepoFile = (repoRelativePath: string): string =>
  readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8');

const readDevScript = (appDir: string): string => {
  const manifest = JSON.parse(readRepoFile(`${appDir}/package.json`)) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const script = manifest.scripts?.dev;
  if (script === undefined) {
    throw new Error(`${appDir}/package.jsonにdevスクリプトがありません`);
  }
  return script;
};

const explicitInspectorPortOf = (script: string): number | undefined => {
  const match = /--inspector-port[=\s]+(\d+)/.exec(script);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const isCloudflareCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'cloudflare';

const inspectorPortsOfCall = (call: ts.CallExpression): readonly number[] =>
  call.arguments
    .filter(ts.isObjectLiteralExpression)
    .flatMap((options) => options.properties)
    .filter(ts.isPropertyAssignment)
    .filter(
      (property) =>
        ts.isIdentifier(property.name) &&
        property.name.text === 'inspectorPort',
    )
    .map((property) => property.initializer)
    .filter(ts.isNumericLiteral)
    .map((literal) => Number(literal.text));

const findCloudflareInspectorPorts = (node: ts.Node): readonly number[] => [
  ...(isCloudflareCall(node) ? inspectorPortsOfCall(node) : []),
  ...node.getChildren().flatMap(findCloudflareInspectorPorts),
];

const readViteInspectorPort = (appDir: string): number => {
  const path = `${appDir}/vite.config.ts`;
  const source = ts.createSourceFile(
    path,
    readRepoFile(path),
    ts.ScriptTarget.Latest,
    true,
  );
  const ports = findCloudflareInspectorPorts(source);
  if (ports.length !== 1 || ports[0] === undefined) {
    throw new Error(
      `${path}のcloudflare()の引数から数値リテラルのinspectorPortを1つだけ読み取れません(${String(ports.length)}件)`,
    );
  }
  return ports[0];
};

const readEventInspectorPort = (): number => {
  const port = explicitInspectorPortOf(readDevScript('apps/event'));
  if (port === undefined) {
    throw new Error(
      'apps/event/package.jsonのdevスクリプトから--inspector-portを読み取れません',
    );
  }
  return port;
};

const readApiInspectorPort = (): number =>
  explicitInspectorPortOf(readDevScript('apps/api')) ??
  WRANGLER_DEFAULT_INSPECTOR_PORT;

describe('ローカル開発のインスペクターのポート', () => {
  test('client・adminのvite.config.tsがcloudflare()のinspectorPortを数値で固定している', () => {
    expect(Number.isInteger(readViteInspectorPort('apps/client'))).toBe(true);
    expect(Number.isInteger(readViteInspectorPort('apps/admin'))).toBe(true);
  });

  test('eventのdevスクリプトが--inspector-portを固定している', () => {
    expect(Number.isInteger(readEventInspectorPort())).toBe(true);
  });

  test('api・event・client・adminを同時に起動しても互いに重ならない', () => {
    const ports = {
      api: readApiInspectorPort(),
      event: readEventInspectorPort(),
      client: readViteInspectorPort('apps/client'),
      admin: readViteInspectorPort('apps/admin'),
    };

    const appsSharingPort = Object.entries(
      Object.groupBy(Object.entries(ports), ([, port]) => port),
    )
      .map(([port, entries = []]) => ({
        port: Number(port),
        apps: entries.map(([app]) => app),
      }))
      .filter(({ apps }) => apps.length > 1);

    expect(appsSharingPort).toEqual([]);
  });
});
