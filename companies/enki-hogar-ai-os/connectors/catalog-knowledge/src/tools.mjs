import {z} from "zod";

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const entityRef = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/).max(420);
const topic = z.enum(["installation", "maintenance", "warranty", "faq", "material", "compatibility", "configuration", "care", "inclusion", "exclusion"]);

const AUTHORITY = Object.freeze({
  technical_source: "active-approved-support-pack",
  commercial_source: "woocommerce-live",
  commercial_fields_included: false,
  rebuildable_projection: true,
});

function result(value) {
  return {content: [{type: "text", text: JSON.stringify({schema: "enki-product-support-result/v1", as_of: new Date().toISOString(), authority: AUTHORITY, data: value}, null, 2)}]};
}

function failure(error) {
  return {isError: true, content: [{type: "text", text: error instanceof Error ? error.message : String(error)}]};
}

function readTool(name, description, schema, execute) {
  return {
    name,
    description,
    schema,
    annotations: {title: description, readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true},
    execute: async (input) => {
      try { return result(await execute(schema.parse(input))); } catch (error) { return failure(error); }
    },
  };
}

const resolutionSchema = z.object({
  woo_sku: z.string().trim().min(1).max(160).optional(),
  manufacturer_ref: z.string().trim().min(1).max(160).optional(),
  query: z.string().trim().min(2).max(200).optional(),
  brand: slug.optional(),
  domain: slug.optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).refine((value) => [value.woo_sku, value.manufacturer_ref, value.query].filter(Boolean).length === 1, "Provide exactly one of woo_sku, manufacturer_ref or query");

export function createToolDefinitions(repository) {
  return [
    readTool(
      "knowledge_resolve_product",
      "Resolve a live Woo SKU, manufacturer reference or technical name to approved technical entities; returns no current price or stock.",
      resolutionSchema,
      (input) => repository.resolveProduct(input),
    ),
    readTool(
      "knowledge_get_technical_profile",
      "Get stable approved technical facts and the identity crosswalk for one exact technical entity.",
      z.object({entity_ref: entityRef}),
      (input) => repository.getTechnicalProfile(input),
    ),
    readTool(
      "knowledge_check_compatibility",
      "Check only explicit approved structured compatibility or exclusion relations; never infer compatibility from semantic text.",
      z.object({left_entity_ref: entityRef, right_entity_ref: entityRef}),
      (input) => repository.checkCompatibility(input),
    ),
    readTool(
      "knowledge_list_allowed_options",
      "List approved configuration axes, representations, conditions and allowed values for one technical entity.",
      z.object({entity_ref: entityRef, axis: z.string().trim().min(1).max(160).optional()}),
      (input) => repository.listAllowedOptions(input),
    ),
    readTool(
      "knowledge_get_configuration_model",
      "Return the approved variation, configurator, component and assisted-sale model without expanding a Cartesian product.",
      z.object({entity_ref: entityRef}),
      (input) => repository.getConfigurationModel(input),
    ),
    readTool(
      "knowledge_search_support",
      "Search approved installation, care, warranty and FAQ support text; search results are not compatibility authority.",
      z.object({
        query: z.string().trim().min(2).max(500),
        brand: slug.optional(),
        domain: slug.optional(),
        topic: topic.optional(),
        entity_ref: entityRef.optional(),
        limit: z.number().int().min(1).max(25).default(8),
      }),
      (input) => repository.searchSupport(input),
    ),
    readTool(
      "knowledge_get_evidence",
      "Resolve an exact evidence reference to its approved source and structured technical claims.",
      z.object({evidence_ref: z.string().trim().min(1).max(300), brand: slug.optional(), domain: slug.optional()}),
      (input) => repository.getEvidence(input),
    ),
    readTool(
      "knowledge_coverage",
      "Summarize technical-support coverage by brand, domain and technical category; this is not live Woo catalogue coverage.",
      z.object({}),
      () => repository.coverage(),
    ),
  ];
}
