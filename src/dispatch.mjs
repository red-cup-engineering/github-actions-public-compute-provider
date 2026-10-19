/** The one public-workflow dispatch used by CLI and hosted, actor-admitted operations.
 * Admission is shared with the original provider; all GitHub I/O remains with GitHub Services.
 * Dispatch is non-idempotent: never automatically retry on an uncertain acknowledgement. */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admittedRunnerRepository, admitPublicTestDispatch, MAX_PATCH_BYTES,
  WORKFLOW_COMMIT, WORKFLOW_GIT_BLOB, WORKFLOW_PATH, WORKFLOW_REF, WORKFLOW_RELEASE_ID,
  WORKFLOW_SHA256 } from './admission.mjs';

const CONFIG_FILE = fileURLToPath(new URL('../content/config/github-public-compute.json', import.meta.url));
const WORKFLOW_FILE = fileURLToPath(new URL(`../content/workflows/${basename(WORKFLOW_PATH)}`, import.meta.url));
const COMMIT = /^[\da-f]{40}$/iu;
const REPOSITORY = /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/u;

function admissionInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['targetRepository','targetCommit','patchBase64'].includes(key))
    || typeof input.targetRepository !== 'string' || !REPOSITORY.test(input.targetRepository)
    || typeof input.targetCommit !== 'string' || !COMMIT.test(input.targetCommit)) {
    throw new TypeError('Public test compute requires an exact public owner/repository and 40-hex commit');
  }
  const patchBase64 = input.patchBase64 ?? '';
  if (typeof patchBase64 === 'string' && patchBase64.length > 4 * Math.ceil(MAX_PATCH_BYTES / 3))
    throw new TypeError(`Public test compute patch exceeds ${MAX_PATCH_BYTES} bytes`);
  if (typeof patchBase64 !== 'string' || (patchBase64.length !== 0 &&
    (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(patchBase64)))) {
    throw new TypeError('Public test compute patch must be canonical base64');
  }
  const patch = Buffer.from(patchBase64, 'base64');
  if (patch.toString('base64') !== patchBase64) throw new TypeError('Public test compute patch must be canonical base64');
  if (patch.length > MAX_PATCH_BYTES) throw new TypeError(`Public test compute patch exceeds ${MAX_PATCH_BYTES} bytes`);
  return { targetRepository: input.targetRepository, targetCommit: input.targetCommit, patch, patchBase64 };
}

/** Perform one admitted external workflow dispatch; no fallback provider or retry is attempted.
 * Ports are selected by the trusted installed host, never from the operation request. */
export async function dispatchPublicTestCompute(input, {
  environment = process.env,
  read = readFile,
  github: githubPort,
  sha256Hex: hashPort,
} = {}) {
  const { targetRepository, targetCommit, patch, patchBase64 } = admissionInput(input);
  // Local release bytes, not a remotely supplied workflow URL or checkout, establish the contract.
  const configuration = JSON.parse(await read(CONFIG_FILE, 'utf8'));
  const runnerRepository = admittedRunnerRepository(configuration, environment);
  const workflowBytes = await read(WORKFLOW_FILE);
  const sha256Hex = hashPort ?? (await import('@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity')).sha256Hex;
  if (configuration.workflowRef !== WORKFLOW_REF || configuration.workflowCommit !== WORKFLOW_COMMIT
    || configuration.workflowGitBlob !== WORKFLOW_GIT_BLOB || configuration.workflowSha256 !== WORKFLOW_SHA256
    || configuration.workflowReleaseId !== WORKFLOW_RELEASE_ID || sha256Hex(workflowBytes) !== WORKFLOW_SHA256) {
    throw new Error('local public-compute workflow binding is not the admitted immutable revision');
  }
  const github = githubPort ?? (await import('@red-cup-engineering/github-services-section')).githubApi();
  const [runner, policy, target, commit, workflowRef, workflow, release] = await Promise.all([
    github.getRepo(runnerRepository), github.getActionsPermissions(runnerRepository),
    github.getRepo(targetRepository), github.getCommit(targetRepository, targetCommit),
    github.getTagRef(runnerRepository, WORKFLOW_REF),
    github.getContentRecord(runnerRepository, WORKFLOW_COMMIT, WORKFLOW_PATH),
    github.getReleaseByTag(runnerRepository, WORKFLOW_REF),
  ]);
  if (commit.sha?.toLowerCase() !== targetCommit.toLowerCase()) throw new Error('target commit identity drifted');
  const remoteWorkflow = workflow?.encoding === 'base64' && typeof workflow.content === 'string'
    ? Buffer.from(workflow.content.replace(/\s/gu, ''), 'base64') : null;
  if (workflowRef?.object?.type !== 'commit' || workflowRef.object.sha !== WORKFLOW_COMMIT
    || workflow?.type !== 'file' || workflow.sha !== WORKFLOW_GIT_BLOB || !remoteWorkflow
    || sha256Hex(remoteWorkflow) !== WORKFLOW_SHA256 || !remoteWorkflow.equals(workflowBytes)) {
    throw new Error('public-compute workflow tag or bytes drifted from the admitted revision');
  }
  const immutable = release?.id === WORKFLOW_RELEASE_ID && release.tag_name === WORKFLOW_REF
    && release.draft === false && release.immutable === true;
  if (!immutable) throw new Error('public-compute workflow tag lacks its exact published immutable release');
  const decision = admitPublicTestDispatch({
    runnerRepository, runnerVisibility: runner.visibility, actionsEnabled: policy.enabled,
    targetRepository, targetVisibility: target.visibility, targetCommit,
    patchBytes: patch.length, workflowPath: WORKFLOW_PATH, workflowRef: WORKFLOW_REF,
    workflowCommit: workflowRef.object.sha, workflowGitBlob: workflow.sha,
    workflowSha256: sha256Hex(remoteWorkflow), workflowReleaseId: release.id,
    workflowReleaseImmutable: immutable,
  });
  if (!decision.admitted) throw new Error(`dispatch refused: ${decision.reason}`);
  // GitHub workflow dispatch does not supply an idempotency key or job ID here.
  // A failed/unknown acknowledgement requires readback by the original work owner, not replay.
  await github.dispatchWorkflow(runnerRepository, basename(WORKFLOW_PATH), WORKFLOW_REF, {
    target_repository: decision.targetRepository,
    target_commit: decision.targetCommit,
    patch_base64: patchBase64,
  });
  return Object.freeze({
    type: 'GitHubPublicTestComputeDispatchAccepted', runnerRepository,
    targetRepository: decision.targetRepository, targetCommit: decision.targetCommit,
    patchBytes: decision.patchBytes, workflowRef: decision.workflowRef,
    workflowCommit: decision.workflowCommit, workflowSha256: decision.workflowSha256,
    workflowReleaseId: decision.workflowReleaseId, runner: decision.runner,
    timeoutMinutes: decision.timeoutMinutes,
  });
}

/** Read recent outcomes from the original immutable public workflow.
 * This is an actual bounded provider read, not an attribution of runs to a
 * requesting actor: GitHub dispatch does not return a correlated run ID.
 * Never infer success from an absent conclusion or a run that is still queued. */
export async function observePublicTestComputeRuns(input = {}, {
  environment = process.env,
  read = readFile,
  github: githubPort,
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)
    throw new TypeError('Public test compute runs accepts no caller-selected repository or workflow');
  const config = JSON.parse(await read(CONFIG_FILE, 'utf8'));
  const runnerRepository = admittedRunnerRepository(config, environment);
  const github = githubPort ?? (await import('@red-cup-engineering/github-services-section')).githubApi();
  const runner = await github.getRepo(runnerRepository);
  if (runner?.visibility !== 'public')
    throw new TypeError('Public test compute runs requires its original public runner repository');
  const observed = await github.listRuns(runnerRepository, basename(WORKFLOW_PATH), 20);
  if (!Array.isArray(observed) || observed.length > 20 || observed.some(run =>
    !Number.isSafeInteger(run?.id) || run.id <= 0 || typeof run.status !== 'string'
    || (run.conclusion !== null && run.conclusion !== undefined && typeof run.conclusion !== 'string')))
    throw new TypeError('GitHub public test compute returned invalid bounded run observations');
  return Object.freeze({
    type: 'GitHubPublicTestComputeRunsObserved',
    runnerRepository, workflowRef: WORKFLOW_REF, workflowCommit: WORKFLOW_COMMIT,
    // GitHub's completion describes a runner conclusion; it does not admit
    // independent customer acceptance or establish the original dispatch actor.
    runs: Object.freeze(observed.map(run => Object.freeze({
      runId: run.id, status: run.status, conclusion: run.conclusion ?? null,
      createdAt: run.createdAt ?? null, displayTitle: run.displayTitle ?? null,
    }))),
  });
}
