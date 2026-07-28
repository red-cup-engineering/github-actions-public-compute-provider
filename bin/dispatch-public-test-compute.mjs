#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { admitPublicTestDispatch, MAX_PATCH_BYTES, WORKFLOW_COMMIT, WORKFLOW_GIT_BLOB, WORKFLOW_PATH, WORKFLOW_REF, WORKFLOW_RELEASE_ID, WORKFLOW_SHA256 } from "../src/admission.mjs";

function usage() {
  return "usage: dispatch-public-test-compute OWNER/REPO 40_HEX_COMMIT [PATCH_FILE]";
}

async function github(path, { method = "GET", body } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "harmonious-union-public-compute-dispatcher",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} refused with ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

const [targetRepository, targetCommit, patchPath, ...extra] = process.argv.slice(2);
if (!targetRepository || !targetCommit || extra.length) throw new Error(usage());
const config = JSON.parse(await readFile(fileURLToPath(new URL("../content/config/github-public-compute.json", import.meta.url)), "utf8"));
const runnerRepository = process.env.GITHUB_PUBLIC_COMPUTE_REPO ?? config.runnerRepository;
const workflowBytes = await readFile(fileURLToPath(new URL(`../content/workflows/${basename(WORKFLOW_PATH)}`, import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (config.workflowRef !== WORKFLOW_REF || config.workflowCommit !== WORKFLOW_COMMIT || config.workflowGitBlob !== WORKFLOW_GIT_BLOB || config.workflowSha256 !== WORKFLOW_SHA256 || config.workflowReleaseId !== WORKFLOW_RELEASE_ID || sha256(workflowBytes) !== WORKFLOW_SHA256) throw new Error("local public-compute workflow binding is not the admitted immutable revision");

const patch = patchPath ? await readFile(patchPath) : Buffer.alloc(0);
if (patch.length > MAX_PATCH_BYTES) throw new Error(`patch exceeds ${MAX_PATCH_BYTES} bytes`);
const [runner, policy, target, commit, workflowRef, workflow, release] = await Promise.all([
  github(`/repos/${runnerRepository}`),
  github(`/repos/${runnerRepository}/actions/permissions`),
  github(`/repos/${targetRepository}`),
  github(`/repos/${targetRepository}/commits/${targetCommit}`),
  github(`/repos/${runnerRepository}/git/ref/tags/${encodeURIComponent(WORKFLOW_REF)}`),
  github(`/repos/${runnerRepository}/contents/${WORKFLOW_PATH}?ref=${WORKFLOW_COMMIT}`),
  github(`/repos/${runnerRepository}/releases/tags/${encodeURIComponent(WORKFLOW_REF)}`),
]);
if (commit.sha?.toLowerCase() !== targetCommit.toLowerCase()) throw new Error("target commit identity drifted");
const remoteWorkflow = workflow?.encoding === "base64" && typeof workflow.content === "string" ? Buffer.from(workflow.content.replace(/\s/gu, ""), "base64") : null;
if (workflowRef?.object?.type !== "commit" || workflowRef.object.sha !== WORKFLOW_COMMIT || workflow?.type !== "file" || workflow.sha !== WORKFLOW_GIT_BLOB || !remoteWorkflow || sha256(remoteWorkflow) !== WORKFLOW_SHA256 || !remoteWorkflow.equals(workflowBytes)) throw new Error("public-compute workflow tag or bytes drifted from the admitted revision");
const workflowReleaseImmutable = release?.id === WORKFLOW_RELEASE_ID && release.tag_name === WORKFLOW_REF && release.draft === false && release.immutable === true;
if (!workflowReleaseImmutable) throw new Error("public-compute workflow tag lacks its exact published immutable release");

const decision = admitPublicTestDispatch({
  runnerRepository,
  runnerVisibility: runner.visibility,
  actionsEnabled: policy.enabled,
  targetRepository,
  targetVisibility: target.visibility,
  targetCommit,
  patchBytes: patch.length,
  workflowPath: WORKFLOW_PATH,
  workflowRef: WORKFLOW_REF,
  workflowCommit: workflowRef.object.sha,
  workflowGitBlob: workflow.sha,
  workflowSha256: sha256(remoteWorkflow),
  workflowReleaseId: release.id,
  workflowReleaseImmutable,
});
if (!decision.admitted) throw new Error(`dispatch refused: ${decision.reason}`);

await github(`/repos/${runnerRepository}/actions/workflows/${encodeURIComponent(basename(WORKFLOW_PATH))}/dispatches`, {
  method: "POST",
  body: {
    ref: WORKFLOW_REF,
    inputs: {
      target_repository: decision.targetRepository,
      target_commit: decision.targetCommit,
      patch_base64: patch.toString("base64"),
    },
  },
});
process.stdout.write(`${JSON.stringify({
  type: "GitHubPublicTestComputeDispatchAccepted",
  runnerRepository,
  targetRepository: decision.targetRepository,
  targetCommit: decision.targetCommit,
  patchBytes: decision.patchBytes,
  workflowRef: decision.workflowRef,
  workflowCommit: decision.workflowCommit,
  workflowSha256: decision.workflowSha256,
  workflowReleaseId: decision.workflowReleaseId,
  runner: decision.runner,
  timeoutMinutes: decision.timeoutMinutes,
})}\n`);
