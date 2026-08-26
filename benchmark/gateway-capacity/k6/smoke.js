import { postCompletion, smokeThresholds } from './common.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: smokeThresholds,
};

export default function () {
  postCompletion(false, 'smoke');
}
