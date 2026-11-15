import {
  type InfisicalEnvironment,
  type SecretEntry,
  type SecretFolder,
  parseInfisicalExport,
} from '../core/secret-scope.ts';
import type { CommandRunner } from './command-runner.ts';

export interface SecretSource {
  login(input: {
    readonly identityId: string;
    readonly jwt: string;
    readonly host: string;
  }): Promise<string>;
  exportFolder(input: {
    readonly projectId: string;
    readonly environment: InfisicalEnvironment;
    readonly folder: SecretFolder;
    readonly host: string;
  }): Promise<readonly SecretEntry[]>;
}

export interface InfisicalSecretSourceOptions {
  readonly runner: CommandRunner;
}

const INFISICAL = 'infisical';
const GLOBAL_ARGS: readonly string[] = ['--telemetry=false'];

export function createInfisicalSecretSource({
  runner,
}: InfisicalSecretSourceOptions): SecretSource {
  return {
    login: async ({ identityId, jwt, host }) => {
      const result = await runner.run({
        command: INFISICAL,
        args: [
          ...GLOBAL_ARGS,
          'login',
          '--method=oidc-auth',
          `--machine-identity-id=${identityId}`,
          `--jwt=${jwt}`,
          `--domain=${host}`,
          '--silent',
          '--plain',
        ],
        output: 'capture',
      });
      const context = `主体${identityId}・接続先${host}`;
      if (result.code !== 0) {
        throw new Error(
          `Infisicalへのログインが失敗しました(${context}・終了コード${String(result.code)}): ${result.stderr.trim()}`,
        );
      }
      const token = result.stdout.trim();
      if (token === '') {
        throw new Error(
          `Infisicalへのログインでアクセストークンが出力されませんでした(${context})`,
        );
      }
      return token;
    },
    // 取り出しの失敗では、標準出力と標準エラー出力に値が含まれ得るため、環境とフォルダの名前だけを示す
    exportFolder: async ({ projectId, environment, folder, host }) => {
      const result = await runner.run({
        command: INFISICAL,
        args: [
          ...GLOBAL_ARGS,
          'export',
          '--format=json',
          `--env=${environment}`,
          `--path=${folder}`,
          `--projectId=${projectId}`,
          `--domain=${host}`,
          '--silent',
        ],
        output: 'capture',
      });
      const target = `Infisicalの${environment}のフォルダ${folder}`;
      if (result.code !== 0) {
        throw new Error(
          `${target}を取り出せませんでした(終了コード${String(result.code)})`,
        );
      }
      const parsed = parseInfisicalExport(result.stdout);
      if ('error' in parsed) {
        throw new Error(
          `${target}の出力を取り込めませんでした(${parsed.error})`,
        );
      }
      return parsed;
    },
  };
}
