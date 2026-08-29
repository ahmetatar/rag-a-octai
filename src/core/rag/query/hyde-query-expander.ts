import { Ollama } from 'ollama';
import { logger } from '@infrastructure/logging';
import { resilientCall } from '../resilient-call';
import { QueryExpander, QueryExpansion } from './query-expander';

/**
 * HyDE — Hypothetical Document Embeddings. Instead of embedding the question, this asks the
 * model to WRITE a short, plausible-sounding passage that would answer it, and embeds that
 * passage instead.
 *
 * The idea: a question and its answer are different kinds of text (a question asks, a chunk
 * states), so a question's embedding sits in a different part of the embedding space than the
 * chunk that answers it — cosine similarity between them is a weaker signal than between two
 * pieces of declarative prose. A fabricated-but-plausible passage in the answer's register
 * closes that gap, even though (especially though) its actual facts may be wrong — retrieval
 * only needs it to be topically and stylistically close to a real answer, not correct.
 *
 * The original question is deliberately NOT included alongside the hypothetical passage
 * (unlike {@link MultiQueryExpander}): HyDE's entire premise is that the question itself is
 * the wrong shape to embed, so keeping it in the search set undermines the technique being
 * measured. A failed generation still falls back to the raw question, because failing the
 * whole query over a broken expansion would be worse than plain retrieval.
 */
export class HydeQueryExpander extends QueryExpander {
  private readonly ollama: Ollama;

  constructor(private readonly model: string, host: string) {
    super();
    this.ollama = new Ollama({ host });
  }

  /** @inheritdoc */
  async expand(question: string): Promise<QueryExpansion> {
    try {
      const response = await resilientCall('ollama.hyde', () =>
        this.ollama.chat({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'Write a short passage (2-4 sentences) that would plausibly answer the ' +
                "user's question, in the style of an excerpt from a real document — specific, " +
                'declarative, no hedging, no meta-commentary. Invent plausible specific ' +
                'details if you do not actually know the answer; the passage does not need to ' +
                'be factually correct, only realistic in style and content. Output ONLY the ' +
                'passage, nothing else.',
            },
            { role: 'user', content: question },
          ],
        })
      );

      const passage = response.message.content.trim();
      return passage ? { searchTexts: [passage] } : { searchTexts: [question] };
    } catch (error) {
      logger.warn(`HyDE expansion failed, falling back to the raw query: ${error instanceof Error ? error.message : error}`);
      return { searchTexts: [question] };
    }
  }
}
