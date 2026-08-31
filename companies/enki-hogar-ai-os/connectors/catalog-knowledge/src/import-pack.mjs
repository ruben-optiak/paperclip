import {randomUUID} from "node:crypto";
import {assertSafeText, evidenceSourceKey} from "./normalization.mjs";

async function audit(sql, actor, action, packId, details) {
  await sql`
    INSERT INTO support_admin_audit (id, actor, action, pack_id, details)
    VALUES (${randomUUID()}, ${actor}, ${action}, ${packId}, ${JSON.stringify(details)}::jsonb)
  `;
}

export async function importSupportPack(sql, pack, {actor = "local-operator"} = {}) {
  const operator = assertSafeText(actor, "actor", {max: 120, commercialValues: false});
  const {manifest} = pack;
  return sql.begin(async (tx) => {
    const existing = await tx`
      SELECT id, manifest_sha256, status
      FROM support_packs
      WHERE pack_key = ${manifest.packKey} AND version = ${manifest.version}
      FOR UPDATE
    `;
    if (existing[0]) {
      if (existing[0].manifest_sha256 !== pack.manifestSha256) throw new Error("Pack key/version already exists with different immutable content");
      if (existing[0].status !== "active") throw new Error("A superseded pack version cannot be reactivated; publish a new version instead");
      return {
        status: "unchanged",
        pack_key: manifest.packKey,
        version: manifest.version,
        manifest_sha256: pack.manifestSha256,
      };
    }

    const [previous] = await tx`
      SELECT id, pack_key, version
      FROM support_packs
      WHERE brand_slug = ${manifest.brand.slug}
        AND domain_slug = ${manifest.domain.slug}
        AND status = 'active'
      FOR UPDATE
    `;
    if (previous) {
      await tx`
        UPDATE support_packs
        SET status = 'superseded', superseded_at = now()
        WHERE id = ${previous.id}
      `;
    }

    const packId = randomUUID();
    await tx`
      INSERT INTO support_packs (
        id, pack_key, version, brand_slug, brand_name, domain_slug, domain_name,
        snapshot_date, approved_by, approved_at, source_repository, source_revision_kind, source_revision,
        manifest_sha256, status
      ) VALUES (
        ${packId}, ${manifest.packKey}, ${manifest.version}, ${manifest.brand.slug}, ${manifest.brand.name},
        ${manifest.domain.slug}, ${manifest.domain.name}, ${manifest.snapshotDate}, ${manifest.approval.approvedBy},
        ${manifest.approval.approvedAt}, ${manifest.sourceRepository.locator}, ${manifest.sourceRepository.revisionKind},
        ${manifest.sourceRepository.revision},
        ${pack.manifestSha256}, 'active'
      )
    `;

    const sourceIds = new Map();
    for (const source of manifest.sources) {
      const id = randomUUID();
      sourceIds.set(source.sourceKey, id);
      await tx`
        INSERT INTO support_sources (id, pack_id, source_key, title, source_kind, locator, snapshot_date, source_sha256)
        VALUES (${id}, ${packId}, ${source.sourceKey}, ${source.title}, ${source.kind}, ${source.locator}, ${source.snapshotDate}, ${source.sha256})
      `;
    }

    const entityIds = new Map();
    for (const entity of pack.entities) {
      const id = randomUUID();
      entityIds.set(entity.entityKey, id);
      await tx`
        INSERT INTO support_entities (id, pack_id, entity_key, entity_kind, manufacturer_ref, name, series, category, summary)
        VALUES (${id}, ${packId}, ${entity.entityKey}, ${entity.entityKind}, ${entity.manufacturerRef}, ${entity.name}, ${entity.series}, ${entity.category}, ${entity.summary})
      `;
    }

    for (const fact of pack.facts) {
      await tx`
        INSERT INTO support_facts (id, pack_id, entity_id, source_id, fact_key, value_text, unit, applicability, evidence_ref, source_page, confidence)
        VALUES (
          ${randomUUID()}, ${packId}, ${entityIds.get(fact.entityKey)}, ${sourceIds.get(evidenceSourceKey(fact.evidenceRef))},
          ${fact.factKey}, ${fact.value}, ${fact.unit}, ${fact.applicability}, ${fact.evidenceRef}, ${fact.sourcePage}, ${fact.confidence}
        )
      `;
    }

    for (const relation of pack.relations) {
      await tx`
        INSERT INTO support_relations (id, pack_id, from_entity_id, to_entity_id, source_id, relation_type, condition_json, evidence_ref, source_page)
        VALUES (
          ${randomUUID()}, ${packId}, ${entityIds.get(relation.fromEntityKey)}, ${entityIds.get(relation.toEntityKey)},
          ${sourceIds.get(evidenceSourceKey(relation.evidenceRef))}, ${relation.relationType}, ${JSON.stringify(relation.condition)}::jsonb,
          ${relation.evidenceRef}, ${relation.sourcePage}
        )
      `;
    }

    for (const rule of pack.rules) {
      await tx`
        INSERT INTO support_configuration_rules (
          id, pack_id, entity_id, source_id, rule_key, axis, representation,
          affects_sku, affects_price, affects_stock, allowed_values, condition_json,
          effect_json, evidence_ref, source_page
        ) VALUES (
          ${randomUUID()}, ${packId}, ${entityIds.get(rule.entityKey)}, ${sourceIds.get(evidenceSourceKey(rule.evidenceRef))},
          ${rule.ruleKey}, ${rule.axis}, ${rule.representation}, ${rule.affectsSku}, ${rule.affectsPrice}, ${rule.affectsStock},
          ${JSON.stringify(rule.allowedValues)}::jsonb, ${JSON.stringify(rule.condition)}::jsonb, ${JSON.stringify(rule.effect)}::jsonb,
          ${rule.evidenceRef}, ${rule.sourcePage}
        )
      `;
    }

    for (const mapping of pack.crosswalk) {
      await tx`
        INSERT INTO support_sku_crosswalks (
          id, pack_id, entity_id, source_id, manufacturer_ref, woo_parent_sku,
          woo_variation_sku, mapping_kind, evidence_ref, approved_by, approved_at
        ) VALUES (
          ${randomUUID()}, ${packId}, ${entityIds.get(mapping.entityKey)}, ${sourceIds.get(evidenceSourceKey(mapping.evidenceRef))},
          ${mapping.manufacturerRef}, ${mapping.wooParentSku}, ${mapping.wooVariationSku}, ${mapping.mappingKind},
          ${mapping.evidenceRef}, ${mapping.approvedBy}, ${mapping.approvedAt}
        )
      `;
    }

    for (const chunk of pack.chunks) {
      await tx`
        INSERT INTO support_chunks (id, pack_id, entity_id, source_id, chunk_key, topic, content, evidence_ref, source_page)
        VALUES (
          ${randomUUID()}, ${packId}, ${chunk.entityKey ? entityIds.get(chunk.entityKey) : null},
          ${sourceIds.get(evidenceSourceKey(chunk.evidenceRef))}, ${chunk.chunkKey}, ${chunk.topic},
          ${chunk.content}, ${chunk.evidenceRef}, ${chunk.sourcePage}
        )
      `;
    }

    const counts = {
      sources: manifest.sources.length,
      entities: pack.entities.length,
      facts: pack.facts.length,
      relations: pack.relations.length,
      configuration_rules: pack.rules.length,
      sku_crosswalks: pack.crosswalk.length,
      support_chunks: pack.chunks.length,
    };
    await audit(tx, operator, "support_pack_imported", packId, {
      packKey: manifest.packKey,
      version: manifest.version,
      sourceRevision: manifest.sourceRepository.revision,
      sourceRevisionKind: manifest.sourceRepository.revisionKind,
      supersededPack: previous ? {packKey: previous.pack_key, version: previous.version} : null,
      counts,
    });
    return {
      status: "activated",
      pack_key: manifest.packKey,
      version: manifest.version,
      brand: manifest.brand.slug,
      domain: manifest.domain.slug,
      snapshot_date: manifest.snapshotDate,
      manifest_sha256: pack.manifestSha256,
      superseded: previous ? {pack_key: previous.pack_key, version: previous.version} : null,
      counts,
    };
  });
}
