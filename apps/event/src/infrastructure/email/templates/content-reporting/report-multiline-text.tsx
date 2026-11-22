import { Text } from '@react-email/components';
import { Fragment, type ReactNode } from 'react';

interface ReportMultilineTextProps {
  readonly label: string;
  readonly value: string;
}

// 管理者の理由・照会の内容と利用者のコメントは改行を含み得るため、行ごとに改行の要素で区切ってHTMLとテキストの両方で改行を保つ
export function ReportMultilineText({
  label,
  value,
}: ReportMultilineTextProps): ReactNode {
  const lines = value.split(/\r\n|\r|\n/u);
  return (
    <Text>
      {`${label}:`}
      {lines.map((line, index) => (
        <Fragment key={index}>
          <br />
          {line}
        </Fragment>
      ))}
    </Text>
  );
}
