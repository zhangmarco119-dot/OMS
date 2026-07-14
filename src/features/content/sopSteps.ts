export interface OrderedSopStep {
  id: string;
  sortOrder: number;
  stepText: string;
}

export const normalizeSopSteps = <T extends OrderedSopStep>(steps: T[]): T[] => [...steps]
  .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
  .map((step, index) => ({ ...step, sortOrder: index }));

export const moveSopStep = <T extends OrderedSopStep>(steps: T[], stepId: string, targetIndex: number): T[] => {
  const ordered = normalizeSopSteps(steps);
  const currentIndex = ordered.findIndex((step) => step.id === stepId);
  if (currentIndex < 0) return ordered;
  const [step] = ordered.splice(currentIndex, 1);
  ordered.splice(Math.max(0, Math.min(targetIndex, ordered.length)), 0, step);
  return ordered.map((entry, index) => ({ ...entry, sortOrder: index }));
};
