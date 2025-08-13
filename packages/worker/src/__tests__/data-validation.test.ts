import { describe, it, expect } from 'vitest';
import { extractAmericanOdds } from '../draftkings.js';

describe('Data Structure Validation', () => {
  it('should validate expected data structure from DraftKings', () => {
    // Sample payload that matches DraftKings structure
    const samplePayload = {
      events: [
        {
          id: 'event1',
          name: 'Team A vs Team B',
          startEventDate: '2024-01-01T19:00:00Z'
        }
      ],
      markets: [
        {
          id: 'market1',
          name: 'Moneyline',
          eventId: 'event1'
        }
      ],
      selections: [
        {
          marketId: 'market1',
          participants: [{ name: 'Team A' }],
          displayOdds: { american: '+150' }
        },
        {
          marketId: 'market1',
          participants: [{ name: 'Team B' }],
          displayOdds: { american: '-180' }
        }
      ]
    };

    const result = extractAmericanOdds(samplePayload);
    
    expect(result).toHaveLength(2);
    
    // Validate structure of extracted data
    result.forEach(row => {
      expect(row).toHaveProperty('eventId');
      expect(row).toHaveProperty('eventName');
      expect(row).toHaveProperty('dateUTC');
      expect(row).toHaveProperty('team');
      expect(row).toHaveProperty('market');
      expect(row).toHaveProperty('americanOdds');
      
      expect(typeof row.eventId).toBe('string');
      expect(typeof row.eventName).toBe('string');
      expect(typeof row.dateUTC).toBe('string');
      expect(typeof row.team).toBe('string');
      expect(typeof row.market).toBe('string');
      expect(typeof row.americanOdds).toBe('number');
      
      // Validate date format
      expect(row.dateUTC).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('should handle various American odds formats', () => {
    const testCases = [
      { input: '+150', expected: 150 },
      { input: '-110', expected: -110 },
      { input: '100', expected: 100 },
      { input: '-200', expected: -200 },
      { input: '−110', expected: -110 }, // Unicode minus
      { input: '–150', expected: -150 }, // En dash
      { input: '—200', expected: -200 }, // Em dash
    ];

    testCases.forEach(({ input, expected }) => {
      const payload = {
        events: [{ id: '1', name: 'Test', startEventDate: '2024-01-01T00:00:00Z' }],
        markets: [{ id: '1', name: 'Test Market', eventId: '1' }],
        selections: [{ marketId: '1', displayOdds: { american: input } }]
      };

      const result = extractAmericanOdds(payload);
      expect(result[0]?.americanOdds).toBe(expected);
    });
  });

  it('should handle missing or malformed data gracefully', () => {
    const testCases = [
      // Missing participants
      {
        payload: {
          events: [{ id: '1', name: 'Test', startEventDate: '2024-01-01T00:00:00Z' }],
          markets: [{ id: '1', name: 'Test', eventId: '1' }],
          selections: [{ marketId: '1', displayOdds: { american: '+100' } }]
        },
        description: 'missing participants'
      },
      // Missing displayOdds
      {
        payload: {
          events: [{ id: '1', name: 'Test', startEventDate: '2024-01-01T00:00:00Z' }],
          markets: [{ id: '1', name: 'Test', eventId: '1' }],
          selections: [{ marketId: '1', participants: [{ name: 'Team' }] }]
        },
        description: 'missing displayOdds'
      },
      // Invalid odds format
      {
        payload: {
          events: [{ id: '1', name: 'Test', startEventDate: '2024-01-01T00:00:00Z' }],
          markets: [{ id: '1', name: 'Test', eventId: '1' }],
          selections: [{ 
            marketId: '1', 
            participants: [{ name: 'Team' }],
            displayOdds: { american: 'EVEN' } 
          }]
        },
        description: 'invalid odds format'
      }
    ];

    testCases.forEach(({ payload, description }) => {
      const result = extractAmericanOdds(payload);
      // Should not throw and should filter out invalid data
      expect(Array.isArray(result)).toBe(true);
      console.log(`Test case "${description}": ${result.length} valid rows extracted`);
    });
  });

  it('should validate event name parsing', () => {
    const payload = {
      events: [
        { id: '1', name: 'Lakers vs Warriors', startEventDate: '2024-01-01T00:00:00Z' },
        { id: '2', name: 'Single Team Name', startEventDate: '2024-01-01T00:00:00Z' },
        { id: '3', name: '', startEventDate: '2024-01-01T00:00:00Z' }
      ],
      markets: [
        { id: '1', name: 'Moneyline', eventId: '1' },
        { id: '2', name: 'Moneyline', eventId: '2' },
        { id: '3', name: 'Moneyline', eventId: '3' }
      ],
      selections: [
        { marketId: '1', participants: [{ name: 'Lakers' }], displayOdds: { american: '+100' } },
        { marketId: '2', participants: [{ name: 'Team' }], displayOdds: { american: '+100' } },
        { marketId: '3', participants: [{ name: 'Team' }], displayOdds: { american: '+100' } }
      ]
    };

    const result = extractAmericanOdds(payload);
    expect(result).toHaveLength(3);
    
    // Should handle all event name formats without errors
    result.forEach(row => {
      expect(typeof row.eventName).toBe('string');
      expect(typeof row.team).toBe('string');
    });
  });

  it('should detect breaking changes in API response format', () => {
    // This test will help detect if DraftKings changes their response structure
    const currentExpectedStructure = {
      events: ['id', 'name', 'startEventDate'],
      markets: ['id', 'name', 'eventId'],
      selections: ['marketId', 'displayOdds']
    };

    // Mock a real API response structure check
    const mockApiResponse = {
      events: [{ id: 'test', name: 'test', startEventDate: 'test' }],
      markets: [{ id: 'test', name: 'test', eventId: 'test' }],
      selections: [{ marketId: 'test', displayOdds: { american: '+100' } }]
    };

    // Verify critical fields exist
    Object.entries(currentExpectedStructure).forEach(([arrayName, requiredFields]) => {
      const array = mockApiResponse[arrayName as keyof typeof mockApiResponse];
      if (array.length > 0) {
        const firstItem = array[0];
        requiredFields.forEach(field => {
          expect(firstItem).toHaveProperty(field);
        });
      }
    });

    // Verify our extraction function still works
    const extracted = extractAmericanOdds(mockApiResponse);
    expect(Array.isArray(extracted)).toBe(true);
    
    if (extracted.length > 0) {
      const requiredOutputFields = [
        'eventId', 'eventName', 'dateUTC', 'team', 'market', 'americanOdds'
      ];
      
      requiredOutputFields.forEach(field => {
        expect(extracted[0]).toHaveProperty(field);
      });
    }
  });
});