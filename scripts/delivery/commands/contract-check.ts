import { DEPLOY_ENVIRONMENTS } from '../catalog/resource-catalog.ts';
import { checkConfigContract } from '../core/config-contract.ts';
import {
  loadContractInput,
  uniqueViolations,
} from './shared/contract-input.ts';
import { type DeliveryCommand, UsageError } from './shared/delivery-command.ts';
import { allLoaded } from './shared/load-input.ts';
import {
  reportInputErrors,
  reportViolations,
} from './shared/report-violations.ts';

const TITLE = '構成検査';

export const command: DeliveryCommand = {
  name: 'contract-check',
  description:
    '両環境の資源一覧・4アプリのWrangler設定・backend設定の食い違いを検査する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const inputs = allLoaded(
      await Promise.all(
        DEPLOY_ENVIRONMENTS.map((env) => loadContractInput(deps.files, env)),
      ),
    );
    if (!inputs.ok) return reportInputErrors(TITLE, inputs.errors, deps);
    return reportViolations(
      TITLE,
      uniqueViolations(
        inputs.value.flatMap((input) => checkConfigContract(input)),
      ),
      deps,
    );
  },
};
