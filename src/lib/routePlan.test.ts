import { describe, expect, it } from 'vitest';

import { routePlan } from './routePlan';

describe('routePlan', () => {
  it('keeps one shared route for inventory and order flows', () => {
    expect(routePlan.map((item) => item.path)).toEqual(
      expect.arrayContaining(['/app/inventory', '/app/order']),
    );
    expect(routePlan.find((item) => item.path === '/app/inventory')?.phase).toBeLessThan(
      routePlan.find((item) => item.path === '/app/order')?.phase ?? 0,
    );
  });

  it('adds the V2 arrival entry without replacing V1 routes', () => {
    const paths = routePlan.map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/app/inventory',
      '/app/order',
      '/app/history',
      '/app/arrivals',
      '/app/arrivals/history',
      '/app/arrivals/:reportId/success',
    ]));
  });

  it('registers the system version history page', () => {
    expect(routePlan.map((item) => item.path)).toContain('/app/account/about');
  });
});
