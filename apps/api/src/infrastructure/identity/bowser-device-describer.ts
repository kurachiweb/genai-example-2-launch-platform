import Bowser from 'bowser';
import { injectable } from 'inversify';

import type {
  DeviceDescriber,
  DeviceDescription,
} from '../../application/identity/ports.ts';

const UNKNOWN_DEVICE: DeviceDescription = Object.freeze({
  browserName: null,
  osName: null,
});

function nameOrNull(name: string | undefined): string | null {
  return name === undefined || name === '' ? null : name;
}

@injectable()
export class BowserDeviceDescriber implements DeviceDescriber {
  describe(userAgent: string | null): DeviceDescription {
    // bowserは空のUser-Agentで例外を投げる
    if (userAgent === null || userAgent === '') {
      return UNKNOWN_DEVICE;
    }
    const { browser, os } = Bowser.parse(userAgent);
    return {
      browserName: nameOrNull(browser.name),
      osName: nameOrNull(os.name),
    };
  }
}
