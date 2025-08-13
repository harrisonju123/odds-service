import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';

const app = Fastify({ logger: true });

// Register CORS for React Native development
await app.register(cors, {
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

const pg = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health', async () => ({ ok: true }));

// Get all events with latest odds
app.get('/events', async (req, reply) => {
  const { sport, league, date } = req.query as any;
  
  let sql = `
    select e.id, e.sport, e.league, e.home, e.away, e.start_time, e.status,
           json_agg(
             json_build_object(
               'market_id', m.id,
               'market_type', m.type,
               'outcomes', (
                 select json_agg(
                   json_build_object(
                     'outcome_id', o.id,
                     'side', o.side,
                     'latest_price', (
                       select price_decimal from odds_ticks 
                       where outcome_id = o.id 
                       order by ts desc limit 1
                     ),
                     'latest_line', (
                       select line from odds_ticks 
                       where outcome_id = o.id 
                       order by ts desc limit 1
                     )
                   )
                 ) from outcomes o where o.market_id = m.id
               )
             )
           ) as markets
    from events e
    left join markets m on m.event_id = e.id
    where 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 0;
  
  if (sport) {
    sql += ` and e.sport = $${++paramCount}`;
    params.push(sport);
  }
  if (league) {
    sql += ` and e.league = $${++paramCount}`;
    params.push(league);
  }
  if (date) {
    sql += ` and e.start_time::date = $${++paramCount}`;
    params.push(date);
  }
  
  sql += ` group by e.id order by e.start_time`;
  
  const result = await pg.query(sql, params);
  return result.rows;
});

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
  `;
  const r = await pg.query(sql, [market_id]);
  
  // pick max price per outcome
  const best: Record<string, any> = {};
  for (const row of r.rows) {
    const k = row.outcome_id;
    if (!best[k] || Number(row.price_decimal) > Number(best[k].price_decimal)) {
      best[k] = row;
    }
  }
  return Object.values(best);
});

// Odds history for an outcome (for charts/CLV)
app.get('/odds/history', async (req, reply) => {
  const { outcome_id, provider } = req.query as any;
  const r = await pg.query(
    `select price_decimal, line, ts from odds_ticks
     where outcome_id=$1 and ($2::text is null or provider=$2)
     order by ts asc`, 
    [outcome_id, provider ?? null]
  );
  return r.rows;
});

// Manual trigger for odds scraping
app.post('/scrape', async (req, reply) => {
  const { league, provider } = req.body as any;
  
  const supportedProviders = ['draftkings', 'odds_api', 'all'];
  const selectedProvider = provider || 'all';
  
  if (!supportedProviders.includes(selectedProvider)) {
    return reply.status(400).send({ 
      error: `Invalid provider. Supported: ${supportedProviders.join(', ')}` 
    });
  }
  
  return { 
    message: `Scrape triggered for ${league || 'all leagues'} using ${selectedProvider} provider(s)`,
    timestamp: new Date().toISOString()
  };
});

// Get supported leagues and providers
app.get('/providers', async (req, reply) => {
  return {
    providers: [
      {
        name: 'draftkings',
        description: 'DraftKings Sportsbook',
        supported_leagues: ['nba', 'nfl', 'mlb', 'nhl', 'wnba', 'cfb', 'mma', 'golf', 'atp', 'wta', 'soccer']
      },
      {
        name: 'odds_api',
        description: 'The Odds API (FanDuel, BetMGM, Caesars, etc.)',
        supported_leagues: ['nba', 'nfl', 'mlb', 'nhl', 'wnba', 'cfb', 'mls', 'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'champions'],
        requires_api_key: true
      }
    ],
    american_bookmakers: ['fanduel', 'draftkings', 'betmgm', 'caesars', 'betrivers', 'pointsbet', 'wynnbet', 'betfred', 'sugarhouse', 'unibet_us']
  };
});

// Get available sports/leagues
app.get('/sports', async (req, reply) => {
  const result = await pg.query(`
    select sport, league, count(*) as event_count
    from events 
    where start_time > now() - interval '7 days'
    group by sport, league
    order by sport, league
  `);
  return result.rows;
});

await app.listen({ port: Number(process.env.PORT || 8080), host: "0.0.0.0" });