import { describe, expect, test } from 'vitest';

import committedSchema from '../presentation/graphql/generated/schema.graphql?raw';
import {
  composeGatewaySchema,
  printGatewaySchema,
} from '../presentation/graphql/schema-composer.ts';
import { GRAPHQL_SCHEMA_MODULES } from './graphql-modules.ts';

const REGENERATE_MESSAGE =
  'スキーマファイルがスキーマモジュールの定義と一致しません。`bun run graphql:generate`を実行して生成物を更新してください。';

describe('GRAPHQL_SCHEMA_MODULES', () => {
  test('登録したモジュールを合成して印字した結果が、コミットしたスキーマファイルと一致する', () => {
    const printed = printGatewaySchema(
      composeGatewaySchema(GRAPHQL_SCHEMA_MODULES),
    );

    expect(printed, REGENERATE_MESSAGE).toBe(committedSchema);
  });

  test('疎通確認のクエリがスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const systemStatus = schema.getQueryType()?.getFields()['systemStatus'];

    expect(String(systemStatus?.type)).toBe('SystemStatus!');
    expect(schema.getType('SystemStatus')?.toString()).toBe('SystemStatus');
  });
});

describe('GRAPHQL_SCHEMA_MODULES(メディア)', () => {
  test('下流のドメインが項目に使うメディアの型と形式の列挙型がスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    expect(String(schema.getType('MediaImage'))).toBe('MediaImage');
    expect(String(schema.getType('MediaAttachment'))).toBe('MediaAttachment');
    expect(String(schema.getType('MediaImageFallbackFormat'))).toBe(
      'MediaImageFallbackFormat',
    );
  });
});

describe('GRAPHQL_SCHEMA_MODULES(法務文書)', () => {
  test('公開の照会と、法務文書の種類の列挙型がスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const query = schema.getQueryType()?.getFields();

    expect(String(query?.['legalDocument']?.type)).toBe('LegalDocument!');
    expect(String(query?.['legalDocumentVersion']?.type)).toBe(
      'LegalDocumentVersion',
    );
    expect(String(schema.getType('LegalDocumentKind'))).toBe(
      'LegalDocumentKind',
    );
  });
});
