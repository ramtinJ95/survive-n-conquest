import { describe, expect, it } from 'vitest';
import { newMapAddress } from './diedOut';

describe('newMapAddress', () => {
  it('changes the seed and keeps every other setting of the page', () => {
    expect(newMapAddress('https://example.test/game/?seed=7&swarm=off&food=400', 123)).toBe('https://example.test/game/?seed=123&swarm=off&food=400');
    expect(newMapAddress('https://example.test/', 9)).toBe('https://example.test/?seed=9');
  });
});
