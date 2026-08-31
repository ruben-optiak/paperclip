import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "001_product_support_knowledge.sql");

export async function migrate(sql, {readerPassword}) {
  if (!readerPassword || readerPassword.length < 16 || /^change-me/i.test(readerPassword)) {
    throw new Error("SUPPORT_DB_READER_PASSWORD must be a non-placeholder secret with at least 16 characters");
  }
  const migration = await readFile(migrationPath, "utf8");
  await sql.begin(async (tx) => {
    const [{database_name: databaseName}] = await tx`SELECT current_database() AS database_name`;
    await tx.unsafe(`DO $role$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enki_support_reader') THEN
        CREATE ROLE enki_support_reader LOGIN;
      END IF;
    END $role$;`);
    const [{quoted_password: quotedPassword}] = await tx`SELECT quote_literal(${readerPassword}) AS quoted_password`;
    await tx.unsafe(`ALTER ROLE enki_support_reader PASSWORD ${quotedPassword}`);
    await tx.unsafe("ALTER ROLE enki_support_reader WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    await tx.unsafe(migration);
    await tx.unsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await tx`REVOKE TEMPORARY ON DATABASE ${tx(databaseName)} FROM PUBLIC`;
    await tx.unsafe("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM enki_support_reader");
    await tx.unsafe("REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM enki_support_reader");
    await tx`GRANT CONNECT ON DATABASE ${tx(databaseName)} TO enki_support_reader`;
    await tx.unsafe("GRANT USAGE ON SCHEMA public TO enki_support_reader");
    await tx.unsafe(`GRANT SELECT ON
      support_schema_migrations,
      support_packs,
      support_sources,
      support_entities,
      support_facts,
      support_relations,
      support_configuration_rules,
      support_sku_crosswalks,
      support_chunks
    TO enki_support_reader`);
    await tx.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM enki_support_reader");
    await tx.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM enki_support_reader");
    await tx.unsafe("ALTER ROLE enki_support_reader SET default_transaction_read_only = on");
    await tx`INSERT INTO support_schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING`;
  });
}
