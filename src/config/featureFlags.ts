const enabledByDefault = (value: string | undefined) => value?.trim().toLowerCase() !== 'false';

export const parseFeatureFlag = enabledByDefault;

export const featureFlags = {
  arrivalEntry: enabledByDefault(import.meta.env.VITE_ENABLE_V2_ARRIVAL_ENTRY),
  taskTemplates: enabledByDefault(import.meta.env.VITE_ENABLE_V2_TASK_TEMPLATES),
  noticesAndSops: enabledByDefault(import.meta.env.VITE_ENABLE_V2_NOTICES_AND_SOPS),
} as const;
