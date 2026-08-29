import { Ollama } from 'ollama';
import { logger } from '@infrastructure/logging';
import { resilientCall } from '../resilient-call';
import { QueryExpander, QueryExpansion } from './query-expander';

/**
 * Rewrites the question into a single, cleaner search query — expanding abbreviations,
 * dropping conversational filler ("hey, can you tell me…"), and restating it as the kind of
 * declarative phrase a document chunk (not a chat message) would contain.
 *
 * One rewrite, not several: this is the cheap end of query expansion — a single extra LLM
 * call versus {@link MultiQueryExpander}'s several. It helps most on a poorly-phrased or
 * chatty question; a question that is already a clean, specific search phrase gets rewritten
 * to something very close to itself.
 */
export class QueryRewriteExpander extends QueryExpander {
  private readonly ollama: Ollama;

  constructor(private readonly model: string, host: string) {
    super();
    this.ollama = new Ollama({ host });
  }

  /** @inheritdoc */
  async expand(question: string): Promise<QueryExpansion> {
    try {
      const response = await resilientCall('ollama.queryRewrite', () =>
        this.ollama.chat({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'Rewrite the user\'s question as a single, clear search query for a document ' +
                'index: expand abbreviations, drop conversational filler, and keep every ' +
                'specific term from the original question. Output ONLY the rewritten query, ' +
                'nothing else.',
            },
            { role: 'user', content: question },
          ],
        })
      );

      const rewritten = response.message.content.trim();
      return rewritten ? { searchTexts: [rewritten] } : { searchTexts: [question] };
    } catch (error) {
      logger.warn(`Query rewrite failed, falling back to the raw query: ${error instanceof Error ? error.message : error}`);
      return { searchTexts: [question] };
    }
  }
}
