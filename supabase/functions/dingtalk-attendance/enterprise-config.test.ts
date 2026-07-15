import { describe, expect, it } from 'vitest';

import { loadDingTalkEnterpriseConfigs } from './enterprise-config.ts';

describe('DingTalk enterprise configuration', () => {
it('loads multiple DingTalk enterprises from one protected JSON secret', () => {
  const values: Record<string, string> = {
    DINGTALK_ENTERPRISE_CONFIGS: JSON.stringify([
      { corpId: 'corp-a', appKey: 'key-a', appSecret: 'secret-a', displayName: '企业 A', rootDepartmentIds: ['1', '2'] },
      { corpId: 'corp-b', appKey: 'key-b', appSecret: 'secret-b', displayName: '企业 B', timezone: 'Asia/Shanghai' },
    ]),
  };
  const configs = loadDingTalkEnterpriseConfigs((key) => values[key]);
  expect(configs.map((item) => item.corpId)).toEqual(['corp-a', 'corp-b']);
  expect(configs[1].rootDepartmentIds).toEqual(['1']);
});

it('keeps legacy single-enterprise secrets compatible', () => {
  const values: Record<string, string> = { DINGTALK_CORP_ID: 'corp', DINGTALK_APP_KEY: 'key', DINGTALK_APP_SECRET: 'secret' };
  expect(loadDingTalkEnterpriseConfigs((key) => values[key])[0].displayName).toBe('当前钉钉企业');
});

it('rejects duplicate enterprise identifiers', () => {
  const encoded = JSON.stringify([
    { corpId: 'same', appKey: 'a', appSecret: 'a', displayName: 'A' },
    { corpId: 'same', appKey: 'b', appSecret: 'b', displayName: 'B' },
  ]);
  expect(() => loadDingTalkEnterpriseConfigs((key) => key === 'DINGTALK_ENTERPRISE_CONFIGS' ? encoded : undefined)).toThrow();
});
});
