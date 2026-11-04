import type { AuditActionDefinition } from '../../../common-lib/admin/audit-action.ts';
import type { AdminAccount } from '../../graphql/admin-accounts.ts';
import { unlistedOperatorLabel } from './audit-logs-messages.ts';

export interface AuditLogFilterOption {
  readonly value: string;
  readonly label: string;
}

// 共有されたURLの条件が選択肢に無いと選択の欄が空に見えるため、条件の値を示す選択肢を加える
const withSelected = (
  options: readonly AuditLogFilterOption[],
  selected: string | undefined,
  labelOf: (value: string) => string,
): readonly AuditLogFilterOption[] =>
  selected === undefined || options.some(({ value }) => value === selected)
    ? options
    : [...options, { value: selected, label: labelOf(selected) }];

// 招待の完了前の管理者は操作を行えないため、有効な管理者だけを選択肢にする
export const operatorOptionsOf = (
  accounts: readonly AdminAccount[],
  selected: string | undefined,
): readonly AuditLogFilterOption[] =>
  withSelected(
    accounts.flatMap(({ id, nickname, status }) =>
      status === 'active' && nickname !== null
        ? [{ value: id, label: nickname }]
        : [],
    ),
    selected,
    unlistedOperatorLabel,
  );

export const actionOptionsOf = (
  actions: readonly AuditActionDefinition[],
  selected: string | undefined,
): readonly AuditLogFilterOption[] =>
  withSelected(
    actions.map(({ name, label }) => ({ value: name, label })),
    selected,
    (name) => name,
  );
