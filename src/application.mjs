/** Provider-owned native application export selected by a MetroPlat world instance.
 * FeltOS/MetroPlat owns the principal/office power gate and installed operation catalog;
 * this provider retains immutable public-workflow admission and the external action. */
import { dispatchPublicTestCompute, observePublicTestComputeRuns } from './dispatch.mjs';

export const application = Object.freeze({
  kind: 'metroplat.application/v1',
  operations(_binding, { configuration = {}, dispatch = dispatchPublicTestCompute, observeRuns = observePublicTestComputeRuns, environment = process.env } = {}) {
    if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)
      || Object.keys(configuration).length > 0) {
      throw new TypeError('Public test compute does not accept instance overrides of its immutable provider policy');
    }
    return Object.freeze([Object.freeze({
      verb: 'public-test-compute-dispatch',
      summary: 'Execute one bounded public-repository software test on the immutable free standard runner',
      description: 'Requires the current office grant; strictly public input, exact commit, immutable workflow and no paid runner',
      inputFormat: 'json', outputFormat: 'json',
      effects: { class: 'external', replay: 'coordinated', coordination: 'coordination-required', deterministic: 'unmeasured', totality: 'partial' },
      execute: input => dispatch(input, { environment }),
    }), Object.freeze({
      verb: 'public-test-compute-runs',
      summary: 'Read up to 20 recent runner results from the immutable public test workflow',
      inputFormat: 'json', outputFormat: 'json',
      effects: { class: 'external', replay: 'safe', coordination: 'coordination-free', deterministic: 'unmeasured', totality: 'partial' },
      execute: input => observeRuns(input, { environment }),
    })]);
  },
});
