const {Pool} = require('pg');

function openPostgres({databaseUrl, ssl, max = 8}) {
  if (!databaseUrl) throw new Error('databaseUrl is required');
  const url = new URL(databaseUrl);
  // pg parses URL parameters after constructor settings; enforce our safety limits.
  for (const key of ['options','statement_timeout','query_timeout','connectionTimeoutMillis']) url.searchParams.delete(key);
  url.searchParams.set('options', '-c search_path=pg_catalog');
  const pool = new Pool({connectionString:url.href, ssl, max,
    connectionTimeoutMillis:5000, query_timeout:15000, statement_timeout:10000,
    idleTimeoutMillis:30000});
  pool.on('error', error => console.error('PostgreSQL pool error:', /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'UNKNOWN'));
  return {
    query: (text, values = []) => pool.query(text, values),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await fn({query:(text, values = []) => client.query(text, values)});
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { broken = true; }
        throw error;
      } finally { client.release(broken); }
    },
    close: () => pool.end(),
  };
}

function toSafeInteger(value) {
  if ((typeof value !== 'string' || !/^-?\d+$/.test(value)) &&
      (typeof value !== 'number' || !Number.isSafeInteger(value)) && typeof value !== 'bigint') {
    throw new RangeError('Expected a safe integer');
  }
  const integer = BigInt(value);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Integer exceeds safe range');
  return Number(integer);
}
module.exports = {openPostgres, toSafeInteger};
