# GitHub Actions Public Compute Provider

This provider spends GitHub's free, unlimited standard-runner allowance for
public repositories on bounded software tests. It is not a general shell or a
durable server. Each dispatch names an immutable commit in a public repository
and may add one base64-encoded unified diff of at most 48 KiB. The workflow
chooses a known test harness and stops after 15 minutes.

Dispatch uses the independently owned `github-services-section` provider for
every GitHub REST read and workflow dispatch. The caller supplies no raw
GitHub URL or request shape; provider credential custody is through
`GITHUB_SERVICES_TOKEN`.

Dispatch uses the `bounded-public-test-v1` tag only after resolving it to the
admitted commit and verifying both the Git blob identity and SHA-256 bytes of
the remote workflow against the provider-carried workflow. The tag is bound to
published immutable GitHub release `358118180`; GitHub makes that tag
unmovable and non-reusable at the server boundary. An absent or mutable
release, moved tag, or changed workflow fails closed before GitHub receives a
dispatch.

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

The original `dispatch-public-test-compute` CLI remains available and now invokes the same `dispatchPublicTestCompute` library operation. Both check the exact installed local workflow, the immutable remote release and GitHub source identities using the original admission code, through the original GitHub Services provider. Neither automatically retries an uncertain workflow dispatch acknowledgement. `GitHubPublicTestComputeDispatchAccepted` means that GitHub accepted dispatch, **not** that the runner began, tests passed, or a Semioverse recipient received its result. The companion read-only `public-test-compute-runs` operation consumes GitHub Services' existing `listRuns` capability to expose up to 20 recent workflow runs and their queued/completed/concluded states. It rejects a different runner, workflow or private repository; an incomplete run has `conclusion: null`, not a fabricated failure. The GitHub dispatch endpoint provides no correlated run ID, so the returned list is *candidate provider evidence*, not a proved association to the requesting actor or an independently accepted Semioverse outcome.

Do not select this application into a world, or claim it is live, until the original native `0.2.0` package has been released into that world’s immutable host dependency graph and the installed FeltOS/MetroPlat instance has accepted its application declaration. The application does not confer account credentials or actor rights. No private sources, secrets, paid runners or CircleCI jobs may be passed as public compute inputs.
