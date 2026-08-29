import { Ollama } from 'ollama';
import { logger } from '@infrastructure/logging';
import { resilientCall } from '../resilient-call';
import { QueryExpander, QueryExpansion } from './query-expander';

/** How many alternate phrasings to generate, in addition to the original question. */
const DEFAULT_VARIANT_COUNT = 3;

/**
 * Generates several alternate phrasings of the question and searches with all of them (the
 * original included), so retrieval isn't at the mercy of one embedding's read of one phrasing.
 *
 * Each variant is a full vector search of its own; the orchestrator merges the result sets by
 * chunk id (keeping the best score seen for each) before reranking/thresholding, so everything
 * downstream of retrieval — reranking, the threshold, generation — sees exactly the shape of
 * candidate list it always has. The cost is upfront: one LLM call to generate the variants,
 * plus one embedding + one vector search per variant instead of one.
 */
export class MultiQueryExpander extends QueryExpander {
  private readonly ollama: Ollama;

  constructor(private readonly model: string, host: string, private readonly variantCount = DEFAULT_VARIANT_COUNT) {
    super();
    this.ollama = new Ollama({ host });
  }

  /** @inheritdoc */
  async expand(question: string): Promise<QueryExpansion> {
    try {
      const response = await resilientCall('ollama.multiQuery', () =>
        this.ollama.chat({
          model: this.model,
          format: 'json',
          messages: [
            {
              role: 'system',
              content:
                `Generate exactly ${this.variantCount} alternate phrasings of the user's question that ` +
                'would each help find the same answer in a document index — different wording, ' +
                'synonyms, or a narrower/broader angle on the same question. Do not answer the ' +
                'question. Respond with JSON only, of the exact shape ' +
                `{"queries": string[]} with exactly ${this.variantCount} items.`,
            },
            { role: 'user', content: question },
          ],
        })
      );

      const parsed = JSON.parse(response.message.content) as { queries?: unknown };
      const variants = Array.isArray(parsed.queries)
        ? parsed.queries.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];

      // The original question always leads: a malformed or unhelpful set of variants must
      // never leave the search worse off than plain retrieval, only potentially better.
      return { searchTexts: [question, ...variants] };
    } catch (error) {
      logger.warn(`Multi-query expansion failed, falling back to the raw query: ${error instanceof Error ? error.message : error}`);
      return { searchTexts: [question] };
    }
  }
}
