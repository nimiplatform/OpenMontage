import { useEffect, useRef, type ReactNode } from 'react';
import { generatedViewLabel } from './navigation.js';
import { generatedAIStudioRegistrations } from './capability-registry.js';
import { GeneratedAIStudioHost, GeneratedAIStudioRoute } from './host-adapters.js';

export function GeneratedModuleHost({
  onSelectView,
  children,
}: {
  readonly onSelectView: (viewId: string) => void;
  readonly children: ReactNode;
}) {
  return <GeneratedAIStudioHost onSelectCapability={onSelectView}>{children}</GeneratedAIStudioHost>;
}

export function GeneratedRouteRegistry({
  activeViewId,
  onSelectView,
}: {
  readonly activeViewId: string;
  readonly onSelectView: (viewId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.focus(); }, [activeViewId]);
  let content: ReactNode = null;
  if (generatedAIStudioRegistrations.some((registration) => registration.descriptor.id === activeViewId)) {
    content = <GeneratedAIStudioRoute capabilityId={activeViewId} />;
  }
  if (!content) return null;
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label={generatedViewLabel(activeViewId)}
      data-generated-view-id={activeViewId}
      className="h-full min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nimi-focus-ring-color)]"
    >
      {content}
    </div>
  );
}
