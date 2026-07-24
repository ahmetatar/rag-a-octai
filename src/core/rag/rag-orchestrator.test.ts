import { describe, expect, it } from 'vitest';
import { RagOrchestrator } from './rag-orchestrator';
import { BaseEmbedding } from './embedding';
import { LangModelBase, PromptContext } from './llm';
import { SearchResult } from './vector-store';

class StubEmbedding extends BaseEmbedding {
  async embed(): Promise<number[][]> {
    return [[0.1, 0.2]];
  }
}

/** Records the prompt it was given so tests can assert what the model actually received. */
class RecordingLangModel extends LangModelBase {
  lastPrompt?: PromptContext;

  async generateResponse(promptCtx: PromptContext): Promise<string> {
    this.lastPrompt = promptCtx;
    return this.buildContext(promptCtx) ? 'answer from context' : 'I cannot answer that';
  }
}

const CLOSE_MATCH: SearchResult = {
  id: 'chunk-close',
  content: 'The capital of France is Paris.',
  metadata: { source: 'france.pdf', page: 3 },
  distance: 0.12,
  score: 0.88,
};

const DISTANT_MATCH: SearchResult = {
  id: 'chunk-distant',
  content: 'Unrelated text about gardening.',
  metadata: { source: 'other.txt' },
  distance: 0.85,
  score: 0.15,
};

/**
 * Builds an orchestrator over a stubbed store.
 * @param results The search results the store returns.
 */
function orchestratorOver(results: SearchResult[]) {
  const langModel = new RecordingLangModel();
  const store = { search: async () => results } as never;

  return { langModel, orchestrator: new RagOrchestrator(langModel, new StubEmbedding(), store) };
}

describe('RagOrchestrator.query', () => {
  it('keeps the results at or above the similarity threshold and drops the rest', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('capital of France?', 3, 0.45);

    expect(answer.sources.map((source) => source.id)).toEqual(['chunk-close']);
    expect(langModel.lastPrompt?.sources).toHaveLength(1);
  });

  it('returns the retrieved chunks as citations', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH]);

    const [source] = (await orchestrator.query('capital of France?', 3, 0.45)).sources;

    expect(source).toEqual({
      id: 'chunk-close',
      source: 'france.pdf',
      page: 3,
      score: 0.88,
      excerpt: 'The capital of France is Paris.',
    });
  });

  it('truncates the excerpt so a whole chunk is never echoed back', async () => {
    const { orchestrator } = orchestratorOver([{ ...CLOSE_MATCH, content: 'x'.repeat(1000) }]);

    const [source] = (await orchestrator.query('question?', 3, 0.45)).sources;

    expect(source.excerpt).toHaveLength(240);
  });

  it('omits metadata fields that the document does not carry', async () => {
    const { orchestrator } = orchestratorOver([DISTANT_MATCH]);

    const [source] = (await orchestrator.query('question?', 3, 0)).sources;

    expect(source.source).toBe('other.txt');
    expect(source.page).toBeUndefined();
  });

  it('still answers when nothing clears the threshold, without any sources', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('unrelated question?', 3, 0.99);

    expect(answer.sources).toEqual([]);
    expect(answer.response).toBe('I cannot answer that');
    expect(langModel.lastPrompt?.sources).toEqual([]);
  });

  it('treats a missing threshold as "keep everything"', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('question?', 3);

    expect(answer.sources).toHaveLength(2);
  });

  it('passes the token limit through to the language model', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH]);

    await orchestrator.query('question?', 3, 0.45, 128);

    expect(langModel.lastPrompt?.maxTokens).toBe(128);
  });
});
