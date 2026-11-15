import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

interface EmailGreetingProps {
  readonly nickname: string;
}

export function EmailGreeting({ nickname }: EmailGreetingProps): ReactNode {
  return <Text>{`${nickname}さん`}</Text>;
}
