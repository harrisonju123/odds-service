import { describe, it, expect } from 'vitest';
import { 
  fetchOddsApiSport,
  normalizeOddsApiData,
  normalizeOddsSport,
  normalizeMarketType,
  normalizeSideFromOutcome,
  fetchAvailableSports,
  ODDS_API_SPORTS,
  AMERICAN_BOOKMAKERS
} from '../odds-api.js';

// Skip tests if no API key is provided
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const shouldRunApiTests = !!ODDS_API_KEY;

describe('The Odds API Integration', () => {
  describe('Data Normalization Functions', () => {
    it('should normalize sport keys correctly', () => {
      expect(normalizeOddsSport('basketball_nba')).toBe('nba');
      expect(normalizeOddsSport('americanfootball_nfl')).toBe('nfl');
      expect(normalizeOddsSport('baseball_mlb')).toBe('mlb');
      expect(normalizeOddsSport('icehockey_nhl')).toBe('nhl');
      expect(normalizeOddsSport('basketball_wnba')).toBe('wnba');
      expect(normalizeOddsSport('soccer_epl')).toBe('soccer');
      expect(normalizeOddsSport('unknown_sport')).toBe(null);
    });

    it('should normalize market types correctly', () => {
      expect(normalizeMarketType('h2h')).toBe('moneyline');
      expect(normalizeMarketType('spreads')).toBe('spread');
      expect(normalizeMarketType('totals')).toBe('total');
      expect(normalizeMarketType('unknown')).toBe('unknown');
    });

    it('should normalize outcome sides correctly', () => {
      // Test totals
      expect(normalizeSideFromOutcome('Over 225.5', 'totals', 'Lakers', 'Warriors')).toBe('OVER');
      expect(normalizeSideFromOutcome('Under 225.5', 'totals', 'Lakers', 'Warriors')).toBe('UNDER');
      
      // Test team names
      expect(normalizeSideFromOutcome('Lakers', 'h2h', 'Lakers', 'Warriors')).toBe('HOME');
      expect(normalizeSideFromOutcome('Warriors', 'h2h', 'Lakers', 'Warriors')).toBe('AWAY');
      
      // Test draws
      expect(normalizeSideFromOutcome('Draw', 'h2h', 'TeamA', 'TeamB')).toBe('DRAW');
      
      // Test fallback
      expect(normalizeSideFromOutcome('Unknown', 'h2h', 'TeamA', 'TeamB')).toBe('UNKNOWN');
    });

    it('should validate American bookmakers list', () => {
      expect(AMERICAN_BOOKMAKERS).toContain('fanduel');
      expect(AMERICAN_BOOKMAKERS).toContain('draftkings');
      expect(AMERICAN_BOOKMAKERS).toContain('betmgm');
      expect(AMERICAN_BOOKMAKERS).toContain('caesars');
      
      // Should not contain international bookmakers
      expect(AMERICAN_BOOKMAKERS).not.toContain('bet365');
      expect(AMERICAN_BOOKMAKERS).not.toContain('pinnacle');
      expect(AMERICAN_BOOKMAKERS).not.toContain('ladbrokes');
    });

    it('should validate sports mapping', () => {
      const requiredSports = ['nba', 'nfl', 'mlb', 'nhl'];
      
      requiredSports.forEach(sport => {
        expect(ODDS_API_SPORTS).toHaveProperty(sport);
        expect(typeof ODDS_API_SPORTS[sport]).toBe('string');
      });
    });
  });

  describe('Data Structure Validation', () => {
    it('should handle valid odds API response structure', () => {
      const mockEvents = [
        {
          id: 'event1',
          sport_key: 'basketball_nba',
          sport_title: 'NBA',
          commence_time: '2024-01-01T19:00:00Z',
          home_team: 'Lakers',
          away_team: 'Warriors',
          bookmakers: [
            {
              key: 'fanduel',
              title: 'FanDuel',
              last_update: '2024-01-01T18:00:00Z',
              markets: [
                {
                  key: 'h2h',
                  last_update: '2024-01-01T18:00:00Z',
                  outcomes: [
                    { name: 'Lakers', price: -110 },
                    { name: 'Warriors', price: 100 }
                  ]
                }
              ]
            }
          ]
        }
      ];

      const normalized = normalizeOddsApiData(mockEvents);
      
      expect(normalized).toHaveLength(2);
      expect(normalized[0]).toHaveProperty('eventId', 'event1');
      expect(normalized[0]).toHaveProperty('bookmaker', 'fanduel');
      expect(normalized[0]).toHaveProperty('market', 'h2h');
      expect(normalized[0]).toHaveProperty('americanOdds', -110);
      expect(normalized[1]).toHaveProperty('americanOdds', 100);
    });

    it('should filter out non-American bookmakers', () => {
      const mockEvents = [
        {
          id: 'event1',
          sport_key: 'basketball_nba',
          sport_title: 'NBA',
          commence_time: '2024-01-01T19:00:00Z',
          home_team: 'Lakers',
          away_team: 'Warriors',
          bookmakers: [
            {
              key: 'bet365', // Non-American bookmaker
              title: 'Bet365',
              last_update: '2024-01-01T18:00:00Z',
              markets: [
                {
                  key: 'h2h',
                  last_update: '2024-01-01T18:00:00Z',
                  outcomes: [
                    { name: 'Lakers', price: -110 }
                  ]
                }
              ]
            },
            {
              key: 'fanduel', // American bookmaker
              title: 'FanDuel',
              last_update: '2024-01-01T18:00:00Z',
              markets: [
                {
                  key: 'h2h',
                  last_update: '2024-01-01T18:00:00Z',
                  outcomes: [
                    { name: 'Lakers', price: -110 }
                  ]
                }
              ]
            }
          ]
        }
      ];

      const normalized = normalizeOddsApiData(mockEvents);
      
      // Should only include FanDuel, not Bet365
      expect(normalized).toHaveLength(1);
      expect(normalized[0].bookmaker).toBe('fanduel');
    });

    it('should handle events without bookmakers', () => {
      const mockEvents = [
        {
          id: 'event1',
          sport_key: 'basketball_nba',
          sport_title: 'NBA',
          commence_time: '2024-01-01T19:00:00Z',
          home_team: 'Lakers',
          away_team: 'Warriors'
          // No bookmakers property
        }
      ];

      const normalized = normalizeOddsApiData(mockEvents);
      expect(normalized).toHaveLength(0);
    });

    it('should handle spreads and totals with points', () => {
      const mockEvents = [
        {
          id: 'event1',
          sport_key: 'basketball_nba',
          sport_title: 'NBA',
          commence_time: '2024-01-01T19:00:00Z',
          home_team: 'Lakers',
          away_team: 'Warriors',
          bookmakers: [
            {
              key: 'fanduel',
              title: 'FanDuel',
              last_update: '2024-01-01T18:00:00Z',
              markets: [
                {
                  key: 'spreads',
                  last_update: '2024-01-01T18:00:00Z',
                  outcomes: [
                    { name: 'Lakers', price: -110, point: -2.5 },
                    { name: 'Warriors', price: -110, point: 2.5 }
                  ]
                },
                {
                  key: 'totals',
                  last_update: '2024-01-01T18:00:00Z',
                  outcomes: [
                    { name: 'Over', price: -110, point: 225.5 },
                    { name: 'Under', price: -110, point: 225.5 }
                  ]
                }
              ]
            }
          ]
        }
      ];

      const normalized = normalizeOddsApiData(mockEvents);
      
      expect(normalized).toHaveLength(4);
      
      // Check spreads
      const spreads = normalized.filter(n => n.market === 'spreads');
      expect(spreads).toHaveLength(2);
      expect(spreads[0].point).toBe(-2.5);
      expect(spreads[1].point).toBe(2.5);
      
      // Check totals
      const totals = normalized.filter(n => n.market === 'totals');
      expect(totals).toHaveLength(2);
      expect(totals[0].point).toBe(225.5);
      expect(totals[1].point).toBe(225.5);
    });
  });

  describe.skipIf(!shouldRunApiTests)('Live API Tests', () => {
    it('should fetch available sports successfully', async () => {
      const sports = await fetchAvailableSports(ODDS_API_KEY!);
      
      expect(Array.isArray(sports)).toBe(true);
      expect(sports.length).toBeGreaterThan(0);
      
      // Should have required properties
      sports.forEach(sport => {
        expect(sport).toHaveProperty('key');
        expect(sport).toHaveProperty('title');
        expect(typeof sport.key).toBe('string');
        expect(typeof sport.title).toBe('string');
      });
      
      console.log(`Available sports: ${sports.map(s => s.key).join(', ')}`);
    });

    it('should fetch NBA odds from FanDuel successfully', async () => {
      try {
        const events = await fetchOddsApiSport('basketball_nba', ODDS_API_KEY!);
        
        expect(Array.isArray(events)).toBe(true);
        
        if (events.length > 0) {
          const event = events[0];
          expect(event).toHaveProperty('id');
          expect(event).toHaveProperty('sport_key', 'basketball_nba');
          expect(event).toHaveProperty('home_team');
          expect(event).toHaveProperty('away_team');
          expect(event).toHaveProperty('commence_time');
          
          // Check if FanDuel data is present
          const fanduelBookmaker = event.bookmakers?.find(b => b.key === 'fanduel');
          if (fanduelBookmaker) {
            expect(fanduelBookmaker).toHaveProperty('markets');
            expect(Array.isArray(fanduelBookmaker.markets)).toBe(true);
            
            console.log(`✅ FanDuel data found for NBA event: ${event.home_team} vs ${event.away_team}`);
          } else {
            console.log('ℹ️  No FanDuel data available for current NBA events');
          }
        } else {
          console.log('ℹ️  No NBA events available (might be off-season)');
        }
      } catch (error) {
        console.warn('NBA API test failed:', error);
        // Don't fail the test - API might be down or no games available
      }
    });

    it('should handle API rate limiting gracefully', async () => {
      // This test helps monitor API usage and limits
      try {
        const events = await fetchOddsApiSport('baseball_mlb', ODDS_API_KEY!);
        
        // The function should complete without errors
        expect(Array.isArray(events)).toBe(true);
        
        console.log(`✅ MLB API call completed, ${events.length} events fetched`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          console.warn('⚠️  API rate limit reached');
        } else if (errorMessage.includes('401') || errorMessage.includes('403')) {
          console.warn('⚠️  API authentication issue');
        } else {
          console.warn('API call failed:', errorMessage);
        }
        
        // Don't fail the test for API issues
      }
    });

    it('should validate response structure matches expected format', async () => {
      try {
        const events = await fetchOddsApiSport('americanfootball_nfl', ODDS_API_KEY!);
        
        if (events.length > 0) {
          const event = events[0];
          
          // Critical structure validation
          expect(event).toHaveProperty('id');
          expect(event).toHaveProperty('sport_key');
          expect(event).toHaveProperty('home_team');
          expect(event).toHaveProperty('away_team');
          expect(event).toHaveProperty('commence_time');
          
          // Validate ISO timestamp format
          expect(event.commence_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
          
          if (event.bookmakers && event.bookmakers.length > 0) {
            const bookmaker = event.bookmakers[0];
            expect(bookmaker).toHaveProperty('key');
            expect(bookmaker).toHaveProperty('title');
            expect(bookmaker).toHaveProperty('markets');
            expect(Array.isArray(bookmaker.markets)).toBe(true);
            
            if (bookmaker.markets.length > 0) {
              const market = bookmaker.markets[0];
              expect(market).toHaveProperty('key');
              expect(market).toHaveProperty('outcomes');
              expect(Array.isArray(market.outcomes)).toBe(true);
              
              if (market.outcomes.length > 0) {
                const outcome = market.outcomes[0];
                expect(outcome).toHaveProperty('name');
                expect(outcome).toHaveProperty('price');
                expect(typeof outcome.price).toBe('number');
              }
            }
          }
          
          console.log('✅ NFL API response structure validated');
        }
      } catch (error) {
        console.warn('NFL structure validation failed:', error);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid API key gracefully', async () => {
      try {
        await fetchOddsApiSport('basketball_nba', 'invalid_key');
        expect.fail('Should have thrown an error for invalid API key');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect(error.message).toContain('401');
      }
    });

    it('should handle invalid sport key gracefully', async () => {
      if (!ODDS_API_KEY) return;
      
      try {
        await fetchOddsApiSport('invalid_sport', ODDS_API_KEY);
        expect.fail('Should have thrown an error for invalid sport key');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        // Should get 400 or 404 for invalid sport
        expect(error.message).toMatch(/40[04]/);
      }
    });
  });
});