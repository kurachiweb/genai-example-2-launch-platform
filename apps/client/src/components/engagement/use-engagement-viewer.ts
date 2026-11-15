import { useViewer } from '../auth/use-viewer.ts';
import {
  engagementViewerKind,
  type EngagementViewerKind,
} from './engagement-viewer.ts';

export function useEngagementViewer(context: {
  readonly viewer: { readonly isOwner: boolean };
}): { readonly kind: EngagementViewerKind; readonly viewerId: string | null } {
  const viewer = useViewer();
  return {
    kind: engagementViewerKind(viewer, context.viewer.isOwner),
    viewerId: viewer?.id ?? null,
  };
}
