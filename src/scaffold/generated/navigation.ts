import type { WorkbenchNavigationGroup } from '../../workbench-core/index.js';
import { generatedAIStudioModules } from './capability-registry.js';
import { translateGeneratedMessage } from './i18n.js';

export const generatedNavigationGroups: readonly WorkbenchNavigationGroup<string>[] = Object.freeze([
  ...generatedAIStudioModules.map((module) => ({
    id: module.id,
    items: module.capabilities.map((registration) => ({
      id: registration.descriptor.id,
      label: translateGeneratedMessage(registration.descriptor.labelKey),
      icon: registration.icon,
    })),
  })),
]);
export const generatedInitialViewId = generatedNavigationGroups[0]?.items[0]?.id ?? null;
export const hasGeneratedViews = generatedInitialViewId !== null;
export function isGeneratedViewId(viewId: string): boolean {
  return generatedNavigationGroups.some((group) => group.items.some((item) => item.id === viewId));
}
export function generatedViewLabel(viewId: string): string {
  for (const group of generatedNavigationGroups) {
    const item = group.items.find((candidate) => candidate.id === viewId);
    if (item) return item.label;
  }
  return viewId;
}
