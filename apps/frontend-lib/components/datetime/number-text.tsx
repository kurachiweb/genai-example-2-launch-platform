import { formatNumber } from '../../utilities/number/number-format.ts';
import { useDisplayPreferences } from './use-display-preferences.ts';

export interface NumberTextProps {
  readonly value: number;
  readonly options?: Intl.NumberFormatOptions;
}

export function NumberText({ value, options }: NumberTextProps) {
  const preferences = useDisplayPreferences();
  return <span>{formatNumber(value, preferences, options)}</span>;
}
