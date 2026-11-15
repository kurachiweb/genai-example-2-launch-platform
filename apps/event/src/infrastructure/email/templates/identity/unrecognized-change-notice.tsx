import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

export function UnrecognizedChangeNotice(): ReactNode {
  return (
    <Text>
      お心当たりが無い場合は、第三者にアカウントを操作されたおそれがあります。下のボタンからお問い合わせのうえ、ログイン画面の案内に従ってパスワードを再設定してください。
    </Text>
  );
}
