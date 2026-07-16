const { createHash } = require("crypto");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
  );
  return `{${entries.join(",")}}`;
}

function buildIdempotencyRequestHash(payload) {
  const canonicalPayload = stableStringify(payload);
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

async function ensureIdempotencyTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS api_idempotency_records (
      idempotency_key TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (idempotency_key, scope, actor_id)
    )
  `);
}

module.exports = {
  buildIdempotencyRequestHash,
  ensureIdempotencyTable,
};
