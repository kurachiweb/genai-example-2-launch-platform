import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

// 管理者には問い合わせの窓口が無く、アカウントの削除やロールの変更は他の管理者が行うため、連絡先を他の管理者にする
export function AdminUnrecognizedChangeNotice(): ReactNode {
  return (
    <Text>
      お心当たりが無い場合は、第三者に管理者アカウントを操作されたおそれがあります。すぐに他の管理者へ連絡してください。
    </Text>
  );
}
