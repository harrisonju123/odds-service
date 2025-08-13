import { Pool } from 'pg';

export const DK_LEAGUES: Record<string, number[]> = {
  wnba: [94682],
  nba: [42648],
  nfl: [88808],
  nhl: [42133],
  mlb: [84240],
  npb: [35976],
  epl: [40253],
  cfb: [87637],
  mma: [9034],
  afl: [79494],
  nrl: [82508],
  mls: [89345],
  golf: [79720, 92694, 24222],
  atp: [44542, 44043, 55760],
  wta: [205680, 208693],
  soccer: [44525, 59107, 38529, 89345],
};

const DK_BASE = 'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1';

export interface DraftKingsEvent {
  id: string;
  name: string;
  startEventDate: string;
}

export interface DraftKingsMarket {
  id: string;
  name: string;
  eventId: string;
}

export interface DraftKingsSelection {
  marketId: string;
  participants: Array<{ name: string }>;
  label?: string;
  points?: number;
  displayOdds: { american?: string };
}

export interface DraftKingsPayload {
  events: DraftKingsEvent[];
  markets: DraftKingsMarket[];
  selections: DraftKingsSelection[];
}

export interface FlattenedOdds {
  eventId: string;
  eventName: string;
  dateUTC: string;
  team: string;
  market: string;
  points?: number;
  americanOdds: number;
}

export async function fetchDraftKingsLeague(leagueId: number): Promise<DraftKingsPayload> {
  const url = `${DK_BASE}/leagues/${leagueId}`;
  const headers = {
    referer: 'https://sportsbook.draftkings.com/',
    origin: 'https://sportsbook.draftkings.com',
    'user-agent': 'Mozilla/5.0 (SnapEdge bot)',
    'x-platform': 'web',
    accept: 'application/json',
  };

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch DraftKings data: ${response.status}`);
  }
  
  return response.json();
}

export function extractAmericanOdds(payload: DraftKingsPayload): FlattenedOdds[] {
  const events = Object.fromEntries(payload.events.map(e => [e.id, e]));
  const markets = Object.fromEntries(payload.markets.map(m => [m.id, m]));
  const rows: FlattenedOdds[] = [];

  for (const sel of payload.selections) {
    const market = markets[sel.marketId];
    const event = market ? events[market.eventId] : undefined;
    
    if (!market || !event) continue;
    
    const oddsRaw = sel.displayOdds?.american;
    if (!oddsRaw) continue;

    let oddsNum: number;
    try {
      oddsNum = parseInt(
        oddsRaw.replace(/[−–—]/g, '-'), 10
      );
      // Check if parseInt returned NaN
      if (isNaN(oddsNum)) {
        continue;
      }
    } catch {
      continue;
    }

    const row: FlattenedOdds = {
      eventId: event.id,
      eventName: event.name,
      dateUTC: event.startEventDate.split('T')[0],
      team: sel.participants?.[0]?.name || sel.label || '',
      market: market.name,
      points: sel.points,
      americanOdds: oddsNum,
    };
    
    rows.push(row);
  }

  return rows;
}

export function normalizeSport(raw: string): string | null {
  const s = raw.toLowerCase();
  
  if (s.includes('wnba')) return 'wnba';
  if (s.includes('nba')) return 'nba';
  if (s.includes('cfb') && s.includes('college')) return 'cfb';
  if (s.includes('nfl')) return 'nfl';
  if (s.includes('npb')) return 'npb';
  if (s.includes('mlb')) return 'mlb';
  if (s.includes('nhl')) return 'nhl';
  if (s.includes('mma') || s.includes('ufc')) return 'mma';
  if (s.includes('golf') && s.includes('masters')) return 'golf';
  if (s.includes('atp') || (s.includes('men') && s.includes('tennis'))) return 'atp';
  if (s.includes('wta') || (s.includes('women') && s.includes('tennis'))) return 'wta';
  if (s.includes('mls')) return 'mls';
  if (['soccer', 'mx', 'argentina', 'brazil', 'premier'].some(x => s.includes(x))) return 'soccer';
  
  return null;
}

export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return (americanOdds / 100) + 1;
  } else {
    return (100 / Math.abs(americanOdds)) + 1;
  }
}

export async function upsertOddsData(
  date: string,
  league: string,
  pg: Pool
): Promise<FlattenedOdds[]> {
  const sport = normalizeSport(league);
  if (!sport) return [];

  const leagueIds = DK_LEAGUES[sport] || [];
  const allRows: FlattenedOdds[] = [];

  for (const leagueId of leagueIds) {
    try {
      const payload = await fetchDraftKingsLeague(leagueId);
      const rows = extractAmericanOdds(payload);
      allRows.push(...rows);
      
      // Store in database
      await storeOddsInDatabase(rows, pg);
    } catch (error) {
      console.error(`Failed to fetch league ${leagueId}:`, error);
    }
  }

  return allRows;
}

async function storeOddsInDatabase(rows: FlattenedOdds[], pg: Pool): Promise<void> {
  const client = await pg.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const row of rows) {
      // Parse event name to extract teams
      const { home, away, league } = parseEventName(row.eventName);
      
      // Insert/update event
      const eventResult = await client.query(
        `INSERT INTO events (provider_refs, sport, league, home, away, start_time, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider_refs->>'draftkings') DO UPDATE SET
           start_time = EXCLUDED.start_time,
           status = EXCLUDED.status
         RETURNING id`,
        [
          JSON.stringify({ draftkings: row.eventId }),
          normalizeSport(league) || 'unknown',
          league,
          home,
          away,
          new Date(row.dateUTC).toISOString(),
          'scheduled'
        ]
      );
      
      const eventId = eventResult.rows[0].id;
      
      // Insert/update market
      const marketType = normalizeMarketType(row.market);
      const marketParams = row.points ? { points: row.points } : {};
      
      const marketResult = await client.query(
        `INSERT INTO markets (event_id, type, params)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, type, params) DO UPDATE SET
           type = EXCLUDED.type
         RETURNING id`,
        [eventId, marketType, JSON.stringify(marketParams)]
      );
      
      const marketId = marketResult.rows[0].id;
      
      // Insert/update outcome
      const side = normalizeSide(row.team, row.market);
      const canonicalKey = `${marketType}:${side}:${row.points || 'null'}`;
      
      const outcomeResult = await client.query(
        `INSERT INTO outcomes (market_id, side, canonical_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (market_id, canonical_key) DO UPDATE SET
           side = EXCLUDED.side
         RETURNING id`,
        [marketId, side, canonicalKey]
      );
      
      const outcomeId = outcomeResult.rows[0].id;
      
      // Insert odds tick
      await client.query(
        `INSERT INTO odds_ticks (outcome_id, provider, price_decimal, line, price_type, ts)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          outcomeId,
          'draftkings',
          americanToDecimal(row.americanOdds),
          row.points || null,
          'main'
        ]
      );
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function parseEventName(eventName: string): { home: string; away: string; league: string } {
  // Simple parsing - you may need to enhance this based on actual DraftKings format
  const parts = eventName.split(' vs ');
  if (parts.length === 2) {
    return {
      away: parts[0].trim(),
      home: parts[1].trim(),
      league: 'unknown'
    };
  }
  
  // Fallback
  return {
    home: eventName,
    away: 'TBD',
    league: 'unknown'
  };
}

function normalizeMarketType(market: string): string {
  const m = market.toLowerCase();
  
  if (m.includes('moneyline') || m.includes('winner')) return 'moneyline';
  if (m.includes('spread') || m.includes('handicap')) return 'spread';
  if (m.includes('total') || m.includes('over/under')) return 'total';
  
  return 'other';
}

function normalizeSide(team: string, market: string): string {
  const m = market.toLowerCase();
  const t = team.toLowerCase();
  
  if (m.includes('total') || m.includes('over/under')) {
    if (t.includes('over')) return 'OVER';
    if (t.includes('under')) return 'UNDER';
  }
  
  if (t.includes('draw') || t.includes('tie')) return 'DRAW';
  
  // For team-based markets, we'll need more context to determine HOME/AWAY
  // For now, just return the team name
  return team.toUpperCase();
}