import { describe, expect, it } from 'vitest';
import { createUuid } from './uuid.js';

describe('createUuid', () => {
  it('uses randomUUID when the browser supports it', () => {
    const randomUUID = () => 'supported-uuid';

    expect(
      createUuid({
        randomUUID,
        getRandomValues: () => {
          throw new Error('fallback should not run');
        },
      }),
    ).toBe('supported-uuid');
  });

  it('creates an RFC 4122 version 4 UUID with getRandomValues when randomUUID is unavailable', () => {
    const uuid = createUuid({
      getRandomValues: (values) => {
        values.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return values;
      },
    });

    expect(uuid).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
