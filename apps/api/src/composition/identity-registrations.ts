import type { ServiceIdentifier } from 'inversify';

import type { HandleAvailability } from '../application/identity/ports.ts';
import { D1HandleAvailability } from '../infrastructure/identity/d1-handle-availability.ts';

// ハンドルの重複判定を広げる機能が、自身のモジュールで束縛した識別子へ差し替える。束縛はこの識別子への転送のため、他のファイルを変えずに差し替えられる
export const HANDLE_AVAILABILITY: ServiceIdentifier<HandleAvailability> =
  D1HandleAvailability;
