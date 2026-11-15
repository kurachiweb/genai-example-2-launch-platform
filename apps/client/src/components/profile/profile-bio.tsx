import { CollapsibleMarkdownContent } from '../../../lib/components/markdown/collapsible-markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { PROFILE_BIO_HEADING } from './profile-messages.ts';

export interface ProfileBioProps {
  readonly markdown: string;
}

const BIO_COLLAPSED_HEIGHT_PX = 240;

export function ProfileBio({ markdown }: ProfileBioProps) {
  const options = useMarkdownOptions({
    externalLinkRel: ['noopener', 'ugc'],
    sameOriginLinkRel: ['ugc'],
    idScope: 'bio',
  });
  const rendered = useRenderedMarkdown(markdown, options);

  return (
    <>
      <h2 className="sr-only">{PROFILE_BIO_HEADING}</h2>
      <CollapsibleMarkdownContent
        rendered={rendered}
        size="sm"
        collapsedHeight={BIO_COLLAPSED_HEIGHT_PX}
        fadeClassName="from-card"
      />
    </>
  );
}
