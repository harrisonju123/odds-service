# Local Development Setup

## 🚀 Quick Start

### 1. Setup Environment
```bash
# Copy environment variables
cp .env.example .env

# Edit .env with your credentials
# Required: DATABASE_URL (Supabase)
# Optional: ODDS_API_KEY (for FanDuel, BetMGM, etc.)
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Database
```bash
# Run migrations on your Supabase database
npm run migrate:up
```

### 4. Start Services
```bash
# Start both API and Worker
npm run dev

# Or start individually:
cd packages/api && npm run dev     # API on port 3000
cd packages/worker && npm run dev  # Background worker
```

## 📱 React Native Integration

### API Endpoints

**Base URL**: `http://localhost:3000` (or your local IP for device testing)

#### Core Endpoints:
- `GET /health` - Health check
- `GET /events?sport=nba&date=2024-01-01` - Get games with odds
- `GET /best-price?market_id=123` - Best odds for a market
- `GET /odds/history?outcome_id=456` - Odds history for charts
- `GET /sports` - Available sports/leagues
- `GET /providers` - Supported providers and bookmakers

### React Native Example

```typescript
// hooks/useOdds.ts
import { useState, useEffect } from 'react';

const API_BASE = __DEV__ 
  ? 'http://localhost:3000'  // iOS Simulator
  : 'http://10.0.2.2:3000';  // Android Emulator

export interface Event {
  id: number;
  sport: string;
  league: string;
  home: string;
  away: string;
  start_time: string;
  status: string;
  markets: Market[];
}

export interface Market {
  market_id: number;
  market_type: string;
  outcomes: Outcome[];
}

export interface Outcome {
  outcome_id: number;
  side: string;
  latest_price: number;
  latest_line?: number;
}

export const useOdds = (sport?: string, date?: string) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOdds();
  }, [sport, date]);

  const fetchOdds = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (sport) params.append('sport', sport);
      if (date) params.append('date', date);

      const response = await fetch(\`\${API_BASE}/events?\${params}\`);
      if (!response.ok) throw new Error('Failed to fetch odds');

      const data = await response.json();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => fetchOdds();

  return { events, loading, error, refresh };
};

// components/OddsScreen.tsx
import React from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useOdds } from '../hooks/useOdds';

export const OddsScreen = () => {
  const { events, loading, error, refresh } = useOdds('nba');

  const renderEvent = ({ item }: { item: Event }) => (
    <View style={styles.eventCard}>
      <Text style={styles.teams}>{item.away} @ {item.home}</Text>
      <Text style={styles.time}>
        {new Date(item.start_time).toLocaleDateString()}
      </Text>
      
      {item.markets?.map(market => (
        <View key={market.market_id} style={styles.market}>
          <Text style={styles.marketType}>{market.market_type}</Text>
          <View style={styles.outcomes}>
            {market.outcomes?.map(outcome => (
              <View key={outcome.outcome_id} style={styles.outcome}>
                <Text>{outcome.side}</Text>
                <Text style={styles.price}>
                  {outcome.latest_price > 0 ? '+' : ''}{outcome.latest_price}
                </Text>
                {outcome.latest_line && (
                  <Text style={styles.line}>{outcome.latest_line}</Text>
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      renderItem={renderEvent}
      keyExtractor={item => item.id.toString()}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refresh} />
      }
      style={styles.container}
    />
  );
};

const styles = {
  container: { flex: 1, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  eventCard: { backgroundColor: '#f5f5f5', padding: 16, marginBottom: 12, borderRadius: 8 },
  teams: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  time: { fontSize: 14, color: '#666', marginBottom: 12 },
  market: { marginBottom: 8 },
  marketType: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  outcomes: { flexDirection: 'row', justifyContent: 'space-around' },
  outcome: { alignItems: 'center', flex: 1 },
  price: { fontSize: 16, fontWeight: 'bold', color: '#007AFF' },
  line: { fontSize: 12, color: '#666' },
  error: { color: 'red', fontSize: 16 }
};
```

### Advanced Usage

```typescript
// hooks/useOddsHistory.ts - For charts
export const useOddsHistory = (outcomeId: number, provider?: string) => {
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    const fetchHistory = async () => {
      const params = new URLSearchParams({ outcome_id: outcomeId.toString() });
      if (provider) params.append('provider', provider);
      
      const response = await fetch(\`\${API_BASE}/odds/history?\${params}\`);
      const data = await response.json();
      setHistory(data);
    };
    
    fetchHistory();
  }, [outcomeId, provider]);
  
  return history;
};

// hooks/useBestPrice.ts - For best odds comparison
export const useBestPrice = (marketId: number) => {
  const [bestOdds, setBestOdds] = useState([]);
  
  useEffect(() => {
    const fetchBestPrice = async () => {
      const response = await fetch(\`\${API_BASE}/best-price?market_id=\${marketId}\`);
      const data = await response.json();
      setBestOdds(data);
    };
    
    fetchBestPrice();
  }, [marketId]);
  
  return bestOdds;
};
```

## 🔧 Development Tips

### Device Testing
For testing on physical devices, update your API base URL:

```typescript
// Get your local IP address
const getLocalIP = () => {
  // On macOS: ifconfig | grep "inet " | grep -v 127.0.0.1
  // Use your actual local IP (e.g., 192.168.1.100)
  return __DEV__ ? 'http://192.168.1.100:3000' : 'https://your-production-url.com';
};
```

### Real-time Updates
Since we removed WebSockets, use polling for real-time updates:

```typescript
// Auto-refresh every 30 seconds
useEffect(() => {
  const interval = setInterval(refresh, 30000);
  return () => clearInterval(interval);
}, []);
```

### Error Handling
```typescript
const fetchWithRetry = async (url: string, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      throw new Error(\`HTTP \${response.status}\`);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

## 🐳 Docker Development (Optional)

```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  api:
    build: 
      context: .
      dockerfile: packages/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=\${DATABASE_URL}
      - ODDS_API_KEY=\${ODDS_API_KEY}
    volumes:
      - ./packages/api:/app/packages/api
      - /app/packages/api/node_modules
    command: npm run dev

  worker:
    build:
      context: .
      dockerfile: packages/worker/Dockerfile
    environment:
      - DATABASE_URL=\${DATABASE_URL}
      - ODDS_API_KEY=\${ODDS_API_KEY}
    volumes:
      - ./packages/worker:/app/packages/worker
      - /app/packages/worker/node_modules
    command: npm run dev
```

```bash
# Run with Docker
docker-compose -f docker-compose.dev.yml up
```

## 📊 Testing the API

```bash
# Health check
curl http://localhost:3000/health

# Get NBA games
curl "http://localhost:3000/events?sport=nba"

# Get supported providers
curl http://localhost:3000/providers

# Trigger manual scrape
curl -X POST http://localhost:3000/scrape \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "odds_api", "league": "nba"}'
```

## 🛠 Troubleshooting

### Common Issues:

1. **CORS errors**: Make sure CORS is enabled in the API
2. **Connection refused**: Check if API is running on correct port
3. **Database errors**: Verify Supabase DATABASE_URL is correct
4. **No odds data**: Check if leagues are in season and API keys are valid

### Logs:
```bash
# Check API logs
cd packages/api && npm run dev

# Check worker logs  
cd packages/worker && npm run dev
```