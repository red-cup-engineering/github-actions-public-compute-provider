export const MAX_PATCH_BYTES = 49_152;
export const WORKFLOW_PATH = ".github/workflows/bounded-public-test.yml";
export const WORKFLOW_REF = "bounded-public-test-v1";
export const WORKFLOW_COMMIT = "369a60cb1cb9b032a47286c0fe553c1f8a8aa9bd";
export const WORKFLOW_GIT_BLOB = "5a1d9ade97390753e9fdc1b3c1fede0f45fc3b94";
export const WORKFLOW_SHA256 = "873c857cca451014e3e24a1e8d30b3e279d40a7b1cf18b3cc38958ece806717f";
export const WORKFLOW_RELEASE_ID = 358_118_180;

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/i;

function refuse(reason) {
  return Object.freeze({ admitted: false, reason });
}

export function admitPublicTestDispatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return refuse("invalid-request");
  if (!REPOSITORY.test(input.runnerRepository ?? "")) return refuse("invalid-runner-repository");
  if (input.runnerVisibility !== "public") return refuse("runner-not-public");
  if (input.actionsEnabled !== true) return refuse("runner-actions-disabled");
  if (!REPOSITORY.test(input.targetRepository ?? "")) return refuse("invalid-target-repository");
  if (input.targetVisibility !== "public") return refuse("target-not-public");
  if (!COMMIT.test(input.targetCommit ?? "")) return refuse("target-commit-not-immutable");
  if (!Number.isInteger(input.patchBytes) || input.patchBytes < 0) return refuse("invalid-patch-size");
  if (input.patchBytes > MAX_PATCH_BYTES) return refuse("patch-too-large");
  if (input.workflowPath !== WORKFLOW_PATH) return refuse("workflow-not-admitted");
  if (input.workflowRef !== WORKFLOW_REF) return refuse("workflow-ref-not-admitted");
  if (input.workflowCommit !== WORKFLOW_COMMIT) return refuse("workflow-commit-not-admitted");
  if (input.workflowGitBlob !== WORKFLOW_GIT_BLOB || input.workflowSha256 !== WORKFLOW_SHA256) return refuse("workflow-bytes-not-admitted");
  if (input.workflowReleaseId !== WORKFLOW_RELEASE_ID || input.workflowReleaseImmutable !== true) return refuse("workflow-release-not-immutable");
  return Object.freeze({
    admitted: true,
    runnerRepository: input.runnerRepository,
    targetRepository: input.targetRepository,
    targetCommit: input.targetCommit.toLowerCase(),
    patchBytes: input.patchBytes,
    workflowPath: WORKFLOW_PATH,
    workflowRef: WORKFLOW_REF,
    workflowCommit: WORKFLOW_COMMIT,
    workflowGitBlob: WORKFLOW_GIT_BLOB,
    workflowSha256: WORKFLOW_SHA256,
    workflowReleaseId: WORKFLOW_RELEASE_ID,
    runner: "ubuntu-latest",
    timeoutMinutes: 15,
  });
}
