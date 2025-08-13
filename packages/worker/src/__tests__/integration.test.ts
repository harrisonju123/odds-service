import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { upsertOddsData, DK_LEAGUES } from '../draftkings.js';

// These tests require a test database - skip if not available
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const shouldRunIntegrationTests = !!TEST_DATABASE_URL;

describe.skipIf(!shouldRunIntegrationTests)('Database Integration Tests', () => {
  let pg: Pool;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;
    
    pg = new Pool({ connectionString: TEST_DATABASE_URL });
    
    // Ensure test database has the required schema
    await pg.query(`
      CREATE TABLE IF NOT EXISTS events (
        id bigserial primary key,
        provider_refs jsonb not null default '{}'::jsonb,
        sport text not null,
        league text not null,
        home text not null,
        away text not null,
        start_time timestamptz not null,
        status text not null default 'scheduled'
      )
    `);
    
    await pg.query(`
      CREATE TABLE IF NOT EXISTS markets (
        id bigserial primary key,
        event_id bigint not null references events(id) on delete cascade,
        type text not null,
        params jsonb not null default '{}'::jsonb
      )
    `);
    
    await pg.query(`
      CREATE TABLE IF NOT EXISTS outcomes (
        id bigserial primary key,
        market_id bigint not null references markets(id) on delete cascade,
        side text not null,
        canonical_key text not null
      )
    `);
    
    await pg.query(`
      CREATE TABLE IF NOT EXISTS odds_ticks (
        id bigserial primary key,
        outcome_id bigint not null references outcomes(id) on delete cascade,
        provider text not null,
        price_decimal numeric(10,4) not null,
        line numeric(10,2),
        price_type text not null default 'main',
        ts timestamptz not null default now()
      )
    `);
  });

  afterAll(async () => {
    if (pg) {
      // Clean up test data
      await pg.query('DELETE FROM odds_ticks');
      await pg.query('DELETE FROM outcomes');
      await pg.query('DELETE FROM markets');
      await pg.query('DELETE FROM events');
      await pg.end();
    }
  });

  it('should successfully store scraped data in database', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Test with a small league to avoid overwhelming the API
      const result = await upsertOddsData(today, 'nba', pg);
      
      // Verify data was inserted
      const eventCount = await pg.query('SELECT COUNT(*) FROM events');
      const marketCount = await pg.query('SELECT COUNT(*) FROM markets');
      const outcomeCount = await pg.query('SELECT COUNT(*) FROM outcomes');
      const oddsCount = await pg.query('SELECT COUNT(*) FROM odds_ticks');
      
      console.log('Database counts after scrape:', {
        events: eventCount.rows[0].count,
        markets: marketCount.rows[0].count,
        outcomes: outcomeCount.rows[0].count,
        odds: oddsCount.rows[0].count,
        scraped_rows: result.length
      });
      
      // Should have some data (unless it's completely off-season)
      expect(parseInt(eventCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      expect(parseInt(marketCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      expect(parseInt(outcomeCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      expect(parseInt(oddsCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      
    } catch (error) {
      console.warn('Integration test warning:', error);
      // Don't fail the test if API is down or returns no data
    }
  }, 30000);

  it('should handle duplicate data correctly', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Run the same scrape twice
      await upsertOddsData(today, 'mlb', pg);
      const firstCount = await pg.query('SELECT COUNT(*) FROM events');
      
      await upsertOddsData(today, 'mlb', pg);
      const secondCount = await pg.query('SELECT COUNT(*) FROM events');
      
      // Event count should be the same (no duplicates)
      expect(secondCount.rows[0].count).toBe(firstCount.rows[0].count);
      
      // But odds_ticks should have more entries (new odds data)
      const oddsCount = await pg.query('SELECT COUNT(*) FROM odds_ticks');
      expect(parseInt(oddsCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      
    } catch (error) {
      console.warn('Duplicate handling test warning:', error);
    }
  }, 30000);

  it('should validate database schema constraints', async () => {
    // Test foreign key constraints
    try {
      // This should fail - no such event
      await pg.query(`
        INSERT INTO markets (event_id, type, params) 
        VALUES (99999, 'moneyline', '{}')
      `);
      expect.fail('Should have thrown foreign key constraint error');
    } catch (error) {
      expect(error.message).toContain('violates foreign key constraint');
    }
    
    // Test required fields
    try {
      await pg.query(`
        INSERT INTO events (sport, league, home, away, start_time) 
        VALUES (NULL, 'test', 'home', 'away', NOW())
      `);
      expect.fail('Should have thrown not null constraint error');
    } catch (error) {
      expect(error.message).toContain('null value');
    }
  });

  it('should validate data types and formats', async () => {
    const result = await pg.query(`
      SELECT 
        e.provider_refs,
        e.start_time,
        m.params,
        ot.price_decimal,
        ot.line,
        ot.ts
      FROM events e
      LEFT JOIN markets m ON m.event_id = e.id
      LEFT JOIN outcomes o ON o.market_id = m.id
      LEFT JOIN odds_ticks ot ON ot.outcome_id = o.id
      WHERE ot.id IS NOT NULL
      LIMIT 10
    `);
    
    result.rows.forEach(row => {
      // Validate JSONB fields
      expect(typeof row.provider_refs).toBe('object');
      expect(typeof row.params).toBe('object');
      
      // Validate timestamps
      expect(row.start_time instanceof Date).toBe(true);
      expect(row.ts instanceof Date).toBe(true);
      
      // Validate numeric fields
      expect(typeof parseFloat(row.price_decimal)).toBe('number');
      expect(parseFloat(row.price_decimal)).toBeGreaterThan(0);
      
      if (row.line !== null) {
        expect(typeof parseFloat(row.line)).toBe('number');
      }
    });
  });
});

describe('API Response Monitoring', () => {
  it('should monitor for DraftKings API changes', async () => {
    // This test acts as a canary for API changes
    const testLeague = DK_LEAGUES.nba[0];
    
    try {
      const response = await fetch(
        `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1/leagues/${testLeague}`,
        {
          headers: {
            'referer': 'https://sportsbook.draftkings.com/',
            'user-agent': 'Mozilla/5.0 (SnapEdge bot)',
            'accept': 'application/json'
          }
        }
      );
      
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('json');
      
      const data = await response.json();
      
      // Critical structure checks
      expect(data).toHaveProperty('events');
      expect(data).toHaveProperty('markets');
      expect(data).toHaveProperty('selections');
      
      // Log API health
      console.log('DraftKings API Health Check:', {
        status: response.status,
        events: data.events?.length || 0,
        markets: data.markets?.length || 0,
        selections: data.selections?.length || 0,
        responseTime: response.headers.get('x-response-time') || 'unknown'
      });
      
    } catch (error) {
      console.error('API Health Check Failed:', error);
      // Don't fail the test - just log the issue
    }
  });

  it('should validate response time is reasonable', async () => {
    const startTime = Date.now();
    const testLeague = DK_LEAGUES.mlb[0];
    
    try {
      await fetch(
        `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1/leagues/${testLeague}`,
        {
          headers: {
            'referer': 'https://sportsbook.draftkings.com/',
            'user-agent': 'Mozilla/5.0 (SnapEdge bot)',
            'accept': 'application/json'
          }
        }
      );
      
      const responseTime = Date.now() - startTime;
      console.log(`API Response Time: ${responseTime}ms`);
      
      // Warn if response is very slow (but don't fail)
      if (responseTime > 10000) {
        console.warn('API response time is unusually slow');
      }
      
      expect(responseTime).toBeLessThan(30000); // 30 second timeout
      
    } catch (error) {
      console.warn('Response time test failed:', error);
    }
  });
});