import Fastify from 'fastify';
import ws from '@fastify/websocket';
import { Pool } from 'pg';
import Redis from 'ioredis';

const app = Fastify({ logger: true });
await app.register(ws);

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL!);

app.get('/health', async () => ({ ok: true }));

// Best price for a market (by outcome)
app.get('/best-price', async (req, reply) => {
  const { market_id } = req.query as any;
  const sql = `
    with latest as (
      select distinct on (o.id, provider) o.id as outcome_id, provider, price_decimal, line, ts
      from outcomes o
      join odds_ticks t on t.outcome_id = o.id
      where o.market_id = $1
      order by o.id, provider, ts desc
    )
    select outcome_id, provider, price_decimal, line
    from latest
    qualify true
  `;
  const r = await pg.query(sql, [market_id]);
  // pick max price per outcome
  const best: Record<string, any> = {};
  for (const row of r.rows) {
    const k = row.outcome_id;
    if (!best[k] || Number(row.price_decimal) > Number(best[k].price_decimal)) best[k] = row;
  }
  return Object.values(best);
});

// Odds history for an outcome (for charts/CLV)
app.get('/odds/history', async (req, reply) => {
  const { outcome_id, provider } = req.query as any;
  const r = await pg.query(
    `select price_decimal, line, ts from odds_ticks
     where outcome_id=$1 and ($2::text is null or provider=$2)
     order by ts asc`, [outcome_id, provider ?? null]
  );
  return r.rows;
});

// WS stream (publish/subscribe simple fanout via Redis)
app.get('/stream', { websocket: true }, (conn, req) => {
  const sub = new Redis(process.env.REDIS_URL!);
  sub.subscribe('market_ticks');
  sub.on('message', (_chan, msg) => conn.socket.send(msg));
  conn.socket.on('close', () => sub.disconnect());
});

await app.listen({ port: Number(process.env.PORT || 8080), host: "0.0.0.0" });