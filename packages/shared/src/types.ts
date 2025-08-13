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

export interface EventData {
  provider_refs: Record<string, string>;
  sport: string;
  league: string;
  home: string;
  away: string;
  start_time: string;
  status: string;
}

export interface MarketData {
  event_id: number;
  type: string;
  params: Record<string, any>;
}

export interface OutcomeData {
  market_id: number;
  side: string;
  canonical_key: string;
}

export interface OddsTickData {
  outcome_id: number;
  provider: string;
  price_decimal: number;
  line?: number;
  price_type: string;
}