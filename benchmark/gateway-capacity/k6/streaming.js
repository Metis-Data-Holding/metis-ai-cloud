import { formalSummaryTrendStats, postCompletion, streamingLoadThresholds } from './common.js';

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: formalSummaryTrendStats,
  thresholds: streamingLoadThresholds,
};

export default function () {
  postCompletion(true, 'streaming');
}
