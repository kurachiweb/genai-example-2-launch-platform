import { useState } from 'react';

import { SystemStatusView } from '../../../lib/components/system/system-status-view.tsx';
import { createNetworkError } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { SystemStatusResult } from '../../../lib/utilities/system/system-status-result.ts';

export interface SystemStatusPageProps {
  readonly server: SystemStatusResult;
  readonly recheck: () => Promise<SystemStatusResult>;
}

export function SystemStatusPage({ server, recheck }: SystemStatusPageProps) {
  const [browser, setBrowser] = useState<SystemStatusResult>();
  const [rechecking, setRechecking] = useState(false);

  // 取得の失敗は結果として返るが、取得そのものが例外で終わっても再確認中のまま止めず、通信の失敗として表示する
  const handleRecheck = () => {
    setRechecking(true);
    void recheck()
      .catch((cause: unknown): SystemStatusResult => ({
        ok: false,
        error: createNetworkError(cause),
      }))
      .then((result) => {
        setBrowser(result);
        setRechecking(false);
      });
  };

  return (
    <SystemStatusView
      server={server}
      browser={browser}
      onRecheck={handleRecheck}
      rechecking={rechecking}
    />
  );
}
