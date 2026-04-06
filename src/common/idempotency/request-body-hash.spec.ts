import { requestBodySha256Hex, stableStringify } from './request-body-hash';

describe('requestBodyHash', () => {
  it('stableStringify orders object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('requestBodySha256Hex is stable for key order', () => {
    const h1 = requestBodySha256Hex({ name: 'X', initialStock: { quantity: '1' } });
    const h2 = requestBodySha256Hex({ initialStock: { quantity: '1' }, name: 'X' });
    expect(h1).toBe(h2);
  });
});
