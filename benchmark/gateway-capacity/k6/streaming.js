import { postCompletion, streamingLoadThresholds } from './common.js';

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '30s',
  thresholds: streamingLoadThresholds,
};

export default function () {
  postCompletion(true, 'streaming');
}
