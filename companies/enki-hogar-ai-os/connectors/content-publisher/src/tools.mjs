import {z} from "zod";
import {assertWriteAllowed} from "./config.mjs";

const idempotencyKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits, dot, colon, underscore, or hyphen");
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL");
const term = z.union([z.number().int().positive(), z.string().trim().min(1).max(100)]);
const wordpressStatus = z.enum(["draft", "pending", "future", "publish"]);

function result(value) {
  return {content: [{type: "text", text: JSON.stringify(value, null, 2)}]};
}

function safeMessage(error) {
  if (error instanceof z.ZodError) {
    return `Invalid input: ${error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ")}`;
  }
  const message = error instanceof Error ? error.message : "Connector operation failed";
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]")
    .replace(/\b(?:EA[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]");
}

function failure(error) {
  return {isError: true, content: [{type: "text", text: safeMessage(error)}]};
}

function tool(name, description, schema, execute, {readOnly, idempotent = false}) {
  return {
    name,
    description,
    schema,
    annotations: {
      title: description,
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: idempotent,
      openWorldHint: true,
    },
    execute: async (input) => {
      try {
        return result(await execute(schema.parse(input)));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function readTool(name, description, schema, execute) {
  return tool(name, description, schema, execute, {readOnly: true});
}

function writeTool(name, description, schema, execute) {
  return tool(name, description, schema, execute, {readOnly: false, idempotent: true});
}

function requireClient(client, label) {
  if (!client) throw new Error(`${label} is not configured`);
  return client;
}

export function createToolDefinitions({config, wordpress, meta, ledger}) {
  return [
    readTool(
      "publisher_get_capabilities",
      "Report configured publication providers and the connector kill-switch mode without exposing credentials or account IDs.",
      z.object({}),
      async () => ({
        write_mode: config.writeMode,
        providers: {
          wordpress: {configured: Boolean(config.wordpress)},
          facebook: {configured: Boolean(config.meta?.facebookPageId)},
          instagram: {configured: Boolean(config.meta?.instagramUserId)},
        },
      }),
    ),
    readTool(
      "wordpress_list_posts",
      "List a bounded WordPress post index for editorial memory; returns no users, credentials, comments, or customer data.",
      z.object({
        status: z.enum(["publish", "future", "draft", "pending", "private"]).default("publish"),
        page: z.number().int().min(1).max(100).default(1),
        per_page: z.number().int().min(1).max(100).default(20),
      }),
      async (input) => requireClient(wordpress, "WordPress").listPosts({status: input.status, page: input.page, perPage: input.per_page}),
    ),
    readTool(
      "wordpress_get_article",
      "Read one WordPress blog article and its rendered content by numeric post ID for comparison or review.",
      z.object({post_id: z.number().int().positive()}),
      async ({post_id}) => requireClient(wordpress, "WordPress").getPost(post_id),
    ),
    writeTool(
      "wordpress_upsert_post",
      "Create or update one WordPress post by ID or stable slug. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        post_id: z.number().int().positive().optional(),
        title: z.string().trim().min(1).max(300),
        slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        excerpt: z.string().max(2_000).default(""),
        content_html: z.string().min(1).max(500_000),
        status: wordpressStatus.default("draft"),
        date: z.string().datetime({offset: true}).optional(),
        categories: z.array(term).max(30).default([]),
        tags: z.array(term).max(50).default([]),
        create_missing_terms: z.boolean().default(false),
        featured_media: z.number().int().positive().optional(),
        seo_description: z.string().trim().max(500).optional(),
      }).superRefine((input, context) => {
        if (input.status === "future" && !input.date) context.addIssue({code: "custom", path: ["date"], message: "Scheduled posts require an explicit offset-aware date"});
        if (input.status !== "future" && input.date) context.addIssue({code: "custom", path: ["date"], message: "date is accepted only for status future"});
      }),
      async (input) => {
        assertWriteAllowed(config, "wordpress", input.status);
        const client = requireClient(wordpress, "WordPress");
        return ledger.execute({
          provider: "wordpress",
          operation: "upsert_post",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.upsertPost(input));
      },
    ),
    readTool(
      "facebook_list_page_posts",
      "List bounded posts published by the configured Facebook Page for editorial memory.",
      z.object({limit: z.number().int().min(1).max(100).default(20)}),
      async (input) => requireClient(meta, "Meta").listFacebookPosts(input),
    ),
    writeTool(
      "facebook_publish_page_post",
      "Publish one text/link post to the configured Facebook Page. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        message: z.string().trim().min(1).max(63_206),
        link: httpsUrl.optional(),
      }),
      async (input) => {
        assertWriteAllowed(config, "facebook");
        const client = requireClient(meta, "Meta");
        return ledger.execute({
          provider: "facebook",
          operation: "publish_page_post",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.publishFacebookPost(input));
      },
    ),
    readTool(
      "instagram_list_media",
      "List bounded media published by the configured Instagram professional account for editorial memory.",
      z.object({limit: z.number().int().min(1).max(100).default(20)}),
      async (input) => requireClient(meta, "Meta").listInstagramMedia(input),
    ),
    readTool(
      "instagram_get_publishing_limit",
      "Read current Instagram API publishing quota usage without publishing content.",
      z.object({}),
      async () => requireClient(meta, "Meta").instagramPublishingLimit(),
    ),
    writeTool(
      "instagram_publish_image",
      "Publish one JPEG image from a public HTTPS URL to the configured Instagram professional account. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        image_url: httpsUrl,
        caption: z.string().trim().min(1).max(2_200),
        alt_text: z.string().trim().min(1).max(1_000),
      }),
      async (input) => {
        assertWriteAllowed(config, "instagram");
        const client = requireClient(meta, "Meta");
        return ledger.execute({
          provider: "instagram",
          operation: "publish_image",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.publishInstagramImage(input));
      },
    ),
  ];
}
