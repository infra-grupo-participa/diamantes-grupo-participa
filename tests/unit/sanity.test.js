/**
 * Smoke test — apenas garante que o harness Vitest está funcional.
 *
 * Vai crescer na Fase 4, quando portal-insights.js e portal-auth.js
 * forem modularizados e puderem ser importados e testados unitariamente.
 */
import { describe, it, expect } from 'vitest';

describe('Sanity', () => {
  it('Vitest está funcionando', () => {
    expect(true).toBe(true);
  });
});
