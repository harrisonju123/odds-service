import { Pool } from 'pg';

export const ODDS_API_SPORTS: Record<string, string> = {
  nba: 'basketball_nba',
  nfl: 'americanfootball_nfl',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  wnba: 'basketball_wnba',
  cfb: 'americanfootball_ncaaf',
  mls: 'soccer_usa_mls',
  epl: 'soccer_epl',
  laliga: 'soccer_spain_la_liga',
  bundesliga: 'soccer_germany_bundesliga',
  seriea: 'soccer_italy_serie_a',
  ligue1: 'soccer_france_ligue_one',
  champions: 'soccer_uefa_champs_league',
};

// Focus on American sportsbooks
export const AMERICAN_BOOKMAKERS = [
  'fanduel',
  'draftkings', 
  'betmgm',
  'caesars',
  'betrivers',
  'pointsbet',
  'wynnbet',
  'betfred',
  'sugarhouse',
  'unibet_us',
];

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmaker[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiMarket {
  key: string; // h2h, spreads, totals
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiOutcome {
  name: string;
  price: number; // American odds format
  point?: number; // For spreads/totals
}

export interface OddsApiResponse {
  data?: OddsApiEvent[];
  message?: string;
  remaining_requests?: number;
}

export interface NormalizedOddsData {
  eventId: string;
  eventName: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmaker: string;
  market: string;
  outcome: string;
  americanOdds: number;
  point?: number;
}

export async function fetchOddsApiSport(
  sportKey: string,
  apiKey: string,
  markets: string[] = ['h2h', 'spreads', 'totals']
): Promise<OddsApiEvent[]> {
  const marketsParam = markets.join(',');
  const bookmakersParam = AMERICAN_BOOKMAKERS.join(',');
  
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?` + new URLSearchParams({
    apiKey,
    regions: 'us',
    markets: marketsParam,
    oddsFormat: 'american',
    bookmakers: bookmakersParam,
    dateFormat: 'iso',
  });

  console.log(`Fetching from The Odds API: ${sportKey}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The Odds API error ${response.status}: ${errorText}`);
  }
  
  const events: OddsApiEvent[] = await response.json();
  
  // Log API usage
  const remainingRequests = response.headers.get('x-requests-remaining');
  const usedRequests = response.headers.get('x-requests-used');
  console.log(`The Odds API usage - Remaining: ${remainingRequests}, Used: ${usedRequests}`);
  
  return events;
}

export function normalizeOddsApiData(events: OddsApiEvent[]): NormalizedOddsData[] {
  const normalizedData: NormalizedOddsData[] = [];

  for (const event of events) {
    if (!event.bookmakers) continue;

    for (const bookmaker of event.bookmakers) {
      // Skip non-American bookmakers
      if (!AMERICAN_BOOKMAKERS.includes(bookmaker.key)) continue;

      for (const market of bookmaker.markets) {
        for (const outcome of market.outcomes) {
          const normalizedRow: NormalizedOddsData = {
            eventId: event.id,
            eventName: `${event.away_team} @ ${event.home_team}`,
            sport: event.sport_key,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            commenceTime: event.commence_time,
            bookmaker: bookmaker.key,
            market: market.key,
            outcome: outcome.name,
            americanOdds: outcome.price,
            point: outcome.point,
          };
          
          normalizedData.push(normalizedRow);
        }
      }
    }
  }

  return normalizedData;
}

export function normalizeOddsSport(oddsApiSport: string): string | null {
  const sportMap: Record<string, string> = {
    'basketball_nba': 'nba',
    'basketball_wnba': 'wnba',
    'americanfootball_nfl': 'nfl',
    'americanfootball_ncaaf': 'cfb',
    'baseball_mlb': 'mlb',
    'icehockey_nhl': 'nhl',
    'soccer_usa_mls': 'mls',
    'soccer_epl': 'soccer',
    'soccer_spain_la_liga': 'soccer',
    'soccer_germany_bundesliga': 'soccer',
    'soccer_italy_serie_a': 'soccer',
    'soccer_france_ligue_one': 'soccer',
    'soccer_uefa_champs_league': 'soccer',
  };
  
  return sportMap[oddsApiSport] || null;
}

export function normalizeMarketType(market: string): string {
  const marketMap: Record<string, string> = {
    'h2h': 'moneyline',
    'spreads': 'spread',
    'totals': 'total',
  };
  
  return marketMap[market] || market;
}

export function normalizeSideFromOutcome(outcome: string, market: string, homeTeam: string, awayTeam: string): string {
  const o = outcome.toLowerCase();
  const m = market.toLowerCase();
  
  // Handle totals
  if (m.includes('total')) {
    if (o.includes('over')) return 'OVER';
    if (o.includes('under')) return 'UNDER';
  }
  
  // Handle team names
  if (o.includes(homeTeam.toLowerCase())) return 'HOME';
  if (o.includes(awayTeam.toLowerCase())) return 'AWAY';
  
  // Handle draws
  if (o.includes('draw') || o.includes('tie')) return 'DRAW';
  
  // Fallback
  return outcome.toUpperCase();
}

export async function upsertOddsApiData(
  sport: string,
  apiKey: string,
  pg: Pool
): Promise<NormalizedOddsData[]> {
  const sportKey = ODDS_API_SPORTS[sport];
  if (!sportKey) {
    console.warn(`Sport ${sport} not supported by The Odds API`);
    return [];
  }

  try {
    const events = await fetchOddsApiSport(sportKey, apiKey);
    const normalizedData = normalizeOddsApiData(events);
    
    console.log(`Fetched ${normalizedData.length} odds entries for ${sport} from The Odds API`);
    
    // Store in database
    await storeOddsApiInDatabase(normalizedData, pg);
    
    return normalizedData;
  } catch (error) {
    console.error(`Failed to fetch ${sport} from The Odds API:`, error);
    return [];
  }
}

async function storeOddsApiInDatabase(data: NormalizedOddsData[], pg: Pool): Promise<void> {
  const client = await pg.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const row of data) {
      // Insert/update event
      const eventResult = await client.query(
        `INSERT INTO events (provider_refs, sport, league, home, away, start_time, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ((provider_refs->>'odds_api')) DO UPDATE SET
           start_time = EXCLUDED.start_time,
           status = EXCLUDED.status
         RETURNING id`,
        [
          JSON.stringify({ odds_api: row.eventId }),
          normalizeOddsSport(row.sport) || 'unknown',
          row.sport,
          row.homeTeam,
          row.awayTeam,
          row.commenceTime,
          'scheduled'
        ]
      );
      
      const eventId = eventResult.rows[0].id;
      
      // Insert/update market
      const marketType = normalizeMarketType(row.market);
      const marketParams = row.point ? { points: row.point } : {};
      
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
      const side = normalizeSideFromOutcome(row.outcome, row.market, row.homeTeam, row.awayTeam);
      const canonicalKey = `${marketType}:${side}:${row.point || 'null'}`;
      
      const outcomeResult = await client.query(
        `INSERT INTO outcomes (market_id, side, canonical_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (market_id, canonical_key) DO UPDATE SET
           side = EXCLUDED.side
         RETURNING id`,
        [marketId, side, canonicalKey]
      );
      
      const outcomeId = outcomeResult.rows[0].id;
      
      // Convert American odds to decimal
      const priceDecimal = americanToDecimal(row.americanOdds);
      
      // Insert odds tick
      await client.query(
        `INSERT INTO odds_ticks (outcome_id, provider, price_decimal, line, price_type, ts)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          outcomeId,
          row.bookmaker,
          priceDecimal,
          row.point || null,
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

function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return (americanOdds / 100) + 1;
  } else {
    return (100 / Math.abs(americanOdds)) + 1;
  }
}

export async function fetchAvailableSports(apiKey: string): Promise<{ key: string; title: string }[]> {
  const url = `${ODDS_API_BASE}/sports?apiKey=${apiKey}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sports: ${response.status}`);
  }
  
  const sports = await response.json();
  return sports.filter((sport: any) => sport.active);
}