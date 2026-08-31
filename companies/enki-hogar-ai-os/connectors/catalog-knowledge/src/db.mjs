import postgres from "postgres";

export function createDatabase(config) {
  return postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    max: config.max,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: true,
    onnotice: () => {},
  });
}

export async function closeDatabase(sql) {
  await sql.end({timeout: 5});
}

