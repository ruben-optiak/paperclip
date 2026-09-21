import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rename, rm, symlink, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {ProductBundleRepository} from "../src/product-bundle.mjs";

const fixturePath = new URL("../../../skills/enki-product-publishing/fixtures/product-draft-bundle.json", import.meta.url);
const variableFixturePath = new URL("../../../skills/enki-product-publishing/fixtures/product-draft-bundle-variable.json", import.meta.url);

function makeWebp(width, height, extraChunks = []) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunks = [["VP8 ", frame], ...extraChunks].map(([type, payload]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  });
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

async function makeBundle(source = fixturePath) {
  const root = await mkdtemp(join(tmpdir(), "enki-product-bundle-"));
  await mkdir(join(root, "media"));
  const manifest = JSON.parse(await readFile(source, "utf8"));
  for (const image of manifest.products.flatMap((product) => product.images)) {
    const media = makeWebp(image.width, image.height);
    await writeFile(join(root, image.path), media);
    image.sha256 = createHash("sha256").update(media).digest("hex");
  }
  await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {root, manifest};
}

test("loads a bounded reviewed bundle and verifies every media hash", async () => {
  const {root} = await makeBundle();
  try {
    const repository = new ProductBundleRepository(root);
    const listed = await repository.list();
    assert.equal(listed.products[0].product_key, "fixture-demo-60");
    const loaded = await repository.get("fixture-demo-60", listed.bundle_sha256);
    assert.equal(loaded.product.status, "draft");
    await assert.rejects(() => repository.get("fixture-demo-60", "0".repeat(64)), /differs from the reviewed approval/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects media whose bytes or official domain differ from the reviewed manifest", async () => {
  const {root, manifest} = await makeBundle();
  try {
    await writeFile(join(root, "media/fixture-demo-60-01.webp"), Buffer.from("RIFF0000WEBPtampered"));
    await assert.rejects(() => new ProductBundleRepository(root).load(), /do not match/);
    manifest.products[0].images[0].sourceUrl = "https://unapproved.example.invalid/image.webp";
    const media = makeWebp(manifest.products[0].images[0].width, manifest.products[0].images[0].height);
    manifest.products[0].images[0].sha256 = createHash("sha256").update(media).digest("hex");
    await writeFile(join(root, "media/fixture-demo-60-01.webp"), media);
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /outside the approved official domains/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects WebP dimension drift and retained metadata", async () => {
  const {root, manifest} = await makeBundle();
  try {
    const image = manifest.products[0].images[0];
    let media = makeWebp(image.width - 1, image.height);
    image.sha256 = createHash("sha256").update(media).digest("hex");
    await writeFile(join(root, image.path), media);
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /dimensions differ/);

    media = makeWebp(image.width, image.height, [["EXIF", Buffer.from("retained")]]);
    image.sha256 = createHash("sha256").update(media).digest("hex");
    await writeFile(join(root, image.path), media);
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /forbidden metadata/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects a GTIN with an invalid check digit", async () => {
  const {root, manifest} = await makeBundle();
  try {
    manifest.products[0].gtin = "12345678";
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /invalid GTIN check digit/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects a symlinked product media directory", async () => {
  const {root} = await makeBundle();
  try {
    await rename(join(root, "media"), join(root, "real-media"));
    await symlink(join(root, "real-media"), join(root, "media"), "dir");
    await assert.rejects(() => new ProductBundleRepository(root).load(), /media directory must be a regular directory/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("loads a reviewed variable product with exact child identities", async () => {
  const {root} = await makeBundle(variableFixturePath);
  try {
    const repository = new ProductBundleRepository(root);
    const listed = await repository.list();
    assert.equal(listed.products[0].type, "variable");
    assert.equal(listed.products[0].variation_count, 2);
    const loaded = await repository.get("fixture-pool-mixer", listed.bundle_sha256);
    assert.deepEqual(loaded.product.variations.map((item) => item.sku), ["MNO006SSNB", "MNO006SSRM"]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects duplicate child SKUs and options outside the parent matrix", async () => {
  const {root, manifest} = await makeBundle(variableFixturePath);
  try {
    manifest.products[0].variations[1].sku = manifest.products[0].variations[0].sku;
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /duplicate SKU/);

    manifest.products[0].variations[1].sku = "MNO006SSRM";
    manifest.products[0].variations[1].attributes[0].option = "Inventado";
    await writeFile(join(root, "product-draft-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => new ProductBundleRepository(root).load(), /option absent from the parent/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
