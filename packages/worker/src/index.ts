import { Pool } from 'pg';
import cron from 'node-cron';
import { upsertOddsData, DK_LEAGUES } from './draftkings.js';
import { upsertOddsApiData, ODDS_API_SPORTS } from './odds-api.js';

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Simple in-memory job tracking
const activeJobs = new Set<string>();

interface ProcessingResult {
  provider: string;
  league: string;
  count: number;
  success: boolean;
  error?: string;
}

async function processDraftKingsLeague(league: string, date: string): Promise<ProcessingResult> {
  try {
    console.log(`📊 Processing DraftKings odds for ${league} on ${date}`);
    const rows = await upsertOddsData(date, league, pg);
    console.log(`✅ DraftKings: Processed ${rows.length} odds for ${league}`);
    return {
      provider: 'draftkings',
      league,
      count: rows.length,
      success: true
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ DraftKings failed for ${league}:`, errorMsg);
    return {
      provider: 'draftkings',
      league,
      count: 0,
      success: false,
      error: errorMsg
    };
  }
}

async function processOddsApiLeague(league: string): Promise<ProcessingResult> {
  if (!ODDS_API_KEY) {
    console.log(`⚠️  Skipping The Odds API for ${league} - no API key configured`);
    return {
      provider: 'odds_api',
      league,
      count: 0,
      success: false,
      error: 'No API key configured'
    };
  }

  try {
    console.log(`📊 Processing The Odds API odds for ${league}`);
    const rows = await upsertOddsApiData(league, ODDS_API_KEY, pg);
    console.log(`✅ The Odds API: Processed ${rows.length} odds for ${league}`);
    return {
      provider: 'odds_api',
      league,
      count: rows.length,
      success: true
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ The Odds API failed for ${league}:`, errorMsg);
    return {
      provider: 'odds_api',
      league,
      count: 0,
      success: false,
      error: errorMsg
    };
  }
}

async function processLeague(league: string, date: string): Promise<void> {
  const jobKey = `${league}-${date}`;
  
  if (activeJobs.has(jobKey)) {
    console.log(`⏭️  Skipping ${league} - already processing`);
    return;
  }
  
  activeJobs.add(jobKey);
  
  try {
    console.log(`🔄 Processing odds for ${league} on ${date}`);
    
    // Process both providers concurrently
    const results = await Promise.allSettled([
      processDraftKingsLeague(league, date),
      processOddsApiLeague(league)
    ]);
    
    // Log summary
    const totalOdds = results
      .filter(r => r.status === 'fulfilled')
      .reduce((sum, r) => sum + r.value.count, 0);
    
    const successfulProviders = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.provider);
    
    console.log(`📈 ${league} summary: ${totalOdds} total odds from ${successfulProviders.length} providers (${successfulProviders.join(', ')})`);
    
  } catch (error) {
    console.error(`❌ Failed to process ${league}:`, error);
  } finally {
    activeJobs.delete(jobKey);
  }
}

// Get all supported leagues from both providers
function getAllSupportedLeagues(): string[] {
  const dkLeagues = Object.keys(DK_LEAGUES);
  const oddsApiLeagues = Object.keys(ODDS_API_SPORTS);
  
  // Combine and deduplicate leagues
  const allLeagues = [...new Set([...dkLeagues, ...oddsApiLeagues])];
  return allLeagues;
}

// Schedule odds scraping every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  const leagues = getAllSupportedLeagues();
  
  console.log(`🔄 Starting scrape for ${leagues.length} leagues across multiple providers`);
  
  // Process leagues concurrently with some delay to avoid rate limiting
  const promises = leagues.map((league, index) => 
    new Promise(resolve => 
      setTimeout(() => resolve(processLeague(league, today)), index * 2000) // 2 second delay between leagues
    )
  );
  
  await Promise.allSettled(promises);
  console.log('📊 Scrape cycle completed');
});

// Manual trigger endpoint (can be called via API)
export async function triggerManualScrape(league?: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  if (league) {
    await processLeague(league, today);
  } else {
    const leagues = getAllSupportedLeagues();
    console.log(`🔄 Manual scrape triggered for ${leagues.length} leagues`);
    
    for (const leagueKey of leagues) {
      await processLeague(leagueKey, today);
      // Small delay between leagues
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down worker...');
  await pg.end();
  process.exit(0);
});

const supportedLeagues = getAllSupportedLeagues();
console.log('🚀 Odds worker started');
console.log('📊 Monitoring leagues:', supportedLeagues.join(', '));
console.log('🏢 Providers: DraftKings' + (ODDS_API_KEY ? ', The Odds API (FanDuel, BetMGM, etc.)' : ''));
console.log('⏰ Scraping every 5 minutes');