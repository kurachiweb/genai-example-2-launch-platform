import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

export function PaymentFailedEmailBody(): ReactNode {
  return (
    <>
      <Text>
        Ultrasの毎月のお支払いに失敗しました。お支払いを再試行しています。
      </Text>
      <Text>
        再試行の間も特典は続きます。再試行がすべて失敗すると、特典は終了します。
      </Text>
      <Text>
        特典を続けるには、下のボタンからプラン管理画面を開き、「解約・支払い方法の管理」から支払い方法を更新してください。
      </Text>
    </>
  );
}
