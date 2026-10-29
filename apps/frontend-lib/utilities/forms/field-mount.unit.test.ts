import { describe, expect, test } from 'bun:test';
import { createFormControl } from 'react-hook-form';

import { mountStateOf } from './field-mount.ts';

interface ProductForm {
  title: string;
  tagline: string;
  maker: { name: string };
  links: { url: string }[];
  note: string;
}

const REGISTERED_FIELDS = [
  'title',
  'tagline',
  'maker.name',
  'links.0.url',
] as const;

const createControl = () => {
  const { control } = createFormControl<ProductForm>({
    defaultValues: {
      title: '',
      tagline: '',
      maker: { name: '' },
      links: [{ url: '' }],
      note: '',
    },
  });
  for (const name of REGISTERED_FIELDS) {
    control.register(name).ref({ name, value: '', focus: () => undefined });
  }
  return control;
};

describe('mountStateOf', () => {
  test('描かれている欄は真を返し、入れ子と一覧の中の欄も経路で判定する', () => {
    const control = createControl();

    expect(mountStateOf(control._fields, 'title')).toBe(true);
    expect(mountStateOf(control._fields, 'maker.name')).toBe(true);
    expect(mountStateOf(control._fields, 'links.0.url')).toBe(true);
  });

  test('描かれなくなった欄は、名前が登録に残っていても偽を返す', () => {
    const control = createControl();

    control.register('tagline').ref(null);

    expect(control._names.mount.has('tagline')).toBe(true);
    expect(mountStateOf(control._fields, 'tagline')).toBe(false);
  });

  test('登録の無い値・欄をまとめた親・一覧の経路はundefinedを返す', () => {
    const control = createControl();

    expect(mountStateOf(control._fields, 'note')).toBeUndefined();
    expect(mountStateOf(control._fields, 'maker')).toBeUndefined();
    expect(mountStateOf(control._fields, 'links')).toBeUndefined();
    expect(mountStateOf(control._fields, 'price')).toBeUndefined();
  });
});
