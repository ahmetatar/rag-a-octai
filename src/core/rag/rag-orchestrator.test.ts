import { describe, expect, it } from 'vitest';
import config from '@app/config';
import { RagOrchestrator } from './rag-orchestrator';
import { BaseEmbedding } from './embedding';
import { ABSTENTION_MESSAGE, LangModelBase, NO_ANSWER_SENTINEL, PromptContext } from './llm';
import { Reranker } from './reranking';
import { SearchResult } from './vector-store';

class StubEmbedding extends BaseEmbedding {
  async embed(): Promise<number[][]> {
    return [[0.1, 0.2]];
  }
}

/**
 * Records the prompt it was given so tests can assert what the model actually received.
 * Mirrors the real contract: with no context it emits the abstention sentinel. `scripted`
 * overrides the reply so a test can stage an abstention despite context being present.
 */
class RecordingLangModel extends LangModelBase {
  lastPrompt?: PromptContext;
  scripted?: string;

  async generateResponse(promptCtx: PromptContext): Promise<string> {
    this.lastPrompt = promptCtx;
    if (this.scripted !== undefined) {
      return this.scripted;
    }
    return this.buildContext(promptCtx) ? 'answer from context' : NO_ANSWER_SENTINEL;
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
 * Builds an orchestrator over a stubbed store, optionally with a reranker.
 * @param results The search results the store returns.
 * @param reranker Optional reranker to install.
 */
function orchestratorOver(results: SearchResult[], reranker?: Reranker) {
  const langModel = new RecordingLangModel();
  const searchCalls: { topK: number; tenantId?: string }[] = [];
  const store = {
    search: async (_vector: number[], topK: number, tenantId?: string) => {
      searchCalls.push({ topK, tenantId });
      return results;
    },
  } as never;

  return {
    langModel,
    searchCalls,
    orchestrator: new RagOrchestrator(langModel, new StubEmbedding(), store, reranker),
  };
}

/** A reranker that scores documents by a lookup on their content. */
class ScriptedReranker extends Reranker {
  constructor(private readonly scoreByContent: Record<string, number>) {
    super();
  }
  async rank(_query: string, documents: string[]): Promise<number[]> {
    return documents.map((document) => this.scoreByContent[document] ?? 0);
  }
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

  it('abstains when nothing clears the threshold, without any sources', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('unrelated question?', 3, 0.99);

    expect(answer.sources).toEqual([]);
    expect(answer.abstained).toBe(true);
    expect(answer.response).toBe(ABSTENTION_MESSAGE);
    expect(langModel.lastPrompt?.sources).toEqual([]);
  });

  // Retrieval finding chunks does not mean they answer the question. When the model says
  // they do not, the result must not look like a sourced answer.
  it('reports an abstention and drops the sources even when chunks were retrieved', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH]);
    langModel.scripted = NO_ANSWER_SENTINEL;

    const answer = await orchestrator.query('question the chunks do not cover?', 3, 0.5);

    expect(answer.abstained).toBe(true);
    expect(answer.sources).toEqual([]);
    expect(answer.response).toBe(ABSTENTION_MESSAGE);
    // The model was still given the chunks; it judged them insufficient.
    expect(langModel.lastPrompt?.sources).toHaveLength(1);
  });

  it('never leaks the internal sentinel to a caller', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH]);
    langModel.scripted = '**NO_ANSWER**';

    const answer = await orchestrator.query('question?', 3, 0.5);

    expect(answer.response).not.toContain(NO_ANSWER_SENTINEL);
  });

  it('marks a real answer as not abstained and keeps its sources', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH]);

    const answer = await orchestrator.query('question?', 3, 0.5);

    expect(answer.abstained).toBe(false);
    expect(answer.sources).toHaveLength(1);
  });

  // Without a reranker the scores are cosine similarities, so an omitted threshold has to
  // fall back to the cosine default rather than to some other stage's number.
  it('falls back to the cosine threshold when none is given', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('question?', 3);

    expect(answer.scoreScale).toBe('cosine');
    expect(answer.threshold).toBe(config.retrievalThreshold);
    // CLOSE_MATCH scores 0.88 and DISTANT_MATCH 0.15, so only the close one can survive any
    // sensible cosine default.
    expect(answer.sources.map((source) => source.id)).toEqual(['chunk-close']);
  });

  it('lets an explicit threshold override the configured default', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH]);

    const answer = await orchestrator.query('question?', 3, 0);

    expect(answer.threshold).toBe(0);
    expect(answer.sources).toHaveLength(2);
  });

  it('passes the token limit through to the language model', async () => {
    const { orchestrator, langModel } = orchestratorOver([CLOSE_MATCH]);

    await orchestrator.query('question?', 3, 0.45, 128);

    expect(langModel.lastPrompt?.maxTokens).toBe(128);
  });

  it('restricts the search to the requesting tenant', async () => {
    const { orchestrator, searchCalls } = orchestratorOver([CLOSE_MATCH]);

    await orchestrator.query('question?', 3, 0.45, 128, 'acme');

    expect(searchCalls[0].tenantId).toBe('acme');
  });

  it('does not filter by tenant when none is given', async () => {
    const { orchestrator, searchCalls } = orchestratorOver([CLOSE_MATCH]);

    await orchestrator.query('question?', 3, 0.45);

    expect(searchCalls[0].tenantId).toBeUndefined();
  });
});

describe('RagOrchestrator.query — reranking', () => {
  it('reorders candidates by reranker score, overriding vector order', async () => {
    // Vector search ranks CLOSE_MATCH first (0.88 > 0.15), but the reranker judges the
    // "distant" one more relevant; after reranking it should come first.
    const reranker = new ScriptedReranker({
      [CLOSE_MATCH.content]: 0.2,
      [DISTANT_MATCH.content]: 0.9,
    });
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH], reranker);

    const answer = await orchestrator.query('question?', 2, 0);

    expect(answer.sources.map((source) => source.id)).toEqual(['chunk-distant', 'chunk-close']);
    expect(answer.sources[0].score).toBeCloseTo(0.9);
  });

  it('widens the candidate fetch when a reranker is present', async () => {
    const { orchestrator, searchCalls } = orchestratorOver([CLOSE_MATCH], new ScriptedReranker({}));

    await orchestrator.query('question?', 3, 0);

    // config.rerankFetchK defaults to 20, so a topK of 3 fetches 20 candidates to rerank.
    expect(searchCalls[0].topK).toBe(20);
  });

  it('does not widen the fetch when no reranker is present', async () => {
    const { orchestrator, searchCalls } = orchestratorOver([CLOSE_MATCH]);

    await orchestrator.query('question?', 3, 0);

    expect(searchCalls[0].topK).toBe(3);
  });

  it('applies the threshold to the reranker score', async () => {
    const reranker = new ScriptedReranker({
      [CLOSE_MATCH.content]: 0.9,
      [DISTANT_MATCH.content]: 0.2,
    });
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH], reranker);

    const answer = await orchestrator.query('question?', 5, 0.5);

    // Only the doc the reranker scored >= 0.5 survives.
    expect(answer.sources.map((source) => source.id)).toEqual(['chunk-close']);
  });

  it('falls back to vector order when the reranker throws', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH], failingReranker());

    const answer = await orchestrator.query('question?', 2, 0);

    // Vector order preserved (CLOSE_MATCH first), query still succeeds.
    expect(answer.sources.map((source) => source.id)).toEqual(['chunk-close', 'chunk-distant']);
  });
});

describe('RagOrchestrator.query — score scales', () => {
  // A cosine similarity of 0.45 and a cross-encoder score of 0.45 do not mean the same thing,
  // so each stage needs its own default. Sharing one made enabling the reranker silently
  // change how strict the filter was.
  it('uses the reranker threshold when reranking ran', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH], new ScriptedReranker({ [CLOSE_MATCH.content]: 0.5 }));

    const answer = await orchestrator.query('question?', 3);

    expect(answer.scoreScale).toBe('reranker');
    expect(answer.threshold).toBe(config.rerankThreshold);
  });

  // The critical case: the reranker is configured, so the cross-encoder threshold "should"
  // apply — but it failed, and the scores left behind are cosine ones. Filtering those by the
  // cross-encoder's number would apply the wrong units at the worst possible moment.
  it('reverts to the cosine threshold when reranking was configured but failed', async () => {
    const { orchestrator } = orchestratorOver([CLOSE_MATCH, DISTANT_MATCH], failingReranker());

    const answer = await orchestrator.query('question?', 3);

    expect(answer.scoreScale).toBe('cosine');
    expect(answer.threshold).toBe(config.retrievalThreshold);
  });

  it('reports the cosine scale when there are no candidates to rerank', async () => {
    const { orchestrator } = orchestratorOver([], new ScriptedReranker({}));

    const answer = await orchestrator.query('question?', 3);

    expect(answer.scoreScale).toBe('cosine');
  });
});

/** A reranker that always fails, for the graceful-degradation cases. */
function failingReranker(): Reranker {
  return new (class extends Reranker {
    async rank(): Promise<number[]> {
      throw new Error('reranker down');
    }
  })();
}
