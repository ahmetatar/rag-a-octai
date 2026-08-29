import config from '@app/config';
import { HydeQueryExpander } from './hyde-query-expander';
import { MultiQueryExpander } from './multi-query-expander';
import { IdentityQueryExpander, QueryExpander } from './query-expander';
import { QueryRewriteExpander } from './query-rewrite-expander';

/** The query-expansion strategies `QUERY_STRATEGY` may select. */
export const QUERY_STRATEGIES = ['none', 'rewrite', 'multi-query', 'hyde'] as const;
export type QueryStrategy = (typeof QUERY_STRATEGIES)[number];

/**
 * Builds the configured {@link QueryExpander}. All strategies but `none` cost an extra LLM
 * call per query on top of retrieval and generation — see `docs/rag-improvements-task-list.md`
 * for the measured latency/quality trade-off of each before turning one on.
 * @returns The expander for `config.queryStrategy`.
 */
export function createQueryExpander(): QueryExpander {
  switch (config.queryStrategy) {
    case 'rewrite':
      return new QueryRewriteExpander(config.generationModel, config.ollamaHost);
    case 'multi-query':
      return new MultiQueryExpander(config.generationModel, config.ollamaHost);
    case 'hyde':
      return new HydeQueryExpander(config.generationModel, config.ollamaHost);
    case 'none':
    default:
      return new IdentityQueryExpander();
  }
}
