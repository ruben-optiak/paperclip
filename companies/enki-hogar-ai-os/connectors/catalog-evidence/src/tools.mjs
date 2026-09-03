import {z} from "zod";

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const key = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).max(420);
const field = z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(160);

const AUTHORITY = Object.freeze({
  source: "board-approved-catalogue-evidence-publication",
  approved_runs_only: true,
  raw_inputs_accessible: false,
  external_writes_blocked: true,
});

function result(value) {
  return {content: [{type: "text", text: JSON.stringify({schema: "enki-catalog-evidence-result/v1", as_of: new Date().toISOString(), authority: AUTHORITY, data: value}, null, 2)}]};
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
      try { return await execute(schema.parse(input)); } catch (error) { return failure(error); }
    },
  };
}

const searchSchema = z.object({
  brand: slug.optional(),
  series: slug.optional(),
  sku: z.string().trim().min(1).max(160).optional(),
  manufacturer_ref: z.string().trim().min(1).max(160).optional(),
  field_group: field.optional(),
  field_name: field.optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).refine((value) => Object.entries(value).some(([name, entry]) => name !== "limit" && entry !== undefined), "Provide at least one exact evidence selector");

export function createToolDefinitions(publication) {
  return [
    readTool(
      "catalogue_list_approved_runs",
      "List only Board-approved catalogue runs in the mounted publication; source inputs and working artifacts are never exposed.",
      z.object({brand: slug.optional(), limit: z.number().int().min(1).max(50).default(20)}),
      (input) => result(publication.listRuns(input)),
    ),
    readTool(
      "catalogue_search_field_evidence",
      "Find Board-approved field evidence by exact brand, series, SKU, manufacturer reference, field group or field name.",
      searchSchema,
      (input) => result(publication.searchEvidence(input)),
    ),
    readTool(
      "catalogue_get_field_evidence",
      "Get one exact approved field observation with source checksum and verifiable PDF coordinates or positional CSV location.",
      z.object({evidence_key: key}),
      (input) => result(publication.getEvidence(input.evidence_key)),
    ),
    readTool(
      "catalogue_get_evidence_crop",
      "Get an optional checksum-verified approved image crop for one evidence key; returns an error when coordinates are the published proof.",
      z.object({evidence_key: key}),
      async (input) => {
        const crop = await publication.getCrop(input.evidence_key);
        return {content: [
          {type: "text", text: JSON.stringify({schema: "enki-catalog-evidence-crop/v1", authority: AUTHORITY, evidence_key: input.evidence_key, sha256: crop.sha256})},
          {type: "image", mimeType: crop.mimeType, data: crop.data},
        ]};
      },
    ),
    readTool(
      "catalogue_evidence_coverage",
      "Summarize the approved publication by brand, series and field without exposing unapproved runs or raw input files.",
      z.object({}),
      () => result(publication.coverage()),
    ),
  ];
}
