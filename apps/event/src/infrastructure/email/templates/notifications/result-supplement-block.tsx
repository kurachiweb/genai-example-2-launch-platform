import { Heading, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ResultNoticeSupplement } from '../../../../../lib/core/notifications/result-notice-supplements.ts';

interface ResultSupplementBlockProps {
  readonly supplement: ResultNoticeSupplement;
}

// 追記の行動は主要な行動のボタンに使うため、ここでは見出しと段落だけを描く
export function ResultSupplementBlock({
  supplement,
}: ResultSupplementBlockProps): ReactNode {
  return (
    <>
      <Heading as="h2">{supplement.title}</Heading>
      {supplement.lines.map((line, index) => (
        <Text key={`${String(index)}:${line}`}>
          {supplement.emphasized ? <strong>{line}</strong> : line}
        </Text>
      ))}
    </>
  );
}
