import { formalSummaryTrendStats, nonStreamLoadThresholds, postCompletion } from './common.js';

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: formalSummaryTrendStats,
  thresholds: nonStreamLoadThresholds,
};

export default function () {
  postCompletion(false, 'non-stream');
}
