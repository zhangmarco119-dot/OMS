import { describe, expect, it } from 'vitest';

import { moveSopStep, normalizeSopSteps } from './sopSteps';

const step = (id: string, sortOrder: number) => ({ id, sortOrder, stepText: `${id}说明` });

describe('SOP step ordering', () => {
  it('closes numbering gaps after a middle step is deleted', () => {
    expect(normalizeSopSteps([step('first', 0), step('third', 2)])).toEqual([
      step('first', 0),
      step('third', 1),
    ]);
  });

  it('moves a step into the selected position and renumbers every step', () => {
    expect(moveSopStep([step('first', 0), step('second', 1), step('third', 2)], 'third', 1))
      .toEqual([step('first', 0), step('third', 1), step('second', 2)]);
  });
});
