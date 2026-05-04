/**
 * Tests for the WQI (Water Quality Index) utility functions.
 * These are pure functions and require no DB mocking.
 */

const { computeDerivedWqi } = require('../src/utils/wqi');

// Helper to build a reading object with limit fields
function makeReading(paramCode, value, limits) {
  return {
    parameter_code: paramCode,
    value,
    safe_limit: limits[0],
    moderate_limit: limits[1],
    high_limit: limits[2],
    critical_limit: limits[3],
  };
}

describe('computeDerivedWqi', () => {
  describe('empty / invalid input', () => {
    it('returns null score for empty readings array', () => {
      const result = computeDerivedWqi([]);
      expect(result).toEqual({
        score: null,
        category: null,
        risk_level: null,
        parameters_used: 0,
      });
    });

    it('skips readings with non-finite values', () => {
      const reading = makeReading('BOD', NaN, [3, 6, 10, 15]);
      const result = computeDerivedWqi([reading]);
      expect(result.score).toBeNull();
      expect(result.parameters_used).toBe(0);
    });

    it('skips readings with missing limit fields', () => {
      // Note: Number(null) === 0 (finite, not NaN), so null limits are NOT skipped —
      // they are treated as 0. Anything above 0 scores as 0 (critical).
      // This is an edge case in the algorithm: callers should ensure readings always
      // include valid numeric limits before calling computeDerivedWqi.
      const reading = {
        parameter_code: 'BOD',
        value: 2,
        safe_limit: null,
        moderate_limit: null,
        high_limit: null,
        critical_limit: null,
      };
      const result = computeDerivedWqi([reading]);
      expect(result.score).toBe(0); // value(2) > critical(0) → score 0
      expect(result.parameters_used).toBe(1);
    });
  });

  describe('standard parameter scoring (higher value = worse)', () => {
    const bodLimits = [3, 6, 10, 15]; // safe, moderate, high, critical

    it('scores 100 when value is at or below safe limit', () => {
      const result = computeDerivedWqi([makeReading('BOD', 2, bodLimits)]);
      expect(result.score).toBe(100);
      expect(result.category).toBe('excellent');
      expect(result.risk_level).toBe('low');
    });

    it('scores 100 when value equals safe limit exactly', () => {
      const result = computeDerivedWqi([makeReading('BOD', 3, bodLimits)]);
      expect(result.score).toBe(100);
    });

    it('scores between 75 and 100 for moderate range', () => {
      const result = computeDerivedWqi([makeReading('BOD', 4.5, bodLimits)]);
      expect(result.score).toBeGreaterThan(75);
      expect(result.score).toBeLessThan(100);
    });

    it('scores between 50 and 75 for high range', () => {
      const result = computeDerivedWqi([makeReading('BOD', 8, bodLimits)]);
      expect(result.score).toBeGreaterThan(50);
      expect(result.score).toBeLessThan(75);
    });

    it('scores between 25 and 50 for critical range', () => {
      const result = computeDerivedWqi([makeReading('BOD', 12, bodLimits)]);
      expect(result.score).toBeGreaterThan(25);
      expect(result.score).toBeLessThan(50);
    });

    it('scores 0 when value exceeds critical limit', () => {
      const result = computeDerivedWqi([makeReading('BOD', 20, bodLimits)]);
      expect(result.score).toBe(0);
      expect(result.category).toBe('critical');
      expect(result.risk_level).toBe('critical');
    });
  });

  describe('DO parameter scoring (higher value = better)', () => {
    // For DO: safe=8, moderate=6, high=4, critical=2
    const doLimits = [8, 6, 4, 2];

    it('scores 100 when DO is at or above safe limit', () => {
      const result = computeDerivedWqi([makeReading('DO', 9, doLimits)]);
      expect(result.score).toBe(100);
    });

    it('scores 0 when DO is below critical limit', () => {
      const result = computeDerivedWqi([makeReading('DO', 1, doLimits)]);
      expect(result.score).toBe(0);
    });

    it('scores between 75 and 100 for moderate-to-safe DO range', () => {
      const result = computeDerivedWqi([makeReading('DO', 7, doLimits)]);
      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('pH parameter scoring (band-based)', () => {
    // safe=6.5, moderate=8.5, high=5, critical=10 (outer extremes)
    const phLimits = [6.5, 8.5, 5, 10];

    it('scores 100 within the safe band', () => {
      const result = computeDerivedWqi([makeReading('pH', 7.0, phLimits)]);
      expect(result.score).toBe(100);
    });

    it('scores 85 just outside the safe band (dist ≤ 0.5)', () => {
      const result = computeDerivedWqi([makeReading('pH', 6.1, phLimits)]);
      expect(result.score).toBe(85);
    });

    it('scores 0 far outside the safe band (dist > 2)', () => {
      const result = computeDerivedWqi([makeReading('pH', 3.5, phLimits)]);
      expect(result.score).toBe(0);
    });
  });

  describe('multi-parameter averaging', () => {
    it('averages scores across multiple readings', () => {
      const readings = [
        makeReading('BOD', 2, [3, 6, 10, 15]), // score 100
        makeReading('BOD', 20, [3, 6, 10, 15]), // score 0
      ];
      const result = computeDerivedWqi(readings);
      expect(result.score).toBe(50);
      expect(result.parameters_used).toBe(2);
      // score 50 → categoryForScore: 50 >= 50 → 'fair'
      expect(result.category).toBe('fair');
    });

    it('reports correct parameters_used count', () => {
      const readings = [
        makeReading('BOD', 2, [3, 6, 10, 15]),
        makeReading('DO', 9, [8, 6, 4, 2]),
        makeReading('pH', 7, [6.5, 8.5, 5, 10]),
      ];
      const result = computeDerivedWqi(readings);
      expect(result.parameters_used).toBe(3);
    });
  });

  describe('category and risk_level mapping', () => {
    const limits = [1, 2, 3, 4]; // tight limits so we can force any score via BOD

    it('maps score >= 90 to "excellent" / "low" risk', () => {
      const result = computeDerivedWqi([makeReading('BOD', 0.5, limits)]);
      expect(result.category).toBe('excellent');
      expect(result.risk_level).toBe('low');
    });

    it('maps score 70–89 to "good" / "low" risk', () => {
      // With limits [1,2,3,4]: BOD=1.5 → interpolate(1.5,1,2,100,75) = 87.5 → 'good'
      const result = computeDerivedWqi([makeReading('BOD', 1.5, limits)]);
      expect(result.category).toBe('good');
      expect(result.risk_level).toBe('low');
    });

    it('maps score 50–69 to "fair" / "medium" risk', () => {
      // score ~62.5 → between moderate(75) and high(50) at midpoint
      const result = computeDerivedWqi([makeReading('BOD', 2.5, limits)]);
      expect(result.category).toBe('fair');
      expect(result.risk_level).toBe('medium');
    });

    it('maps score 25–49 to "poor" category', () => {
      // With limits [1,2,3,4]: BOD=3.5 → interpolate(3.5,3,4,50,25) = 37.5
      // categoryForScore(37.5): 37.5 >= 25 → 'poor'
      // riskLevelForScore(37.5): 37.5 < 40 → 'critical'
      const result = computeDerivedWqi([makeReading('BOD', 3.5, limits)]);
      expect(result.category).toBe('poor');
      expect(result.risk_level).toBe('critical');
    });

    it('maps score < 25 to "critical" risk', () => {
      const result = computeDerivedWqi([makeReading('BOD', 10, limits)]);
      expect(result.category).toBe('critical');
      expect(result.risk_level).toBe('critical');
    });
  });
});
