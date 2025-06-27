/**
 * TypeScript interfaces for KV analytics system
 */

export interface KVWriteMetrics {
  totalWrites: number;
  dailyWrites: number;
  hourlyRate: number;
  projectedDailyTotal: number;
  timeToNextReset: number;
  alertLevel: 'safe' | 'warning' | 'critical' | 'exceeded';
  breakdown: Record<string, number>; // by operation type
}

export interface DailyCounter {
  date: string; // YYYY-MM-DD format
  totalWrites: number;
  breakdown: Record<string, number>;
  lastUpdated: string; // ISO timestamp
}

export interface HourlyBucket {
  hour: string; // YYYY-MM-DD-HH format
  writes: number;
  breakdown: Record<string, number>;
  timestamp: string; // ISO timestamp
}

export interface CurrentSession {
  sessionWrites: number;
  sessionBreakdown: Record<string, number>;
  lastWrite: string; // ISO timestamp
  currentHour: string; // YYYY-MM-DD-HH format
}

export interface AnalyticsConfig {
  dailyLimit: number;
  warningThreshold: number; // percentage (0.75 = 75%)
  criticalThreshold: number; // percentage (0.90 = 90%)
  utcResetHour: number; // 0 for 0:00 UTC (9am KST)
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  dailyLimit: 1000,
  warningThreshold: 0.75,
  criticalThreshold: 0.90,
  utcResetHour: 0
}