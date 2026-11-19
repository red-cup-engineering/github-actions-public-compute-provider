# GitHub Actions Public Compute Provider

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This provider spends GitHub's free, unlimited standard-runner allowance for
public repositories on bounded software tests. It is not a general shell or a
durable server. Each dispatch names an immutable commit in a public repository
and may add one base64-encoded unified diff of at most 48 KiB. The workflow
chooses a known test harness and stops after 15 minutes.

Dispatch uses the independently owned `github-services-section` provider for
every GitHub REST read and deployment request. The caller supplies no raw
GitHub URL or request shape; provider credential custody is through
`GITHUB_SERVICES_TOKEN`.

Dispatch creates a GitHub deployment whose `ref` is the admitted 40-hex runner
commit. The provider verifies the remote commit, workflow Git blob and SHA-256
against its carried workflow before creating the deployment. The deployment uses
the dedicated `bounded-public-test` task and transient nonproduction environment,
with automatic merging disabled and an empty required-context list. The runner
validates the exact deployment SHA, task, environment and bounded payload before
running the public test harness. The caller needs repository Deployments write
permission in addition to the existing repository and Actions reads.

Patches through 8 KiB travel in the execution payload. Larger patches use up to
six input deployments whose distinct task skips execution. Each record holds a
bounded base64 segment. The execution request carries their exact IDs, original
byte count and SHA-256. The runner reads those public records from its own
repository, checks every source identity and segment, and verifies the assembled
patch before applying it. The accepted patch bound remains 48 KiB.

The accepted dispatch receipt includes GitHub's deployment ID. An uncertain POST
acknowledgement requires deployment readback before the caller retries. Run
observation selects the `deployment` event and exact admitted workflow commit.

The runner repository and its logs are public. Do not submit proprietary source,
secrets, personal data, or secret-bearing tests. The workflow uses no cache,
artifact, environment secret, third-party action, larger runner, or self-hosted
runner. The local dispatcher refuses unless GitHub reports both the runner and
target repositories public and Actions enabled on the runner.

## Native MetroPlat compute application

This provider exports `@red-cup-engineering/github-actions-public-compute-provider/application` as a `metroplat.application/v1` native application. A named MetroPlat world may select the existing provider directly in its `applications` declarations, without a separate per-app adapter:

```json
{
  "module": "@red-cup-engineering/github-actions-public-compute-provider/application",
  "export": "application"
}
```

The app publishes `public-test-compute-dispatch` and `public-test-compute-runs` operations to the world’s common CLI/HTTP/MCP operation catalog, subject to its original institutional actor/office admission. It accepts only `{"targetRepository":"owner/public-repo","targetCommit":"40-hex-commit"}`, optionally with `"patchBase64"` containing a canonical base64-encoded patch of no more than 49,152 bytes. There is no user-selected runner, arbitrary workflow or arbitrary GitHub endpoint; instance overrides are rejected.

The original `dispatch-public-test-compute` CLI remains available and now invokes the same `dispatchPublicTestCompute` library operation. Both check the exact installed local workflow and GitHub source identities through GitHub Services. An uncertain deployment acknowledgement requires readback before a retry. `GitHubPublicTestComputeDispatchAccepted` means that GitHub accepted dispatch, **not** that the runner began, tests passed, or a Semioverse recipient received its result. The companion read-only `public-test-compute-runs` operation consumes GitHub Services' existing `listRuns` capability to expose up to 20 recent workflow runs and their queued/completed/concluded states. It rejects a different runner, workflow or private repository; an incomplete run has `conclusion: null`, not a fabricated failure. The bounded run list provides candidate observations. The deployment ID in an accepted request identifies the deployment, and each run's conclusion records GitHub's runner outcome.

Do not select this application into a world, or claim it is live, until the native package containing this deployment transport has been released into that world’s immutable host dependency graph and the installed FeltOS/MetroPlat instance has accepted its application declaration. The application does not confer account credentials or actor rights. No private sources, secrets, paid runners or CircleCI jobs may be passed as public compute inputs.
