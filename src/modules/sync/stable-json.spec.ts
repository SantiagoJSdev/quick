import { stableJsonStringify } from './stable-json';

describe('stableJsonStringify', () => {
  it('orders object keys', () => {
    expect(stableJsonStringify({ b: 1, a: 2 })).toBe(
      stableJsonStringify({ a: 2, b: 1 }),
    );
  });

  it('normalizes nested objects', () => {
    expect(
      stableJsonStringify({ x: { z: 1, y: 2 }, w: 0 }),
    ).toBe(stableJsonStringify({ w: 0, x: { y: 2, z: 1 } }));
  });
});
