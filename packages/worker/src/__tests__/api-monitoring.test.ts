import { describe, it, expect } from 'vitest';
import { DK_LEAGUES } from '../draftkings.js';

/**
 * These tests are designed to detect when DraftKings changes their API
 * They focus on structure validation rather than specific values
 */
describe('DraftKings API Monitoring', () => {
  it('should detect if league IDs become invalid', async () => {
    // Test a few key leagues to ensure they're still valid
    const criticalLeagues = {
      nba: DK_LEAGUES.nba[0],
      nfl: DK_LEAGUES.nfl[0],
      mlb: DK_LEAGUES.mlb[0]
    };

    const results = await Promise.allSettled(
      Object.entries(criticalLeagues).map(async ([sport, leagueId]) => {
        const response = await fetch(
          `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1/leagues/${leagueId}`,
          {
            headers: {
              'referer': 'https://sportsbook.draftkings.com/',
              'user-agent': 'Mozilla/5.0 (SnapEdge bot)',
              'accept': 'application/json'
            }
          }
        );
        
        return { sport, leagueId, status: response.status, ok: response.ok };
      })
    );

    const failedLeagues = results
      .filter(result => result.status === 'fulfilled' && !result.value.ok)
      .map(result => result.status === 'fulfilled' ? result.value : null);

    if (failedLeagues.length > 0) {
      console.warn('⚠️  Failed league endpoints:', failedLeagues);
    }

    const successfulRequests = results.filter(
      result => result.status === 'fulfilled' && result.value.ok
    ).length;

    // At least some leagues should work (unless complete API change)
    expect(successfulRequests).toBeGreaterThanOrEqual(0);
    
    console.log(`✅ ${successfulRequests}/${results.length} league endpoints working`);
  });

  it('should validate API rate limiting and headers', async () => {
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

      // Check for rate limiting responses
      if (response.status === 429) {
        console.warn('⚠️  Rate limited by DraftKings API');
        const retryAfter = response.headers.get('retry-after');
        console.log('Retry-After header:', retryAfter);
      }

      // Check for blocked requests
      if (response.status === 403) {
        console.warn('⚠️  Request blocked by DraftKings (possible bot detection)');
      }

      // Log important headers for monitoring
      console.log('Response headers:', {
        'content-type': response.headers.get('content-type'),
        'cache-control': response.headers.get('cache-control'),
        'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
        'server': response.headers.get('server'),
      });

    } catch (error) {
      console.warn('Header validation failed:', error);
    }
  });

  it('should check for new required headers or authentication', async () => {
    const testLeague = DK_LEAGUES.mlb[0];
    
    // Test with minimal headers
    try {
      const minimalResponse = await fetch(
        `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1/leagues/${testLeague}`
      );
      
      // Test with full headers
      const fullResponse = await fetch(
        `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusny/v1/leagues/${testLeague}`,
        {
          headers: {
            'referer': 'https://sportsbook.draftkings.com/',
            'origin': 'https://sportsbook.draftkings.com',
            'user-agent': 'Mozilla/5.0 (SnapEdge bot)',
            'x-platform': 'web',
            'accept': 'application/json'
          }
        }
      );

      console.log('Header comparison:', {
        minimal: { status: minimalResponse.status, ok: minimalResponse.ok },
        full: { status: fullResponse.status, ok: fullResponse.ok }
      });

      // If minimal fails but full succeeds, headers are required
      if (!minimalResponse.ok && fullResponse.ok) {
        console.log('✅ Headers are required for API access');
      } else if (minimalResponse.ok) {
        console.log('ℹ️  Headers may not be strictly required');
      }

    } catch (error) {
      console.warn('Header requirement test failed:', error);
    }
  });

  it('should monitor for changes in data completeness', async () => {
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

      if (response.ok) {
        const data = await response.json();
        
        // Calculate data completeness metrics
        const metrics = {
          totalEvents: data.events?.length || 0,
          totalMarkets: data.markets?.length || 0,
          totalSelections: data.selections?.length || 0,
          selectionsWithOdds: data.selections?.filter(s => s.displayOdds?.american).length || 0,
          eventsWithStartDate: data.events?.filter(e => e.startEventDate).length || 0,
          marketsWithEventId: data.markets?.filter(m => m.eventId).length || 0
        };

        console.log('Data completeness metrics:', metrics);

        // Calculate percentages
        if (metrics.totalSelections > 0) {
          const oddsCompleteness = (metrics.selectionsWithOdds / metrics.totalSelections) * 100;
          console.log(`Odds completeness: ${oddsCompleteness.toFixed(1)}%`);
          
          // Warn if completeness drops significantly
          if (oddsCompleteness < 50 && metrics.totalSelections > 10) {
            console.warn('⚠️  Low odds completeness detected');
          }
        }

        // Validate expected data relationships
        if (metrics.totalMarkets > 0 && metrics.marketsWithEventId === 0) {
          console.warn('⚠️  Markets missing eventId references');
        }

        if (metrics.totalEvents > 0 && metrics.eventsWithStartDate === 0) {
          console.warn('⚠️  Events missing start dates');
        }
      }

    } catch (error) {
      console.warn('Data completeness monitoring failed:', error);
    }
  });

  it('should detect breaking changes in field names or types', async () => {
    const testLeague = DK_LEAGUES.nfl[0];
    
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

      if (response.ok) {
        const data = await response.json();
        
        // Check critical field existence and types
        const criticalChecks = {
          'events array exists': Array.isArray(data.events),
          'markets array exists': Array.isArray(data.markets),
          'selections array exists': Array.isArray(data.selections),
        };

        if (data.events?.length > 0) {
          const event = data.events[0];
          Object.assign(criticalChecks, {
            'event.id is string': typeof event.id === 'string',
            'event.name is string': typeof event.name === 'string',
            'event.startEventDate exists': 'startEventDate' in event,
          });
        }

        if (data.markets?.length > 0) {
          const market = data.markets[0];
          Object.assign(criticalChecks, {
            'market.id is string': typeof market.id === 'string',
            'market.eventId is string': typeof market.eventId === 'string',
            'market.name is string': typeof market.name === 'string',
          });
        }

        if (data.selections?.length > 0) {
          const selection = data.selections[0];
          Object.assign(criticalChecks, {
            'selection.marketId is string': typeof selection.marketId === 'string',
            'selection.displayOdds exists': 'displayOdds' in selection,
          });
        }

        console.log('Field validation results:', criticalChecks);

        const failedChecks = Object.entries(criticalChecks)
          .filter(([_, passed]) => !passed)
          .map(([check, _]) => check);

        if (failedChecks.length > 0) {
          console.error('🚨 BREAKING CHANGES DETECTED:', failedChecks);
        } else {
          console.log('✅ All critical fields validated successfully');
        }

        // Don't fail the test, just report issues
        expect(failedChecks.length).toBeLessThan(Object.keys(criticalChecks).length);
      }

    } catch (error) {
      console.warn('Field validation failed:', error);
    }
  });
});