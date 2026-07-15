export interface DingTalkEnterpriseConfig {
  appKey: string;
  appSecret: string;
  corpId: string;
  displayName: string;
  rootDepartmentIds: string[];
  timezone: string;
}

type EnvironmentReader = (key: string) => string | undefined;

const requiredText = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
};

const roots = (value: unknown, fallback = '1') => {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : fallback.split(',');
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
};

export const loadDingTalkEnterpriseConfigs = (read: EnvironmentReader): DingTalkEnterpriseConfig[] => {
  const multi = read('DINGTALK_ENTERPRISE_CONFIGS')?.trim();
  if (multi) {
    const decoded = JSON.parse(multi) as unknown;
    if (!Array.isArray(decoded) || decoded.length === 0) throw new Error('DINGTALK_ENTERPRISE_CONFIGS must be a non-empty JSON array');
    const configs = decoded.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`enterprise config ${index + 1} is invalid`);
      const row = entry as Record<string, unknown>;
      return {
        corpId: requiredText(row.corpId, `enterprise config ${index + 1} corpId`),
        appKey: requiredText(row.appKey, `enterprise config ${index + 1} appKey`),
        appSecret: requiredText(row.appSecret, `enterprise config ${index + 1} appSecret`),
        displayName: requiredText(row.displayName, `enterprise config ${index + 1} displayName`),
        rootDepartmentIds: roots(row.rootDepartmentIds),
        timezone: typeof row.timezone === 'string' && row.timezone.trim() ? row.timezone.trim() : 'Asia/Shanghai',
      };
    });
    if (new Set(configs.map((config) => config.corpId)).size !== configs.length) throw new Error('DingTalk enterprise corpId must be unique');
    return configs;
  }

  return [{
    corpId: requiredText(read('DINGTALK_CORP_ID'), 'DINGTALK_CORP_ID'),
    appKey: requiredText(read('DINGTALK_APP_KEY'), 'DINGTALK_APP_KEY'),
    appSecret: requiredText(read('DINGTALK_APP_SECRET'), 'DINGTALK_APP_SECRET'),
    displayName: read('DINGTALK_ENTERPRISE_NAME')?.trim() || '当前钉钉企业',
    rootDepartmentIds: roots(read('DINGTALK_ROOT_DEPARTMENT_IDS')),
    timezone: read('DINGTALK_ENTERPRISE_TIMEZONE')?.trim() || 'Asia/Shanghai',
  }];
};
