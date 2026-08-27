# TypeScript library stack

A curried dagr stack for TypeScript libraries, extracted from
[`caeus/caeus.github.io`](https://github.com/caeus/caeus.github.io/tree/df44fa552979c8cb622490446ab39efa7a7eed56/stacks).

The first call supplies repository policy and returns a reusable stack function. The second call
declares the facts and intent of one library. The selected dagr target supplies the action. Tool
configuration is derived from all three.

```js
// dagr.typescript.js in the consuming repository
import typescript from '//stacks/typescript//dagr.stack.js'
import versions from '//config/dagr.versions.yaml'

export default typescript({
  base: '//packages/base:ci:node-pnpm',
  scope: 'internal',
  versions: versions.deps,
  testEnvironment: 'node',
})
```

```js
// packages/common/dagr.index.js
import stack from '//dagr.typescript.js'

export default stack({
  location: import.meta.dagr.location,
  version: '0.1.0',
  deps: [
    { npm: 'zod', at: 'prod' },
    { pkg: '//packages/contracts', at: 'prod' },
  ],
  metadata: {
    description: 'Shared domain types',
    license: 'MIT',
  },
})
```

## Configuration model

There is deliberately no canonical generated `package.json`, `tsconfig.json`, or Vitest config.
Each is a projection for one action.

| Kind | Meaning | TypeScript stack examples |
| --- | --- | --- |
| Fact | Information true independently of an action | logical location, version, declared dependencies, description |
| Intent | A choice the developer actually cares about | TypeScript library, test environment, production vs development dependency |
| Action | What is happening now | develop, typecheck, test, build, pack, publish |
| External policy | Information the stack cannot infer | base image target, package scope, dependency versions, registry location |
| Derived | Tool plumbing required to carry out the action | `private`, `rootDir`, `outDir`, `noEmit`, `main`, `types`, `exports`, `files` |

The rule is: if facts, intent, action, and external policy determine a value, that value is derived.
It must not also be independently configurable.

That has some important consequences:

- `metadata` is allowlisted passive information. Supplying `private`, `files`, `main`, `types`,
  `exports`, dependencies, scripts, `publishConfig`, or any other behavioral field fails with an
  explicit error.
- Compiler output and package entry points use one stack-owned output agreement. A consumer never
  has to make `outDir` agree with `files`, `main`, or `types`.
- Development and CI do not share a manifest merely because their current values look similar.
  Every target asks the projector for its own configuration.
- Registry visibility, authentication, provenance, and tags belong to the publishing location.
  They are not package inputs, and this stack never generates npm `access` configuration.

## Projections and targets

| Target | Projection | Materialized configuration | Publishable |
| --- | --- | --- | --- |
| `dev:sync` | `dev` | source-oriented package manifest, no-emit TypeScript, Vitest, Prettier | No |
| `ci:typecheck` | `typecheck` | source-oriented package manifest and no-emit TypeScript | No |
| `ci:test` | `test` | source-oriented package manifest, no-emit TypeScript, Vitest | No |
| `ci:build` | `build` | build manifest and emitting TypeScript config | No |
| `ci:pack` | `pack` | distribution manifest over build output | No |
| `publish:pack` | `publish` | distribution manifest over the same build output | Yes |

`dev:sync` exports only the `dev` projection. It includes test configuration because tests are part
of the local editing experience, but it does not export build, pack, or publish configuration.
Each CI target materializes its own projection inside its build image and does not consume files
checked into the repository.

`ci:pack` exists for local dagr package dependencies and remains `private: true`.
`publish:pack` is a publishing target, so its generated manifest has `private: false`. It produces
a publishable tarball but does not choose or contact a registry. The adapter for the selected
publishing location owns that operation and its visibility policy.

The stack passes `project(action)` to `transform(index, context)` so repository composition can add
new targets without reaching into raw package or TypeScript configuration.

## Generated-unit mapping

| Unit | Source |
| --- | --- |
| package `name` | derived from logical `location` and repository `scope` |
| package `version` | package fact |
| descriptive package metadata | package fact |
| package `type`, source entry point | TypeScript ESM library intent |
| package `private` | action: false only for the `publish` projection |
| package `main`, `types`, `exports`, `files` | source convention for development; compiler output agreement for distribution |
| package runtime dependencies | declared `prod` dependencies plus repository version policy |
| package development dependencies | declared `dev` dependencies plus tools required by the selected development/build action |
| package scripts | omitted; dagr targets encode actions |
| package `publishConfig` / npm `access` | omitted; publishing location policy |
| TypeScript `rootDir`, `include`, test exclusions | TypeScript library source and test conventions |
| TypeScript `outDir` | stack-owned output agreement shared with distribution package fields |
| TypeScript `noEmit`, `declaration` | action |
| TypeScript language/module settings | TypeScript ESM library stack policy |
| Vitest environment | repository test intent |
| Prettier settings | development stack policy |

## Inputs

`typescript(options)` accepts repository policy:

- `base`: target providing Node and pnpm. Defaults to `//packages/base:ci:node-pnpm`.
- `scope`: generated npm scope. Defaults to `internal`.
- `versions`: npm package version map.
- `ignore`: repository-specific dagr build-context exclusions.
- `testEnvironment`: meaningful test-runtime intent. Defaults to `node`.
- `transform(index, context)`: composition hook. Its context contains `project(action)`.

The returned stack accepts package facts and intent:

- `location`: normally `import.meta.dagr.location`.
- `version`: defaults to `0.1.0`.
- `deps`: `{ npm, at }` or `{ pkg, at }` dependencies, where `at` is `prod` or `dev`.
- `metadata`: non-derived package metadata such as description, license, repository, or keywords.

Packed libraries carry the transitive closure of local package tarballs.
