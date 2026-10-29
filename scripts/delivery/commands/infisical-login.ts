import { isPlaceholderId } from '../catalog/resource-catalog.ts';
import { SECRET_SCOPES } from '../core/secret-scope.ts';
import {
  type DeliveryCommand,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import {
  type ChecksIdentity,
  loadInfisicalTarget,
} from './shared/infisical-target.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'infisical-login';
const TITLE = 'Infisicalへのログイン';
const TOKEN_ENV = 'INFISICAL_TOKEN';

export interface InfisicalLoginCommandOptions {
  readonly checksIdentity?: ChecksIdentity;
}

export function createInfisicalLoginCommand({
  checksIdentity,
}: InfisicalLoginCommandOptions = {}): DeliveryCommand {
  return {
    name: NAME,
    description: `範囲の主体でOIDCによりInfisicalへログインし、アクセストークンをマスクして${TOKEN_ENV}として後続の手順へ渡す`,
    run: async (args, deps) => {
      const { options } = parseOptions(args, {
        names: ['scope'],
        rest: 'none',
      });
      const scope = requiredChoice(options, 'scope', SECRET_SCOPES);
      const target = await loadInfisicalTarget(
        deps.files,
        scope,
        checksIdentity,
      );
      if (!target.ok) return reportInputErrors(TITLE, target.errors, deps);
      const { identityId, identitySource, oidcAudience, host, environment } =
        target.value;
      if (isPlaceholderId(identityId)) {
        deps.stderr.write(
          `${NAME}: 範囲${scope}の主体のIDが仮の値です。${identitySource}に主体のIDを記入してください。\n`,
        );
        return EXIT_FAILURE;
      }
      const jwt = await deps.github.oidcToken(oidcAudience);
      const token = await deps.secrets.login({ identityId, jwt, host });
      deps.github.mask(token);
      deps.github.exportEnv(TOKEN_ENV, token);
      deps.stdout.write(
        `${NAME}: 範囲${scope}の主体${identityId}でInfisicalにログインし、${TOKEN_ENV}を後続の手順へ渡しました(取り出す環境: ${environment})。\n`,
      );
      return EXIT_SUCCESS;
    },
  };
}

export const command: DeliveryCommand = createInfisicalLoginCommand();
