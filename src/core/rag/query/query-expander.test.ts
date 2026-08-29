import { describe, expect, it } from 'vitest';
import { IdentityQueryExpander } from './query-expander';

describe('IdentityQueryExpander', () => {
  it('searches with the question unchanged, at zero cost', async () => {
    const expander = new IdentityQueryExpander();

    const expansion = await expander.expand('what is the buffer size?');

    expect(expansion.searchTexts).toEqual(['what is the buffer size?']);
  });
});
