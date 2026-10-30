import { describe, expect, test } from 'bun:test';

import {
  type HclBody,
  attributeObjectOf,
  attributeTokensOf,
  blocksOf,
  parseHcl,
} from './hcl-blocks.ts';

const resourceOf = (text: string, type: string): HclBody => {
  const [block] = blocksOf(parseHcl(text), 'resource', type);
  if (block === undefined) throw new Error(`${type}の資源がありません`);
  return block.body;
};

describe('parseHcl', () => {
  test('種類とラベルで資源のブロックを選び、属性の値を字句の並びで返す', () => {
    const text = [
      'resource "cloudflare_d1_database" "this" {',
      '  for_each = var.databases',
      '  name     = each.value.name',
      '}',
      '',
      'resource "cloudflare_queue" "this" {',
      '  queue_name = each.value.name',
      '}',
    ].join('\n');

    const blocks = blocksOf(parseHcl(text), 'resource', 'cloudflare_queue');

    expect(blocks.map((block) => block.labels)).toEqual([
      ['cloudflare_queue', 'this'],
    ]);
    expect(attributeTokensOf(blocks[0]?.body, 'queue_name')).toEqual([
      'each',
      '.',
      'value',
      '.',
      'name',
    ]);
  });

  test('入れ子のブロックと、オブジェクトの値の中の属性を読める', () => {
    const body = resourceOf(
      [
        'resource "cloudflare_d1_database" "this" {',
        '  read_replication = {',
        '    mode  = "disabled"',
        '    other = 1, last = 2',
        '  }',
        '  lifecycle {',
        '    prevent_destroy = true',
        '  }',
        '}',
      ].join('\n'),
      'cloudflare_d1_database',
    );

    const [lifecycle] = blocksOf(body, 'lifecycle');

    expect(
      attributeTokensOf(attributeObjectOf(body, 'read_replication'), 'mode'),
    ).toEqual(['"disabled"']);
    expect(
      attributeTokensOf(attributeObjectOf(body, 'read_replication'), 'other'),
    ).toEqual(['1']);
    expect(
      attributeTokensOf(attributeObjectOf(body, 'read_replication'), 'last'),
    ).toEqual(['2']);
    expect(attributeTokensOf(lifecycle?.body, 'prevent_destroy')).toEqual([
      'true',
    ]);
  });

  test('コメントの中の属性・ブロックは読まない', () => {
    const body = resourceOf(
      [
        'resource "cloudflare_r2_bucket" "this" {',
        '  # location = "weur"',
        '  // lifecycle { prevent_destroy = true }',
        '  /* environment = "production"',
        '     jurisdiction = "eu" */',
        '  name = "bucket" # prevent_destroy = true',
        '}',
      ].join('\n'),
      'cloudflare_r2_bucket',
    );

    expect([...body.attributes.keys()]).toEqual(['name']);
    expect(attributeTokensOf(body, 'name')).toEqual(['"bucket"']);
    expect(body.blocks).toEqual([]);
  });

  test('文字列とヒアドキュメントの中の波括弧・コメントの記号・属性の形を構造として扱わない', () => {
    const body = resourceOf(
      [
        'resource "cloudflare_turnstile_widget" "this" {',
        '  name = "a { # b ${var.x} \\" } c"',
        '  note = <<-EOT',
        '    location = "weur" }',
        '    # prevent_destroy = true',
        '    EOT',
        '  template = "${jsonencode({ "x" = "}" })}"',
        '}',
      ].join('\n'),
      'cloudflare_turnstile_widget',
    );

    expect([...body.attributes.keys()]).toEqual(['name', 'note', 'template']);
    expect(attributeTokensOf(body, 'name')).toEqual([
      '"a { # b ${var.x} \\" } c"',
    ]);
    expect(body.blocks).toEqual([]);
  });

  test('値が複数行にわたる式は、括弧が閉じるまでを1つの属性にする', () => {
    const outputs = parseHcl(
      [
        'output "ids" {',
        '  value = {',
        '    d1    = module.storage.database_ids',
        '    sites = [for k, d in local.sites : d.id]',
        '  }',
        '}',
      ].join('\n'),
    );

    const [output] = blocksOf(outputs, 'output', 'ids');

    expect(attributeTokensOf(output?.body, 'value')).toContain('database_ids');
    expect(attributeTokensOf(output?.body, 'value')).toContain('id');
    expect([...(output?.body.attributes.keys() ?? [])]).toEqual(['value']);
  });

  test('値がfor式のオブジェクトなら、オブジェクトとしては読まない', () => {
    const outputs = parseHcl(
      [
        'output "names" {',
        '  value = { for k, b in cloudflare_r2_bucket.this : k => b.name }',
        '}',
      ].join('\n'),
    );

    const [output] = blocksOf(outputs, 'output', 'names');

    expect(attributeObjectOf(output?.body, 'value')).toBeUndefined();
  });

  test('無い属性・ブロックは未定義と空の一覧になる', () => {
    const body = resourceOf(
      'resource "cloudflare_queue" "this" {\n}',
      'cloudflare_queue',
    );

    expect(attributeTokensOf(body, 'lifecycle')).toBeUndefined();
    expect(attributeTokensOf(undefined, 'name')).toBeUndefined();
    expect(attributeObjectOf(body, 'read_replication')).toBeUndefined();
    expect(blocksOf(body, 'lifecycle')).toEqual([]);
  });

  test.each([
    ['閉じていないブロック', 'resource "a" "b" {\n  name = 1\n'],
    ['閉じていない文字列', 'resource "a" "b" {\n  name = "x\n}'],
    ['閉じていない補間', 'locals {\n  x = "${var.a'],
    ['閉じていないヒアドキュメント', 'locals {\n  x = <<EOT\n  y\n}'],
    ['閉じていない括弧', 'locals {\n  x = [1, 2\n}'],
    ['閉じていないコメント', 'locals {\n  /* x = 1\n}'],
    ['属性でもブロックでもない文', 'locals {\n  = 1\n}'],
    ['余分な閉じ括弧', 'locals {\n}\n}'],
  ])('%sは解析できない誤りにする', (_label, text) => {
    expect(() => parseHcl(text)).toThrow();
  });
});
