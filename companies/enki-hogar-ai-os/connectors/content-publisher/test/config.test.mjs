import assert from "node:assert/strict";
import test from "node:test";
import {assertProductWriteAllowed, assertWriteAllowed, readConfig} from "../src/config.mjs";

const base = {CONTENT_PUBLISHER_MCP_TOKEN: "test-token-that-is-long-enough-for-runtime-validation-12345"};

test("starts safely with no provider configured and writes disabled", () => {
  const config = readConfig(base);
  assert.equal(config.writeMode, "disabled");
  assert.equal(config.productWriteMode, "disabled");
  assert.equal(config.wordpress, null);
  assert.equal(config.meta, null);
  assert.throws(() => assertWriteAllowed(config, "wordpress", "draft"), /kill switch/);
  assert.throws(() => assertProductWriteAllowed(config), /kill switch/);
});

test("product drafts require an independent complete credential set and mounted bundle", () => {
  assert.throws(() => readConfig({...base, WOO_PUBLISH_BASE_URL: "https://shop.example.invalid"}), /incomplete/);
  const config = readConfig({
    ...base,
    PRODUCT_PUBLISH_WRITE_MODE: "woo-drafts",
    PRODUCT_DRAFT_BUNDLE_ROOT: "/data/product-draft",
    WOO_PUBLISH_BASE_URL: "https://shop.example.invalid",
    WOO_PUBLISH_CONSUMER_KEY: "ck_fixture",
    WOO_PUBLISH_CONSUMER_SECRET: "cs_fixture",
    PRODUCT_MEDIA_USERNAME: "product-publisher",
    PRODUCT_MEDIA_APP_PASSWORD: "app-password",
  });
  assert.equal(config.productPublisher.consumerKey, "ck_fixture");
  assert.doesNotThrow(() => assertProductWriteAllowed(config));
});

test("rejects a weak or placeholder connector bearer", () => {
  assert.throws(() => readConfig({CONTENT_PUBLISHER_MCP_TOKEN: "short"}), /strong non-placeholder/);
  assert.throws(() => readConfig({CONTENT_PUBLISHER_MCP_TOKEN: "change-me-connector-token-that-is-still-not-safe"}), /strong non-placeholder/);
});

test("rejects partial or insecure WordPress configuration", () => {
  assert.throws(() => readConfig({...base, WORDPRESS_BASE_URL: "https://shop.example.invalid"}), /incomplete/);
  assert.throws(() => readConfig({
    ...base,
    WORDPRESS_BASE_URL: "http://shop.example.invalid",
    WORDPRESS_USERNAME: "publisher",
    WORDPRESS_APP_PASSWORD: "app-password",
  }), /must use HTTPS/);
});

test("requires an explicit Meta API version and token when a target is configured", () => {
  assert.throws(() => readConfig({...base, META_FACEBOOK_PAGE_ID: "123"}), /incomplete/);
  assert.throws(() => readConfig({...base, META_GRAPH_API_VERSION: "latest", META_GRAPH_ACCESS_TOKEN: "token", META_FACEBOOK_PAGE_ID: "123"}), /look like/);
  const config = readConfig({...base, META_GRAPH_API_VERSION: "v24.0", META_GRAPH_ACCESS_TOKEN: "token", META_INSTAGRAM_USER_ID: "456"});
  assert.equal(config.meta.instagramUserId, "456");
  assert.equal(config.meta.facebookPageId, null);
});

test("wordpress-drafts mode blocks publishing and every Meta write", () => {
  const config = readConfig({
    ...base,
    CONTENT_PUBLISH_WRITE_MODE: "wordpress-drafts",
    WORDPRESS_BASE_URL: "https://shop.example.invalid",
    WORDPRESS_USERNAME: "publisher",
    WORDPRESS_APP_PASSWORD: "app-password",
  });
  assert.doesNotThrow(() => assertWriteAllowed(config, "wordpress", "draft"));
  assert.throws(() => assertWriteAllowed(config, "wordpress", "publish"), /drafts only/);
  assert.throws(() => assertWriteAllowed(config, "facebook"), /drafts only/);
});
