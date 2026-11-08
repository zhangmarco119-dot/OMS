import { appEnv } from './env';

export const publicTaskReferenceUrl = (url: string, base = appEnv.supabaseUrl) => {
  if (!base) return url;
  try {
    const parsed = new URL(url);
    const prefix = '/storage/v1/object/sign/v2-task-template-reference-images/';
    const index = parsed.pathname.indexOf(prefix);
    if (index < 0) return url;
    const publicBase = new URL(base);
    if (!['http:', 'https:'].includes(publicBase.protocol)) return url;
    return `${base.replace(/\/$/, '')}${parsed.pathname.slice(index)}${parsed.search}`;
  } catch {
    return url;
  }
};
