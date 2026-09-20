import {
  buildConversationFilterOutputSchema,
  CONVERSATION_FILTER_FIELDS,
} from '../../src/common/shopping/conversation-filter-definition';

describe('conversation filter definition', () => {
  it('generates the model schema from the runtime field source of truth', () => {
    const schema = buildConversationFilterOutputSchema();
    const properties = schema.properties as Record<string, unknown>;
    const patch = properties.filterPatch as Record<string, unknown>;
    const patchFields = Object.keys(
      (patch.properties ?? {}) as Record<string, unknown>,
    );
    expect(patchFields.sort()).toEqual([...CONVERSATION_FILTER_FIELDS].sort());
    expect(patchFields).not.toContain('searchPipelineMode');
  });
});
