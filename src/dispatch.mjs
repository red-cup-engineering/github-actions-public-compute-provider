/** The one public-workflow dispatch used by CLI and hosted, actor-admitted operations.
 * Admission is shared with the original provider; all GitHub I/O remains with GitHub Services.
 * Dispatch is non-idempotent: never automatically retry on an uncertain acknowledgement. */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { admittedRunnerRepository, admitPublicTestDispatch, MAX_PATCH_BYTES,
  WORKFLOW_COMMIT, WORKFLOW_GIT_BLOB, WORKFLOW_PATH, WORKFLOW_REF, WORKFLOW_TASK, WORKFLOW_ENVIRONMENT,
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

const INLINE_PATCH_BYTES = 8192;
const PATCH_CHUNK_CHARACTERS = 12000;
const DEPLOYMENT_PAYLOAD_BYTES = 16000;
const INPUT_TASK = 'bounded-public-test-input';

async function createAdmittedDeployment(github, runnerRepository, task, payload) {
  if (Buffer.byteLength(JSON.stringify(payload)) > DEPLOYMENT_PAYLOAD_BYTES) {
    throw new TypeError('public-compute deployment payload exceeds the admitted transport limit');
  }
  const deployment = await github.createDeployment(runnerRepository, {
    ref: WORKFLOW_COMMIT,
    auto_merge: false,
    required_contexts: [],
    task,
    environment: task,
    production_environment: false,
    transient_environment: true,
    payload,
  });
  if (!Number.isSafeInteger(deployment?.id) || deployment.id <= 0
    || deployment.sha !== WORKFLOW_COMMIT || deployment.ref !== WORKFLOW_COMMIT
    || deployment.task !== task || deployment.environment !== task
    || deployment.production_environment !== false || deployment.transient_environment !== true
    || !isDeepStrictEqual(deployment.payload, payload)) {
    throw new Error('public-compute deployment acknowledgement is invalid or drifted');
  }
  return deployment;
}

async function deploymentPatch(patch, patchBase64, github, runnerRepository, sha256Hex) {
  if (patch.length <= INLINE_PATCH_BYTES) return {patch_base64: patchBase64};
  const ids = [];
  // Input records select the same immutable source, and their distinct task skips
  // the runner. Only the final admitted deployment can execute the test harness.
  for (let offset = 0; offset < patchBase64.length; offset += PATCH_CHUNK_CHARACTERS) {
    const deployment = await createAdmittedDeployment(github, runnerRepository, INPUT_TASK, {
      index: ids.length,
      data: patchBase64.slice(offset, offset + PATCH_CHUNK_CHARACTERS),
    });
    ids.push(deployment.id);
  }
  return {patch_deployment_ids: ids, patch_sha256: sha256Hex(patch), patch_bytes: patch.length};
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
  // Provider-carried bytes and exact Git object identities establish the workflow contract.
  const configuration = JSON.parse(await read(CONFIG_FILE, 'utf8'));
  const runnerRepository = admittedRunnerRepository(configuration, environment);
  const workflowBytes = await read(WORKFLOW_FILE);
  const sha256Hex = hashPort ?? (await import('@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity')).sha256Hex;
  if (configuration.workflowRef !== WORKFLOW_REF || configuration.workflowCommit !== WORKFLOW_COMMIT
    || configuration.workflowGitBlob !== WORKFLOW_GIT_BLOB || configuration.workflowSha256 !== WORKFLOW_SHA256
    || configuration.workflowTask !== WORKFLOW_TASK || configuration.workflowEnvironment !== WORKFLOW_ENVIRONMENT
    || sha256Hex(workflowBytes) !== WORKFLOW_SHA256) {
    throw new Error('local public-compute workflow binding is not the admitted immutable revision');
  }
  const github = githubPort ?? (await import('@red-cup-engineering/github-services-section')).githubApi();
  const [runner, policy, target, commit, workflowCommit, workflow] = await Promise.all([
    github.getRepo(runnerRepository), github.getActionsPermissions(runnerRepository),
    github.getRepo(targetRepository), github.getCommit(targetRepository, targetCommit),
    github.getCommit(runnerRepository, WORKFLOW_COMMIT),
    github.getContentRecord(runnerRepository, WORKFLOW_COMMIT, WORKFLOW_PATH),
  ]);
  if (commit.sha?.toLowerCase() !== targetCommit.toLowerCase()) throw new Error('target commit identity drifted');
  const remoteWorkflow = workflow?.encoding === 'base64' && typeof workflow.content === 'string'
    ? Buffer.from(workflow.content.replace(/\s/gu, ''), 'base64') : null;
  if (workflowCommit?.sha !== WORKFLOW_COMMIT || workflow?.type !== 'file'
    || workflow.sha !== WORKFLOW_GIT_BLOB || !remoteWorkflow
    || sha256Hex(remoteWorkflow) !== WORKFLOW_SHA256 || !remoteWorkflow.equals(workflowBytes)) {
    throw new Error('public-compute workflow commit or bytes drifted from the admitted revision');
  }
  const decision = admitPublicTestDispatch({
    runnerRepository, runnerVisibility: runner.visibility, actionsEnabled: policy.enabled,
    targetRepository, targetVisibility: target.visibility, targetCommit,
    patchBytes: patch.length, workflowPath: WORKFLOW_PATH, workflowRef: WORKFLOW_REF,
    workflowCommit: workflowCommit.sha, workflowGitBlob: workflow.sha,
    workflowSha256: sha256Hex(remoteWorkflow),
  });
  if (!decision.admitted) throw new Error(`dispatch refused: ${decision.reason}`);
  // The exact commit selects workflow source. A deployment acknowledgement has an ID,
  // but an uncertain POST acknowledgement still requires readback before a caller retries.
  const patchPayload = await deploymentPatch(patch, patchBase64, github, runnerRepository, sha256Hex);
  const deployment = await createAdmittedDeployment(github, runnerRepository, WORKFLOW_TASK, {
    target_repository: decision.targetRepository,
    target_commit: decision.targetCommit,
    ...patchPayload,
  });
  return Object.freeze({
    type: 'GitHubPublicTestComputeDispatchAccepted', runnerRepository,
    targetRepository: decision.targetRepository, targetCommit: decision.targetCommit,
    patchBytes: decision.patchBytes, workflowRef: decision.workflowRef,
    workflowCommit: decision.workflowCommit, workflowSha256: decision.workflowSha256,
    deploymentId: deployment.id, runner: decision.runner,
    timeoutMinutes: decision.timeoutMinutes,
  });
}

/** Read recent outcomes from the original immutable public workflow.
 * This is an actual bounded provider read, not an attribution of runs to a
 * requesting actor. A deployment ID identifies an accepted request, while the
 * bounded run list remains a collection of candidate observations.
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
  const observed = await github.listRuns(runnerRepository, basename(WORKFLOW_PATH), 20, {
    event: 'deployment', headSha: WORKFLOW_COMMIT,
  });
  if (!Array.isArray(observed) || observed.length > 20 || observed.some(run =>
    !Number.isSafeInteger(run?.id) || run.id <= 0 || typeof run.status !== 'string'
    || run.event !== 'deployment' || run.headSha !== WORKFLOW_COMMIT
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
