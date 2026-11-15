export interface MdastNode {
  readonly type: string;
  readonly children?: readonly MdastNode[];
}

export interface MdastParent extends MdastNode {
  readonly children: readonly MdastNode[];
}

export interface MdastRoot extends MdastParent {
  readonly type: 'root';
}

export interface MdastParagraph extends MdastParent {
  readonly type: 'paragraph';
}

export interface MdastHeading extends MdastParent {
  readonly type: 'heading';
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface MdastText extends MdastNode {
  readonly type: 'text';
  readonly value: string;
}

export interface MdastHtml extends MdastNode {
  readonly type: 'html';
  readonly value: string;
}

export interface MdastImage extends MdastNode {
  readonly type: 'image';
  readonly url: string;
  readonly alt?: string | null;
}

export interface MdastImageReference extends MdastNode {
  readonly type: 'imageReference';
  readonly identifier: string;
  readonly label?: string | null;
  readonly referenceType: 'shortcut' | 'collapsed' | 'full';
  readonly alt?: string | null;
}

export type HastPropertyValue =
  boolean | number | string | null | undefined | readonly (number | string)[];

export type HastProperties = Readonly<Record<string, HastPropertyValue>>;

export interface HastText {
  readonly type: 'text';
  readonly value: string;
}

export interface HastComment {
  readonly type: 'comment';
  readonly value: string;
}

// mdastからhastへの変換が型の上で生じ得る節点。Raw HTMLを文字列にしてから変換するため、実際には現れない
export interface HastRaw {
  readonly type: 'raw';
  readonly value: string;
}

export interface HastDoctype {
  readonly type: 'doctype';
}

export interface HastElement {
  readonly type: 'element';
  readonly tagName: string;
  readonly properties: HastProperties;
  readonly children: readonly HastElementContent[];
}

export type HastElementContent = HastComment | HastElement | HastRaw | HastText;

export interface HastRoot {
  readonly type: 'root';
  readonly children: readonly (HastDoctype | HastElementContent)[];
}
