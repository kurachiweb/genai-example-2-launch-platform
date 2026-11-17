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

describe('GRAPHQL_SCHEMA_MODULES(決済)', () => {
  test('決済の照会・変更の操作と、後続specの決済を始める変更操作が返すCheckoutStartがスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const query = schema.getQueryType()?.getFields();
    const mutation = schema.getMutationType()?.getFields();

    expect(String(query?.['checkout']?.type)).toBe('Checkout!');
    expect(String(query?.['paymentHistory']?.type)).toBe(
      'PaymentRecordConnection!',
    );
    expect(String(mutation?.['recordCheckoutConsent']?.type)).toBe('Checkout!');
    expect(String(mutation?.['confirmCheckoutReturn']?.type)).toBe(
      'CheckoutReturnResult!',
    );
    expect(String(mutation?.['startSmokeCheckout']?.type)).toBe(
      'CheckoutStart!',
    );
  });
});

describe('GRAPHQL_SCHEMA_MODULES(Ultras)', () => {
  test('料金とプランの照会・加入の開始・Portalのセッションの作成・機能フラグの照会と変更の操作と、加入状態の列挙型がスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const query = schema.getQueryType()?.getFields();
    const mutation = schema.getMutationType()?.getFields();

    expect(String(query?.['ultrasOffer']?.type)).toBe('UltrasOffer!');
    expect(String(query?.['viewerUltras']?.type)).toBe('ViewerUltras');
    expect(String(mutation?.['startUltrasCheckout']?.type)).toBe(
      'CheckoutStart!',
    );
    expect(String(mutation?.['createUltrasPortalSession']?.type)).toBe(
      'UltrasPortalSession!',
    );
    expect(String(query?.['ultrasPromotionSetting']?.type)).toBe(
      'UltrasPromotionSetting!',
    );
    expect(String(mutation?.['updateUltrasPromotionSetting']?.type)).toBe(
      'UltrasPromotionSetting!',
    );
    expect(String(schema.getType('UltrasPlanStatus'))).toBe('UltrasPlanStatus');
  });
});

describe('GRAPHQL_SCHEMA_MODULES(プロフィール)', () => {
  test('後続specが項目に使う利用者の表示の型が、画像をメディアの型で返す形でスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const summary = schema.getType('UserSummary');

    expect(String(summary)).toBe('UserSummary');
    expect(
      String(
        (
          summary as unknown as {
            getFields(): Record<string, { type: unknown }>;
          }
        ).getFields()['avatar']?.type,
      ),
    ).toBe('MediaImage');
  });
});

describe('GRAPHQL_SCHEMA_MODULES(コメントと評価)', () => {
  test('コメントの照会と、後続の操作が返す評価欄の値と操作の結果の型がスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const query = schema.getQueryType()?.getFields();

    expect(String(query?.['launchComments']?.type)).toBe(
      'LaunchCommentConnection',
    );
    expect(String(query?.['launchCommentCounts']?.type)).toBe(
      '[LaunchCommentCount!]',
    );
    expect(String(schema.getType('LaunchCommentState'))).toBe(
      'LaunchCommentState',
    );
    expect(String(schema.getType('ProductRating'))).toBe('ProductRating');
    expect(String(schema.getType('CommentMutationResult'))).toBe(
      'CommentMutationResult',
    );
  });
});

describe('GRAPHQL_SCHEMA_MODULES(Weekトーナメント)', () => {
  test('トップページの区画・ブラケット・参加費の導線・トロフィーの照会と決済の開始の操作、Yearと共用するブラケットの型がスキーマに含まれる', () => {
    const schema = composeGatewaySchema(GRAPHQL_SCHEMA_MODULES);

    const query = schema.getQueryType()?.getFields();

    expect(String(query?.['weekTournamentBoard']?.type)).toBe(
      'WeekTournamentBoard!',
    );
    expect(String(query?.['weekBracket']?.type)).toBe('WeekBracket');
    expect(String(query?.['productTrophies']?.type)).toBe('[Trophy!]');
    expect(String(query?.['myWeekEntry']?.type)).toBe('WeekEntryPanel');
    expect(
      String(
        schema.getMutationType()?.getFields()['startWeekTournamentCheckout']
          ?.type,
      ),
    ).toBe('CheckoutStart!');
    expect(String(schema.getType('BracketRound'))).toBe('BracketRound');
    expect(String(schema.getType('BracketNode'))).toBe('BracketNode');
    expect(String(schema.getType('BracketSlot'))).toBe('BracketSlot');
  });
});
