import { WITHDRAWAL_IMPACTS } from './settings-messages.ts';

export function WithdrawalImpacts() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
      {WITHDRAWAL_IMPACTS.map((impact) => (
        <li key={impact}>{impact}</li>
      ))}
    </ul>
  );
}
