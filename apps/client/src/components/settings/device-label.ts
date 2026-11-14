import { UNKNOWN_DEVICE_LABEL } from './settings-messages.ts';

export interface DeviceNames {
  readonly browserName: string | null;
  readonly osName: string | null;
}

const presentName = (name: string | null): string | undefined => {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

// User-Agentからはブラウザ名とOS名の片方だけが分かることがあるため、分かった方だけで示す
export function deviceLabelOf({ browserName, osName }: DeviceNames): string {
  const browser = presentName(browserName);
  const os = presentName(osName);
  if (browser !== undefined && os !== undefined) {
    return `${browser}(${os})`;
  }
  return browser ?? os ?? UNKNOWN_DEVICE_LABEL;
}
