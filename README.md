# dagr stacks

Reusable build stacks for [dagr](https://github.com/caeus/dagr).

A stack is a self-contained JavaScript factory for a project archetype. It returns the complete set
of dagr facets and targets needed by that archetype, while the consuming repository supplies what
makes a particular package different.

## Configuration model

Stacks accept project facts and developer intent, then calculate generated configuration and the
complete Dagr target index. Generated files are outputs, not canonical project truth.

The calculation itself is an explicit DAG. Each node comes from external configuration, target
intent, or a calculation over named dependency nodes. Targets collect into facets through DI tags;
facets collect into the root index. Target selection happens later, in Dagr, and never enters the
stack DI.

This means a stack owns consistency between tools. For example, a compiler output directory and a
package manifest's entry points and file list are one derived agreement, not unrelated consumer
options. Likewise, a publishing target derives a publishable manifest; publishability is not a
second boolean that can contradict it. A publishing location owns registry visibility and other
location-specific policy.

[`typescript`](typescript/) is the composable stack. Its library, Cloudflare worker, Vite React,
test, lint, format, and documentation modules merge into one explicit calculation DAG. `ts-library`
is retained as the earlier, target-parameterized implementation.

## Convention

Each top-level directory contains one independently consumable component. Build stacks expose:

```text
<stack-name>/
├── dagr.stack.js
└── ...
```

- `dagr.stack.js` is the stack's public entry point.
- Its default export is the stack factory.
- Everything needed by a stack lives inside its directory.
- Component directories contain only files consumers may mount; repository tests live in `tests/`.
- Consumers pin an exact commit and mount only the desired directory.
- Release tags are scoped by stack, for example `ts-library/v1.2.0`.

Supporting components use a descriptive `dagr.*.js` entry point instead.

A consuming repository mounts a stack under `stacks/<alias>` and imports across the mount boundary:

```js
import typescript from '//stacks/ts-library//dagr.stack.js'

const stack = typescript({
  base: '//packages/base:ci:node-pnpm',
  scope: 'internal',
})

export default stack({
  location: import.meta.dagr.location,
  deps: [{ npm: 'zod', at: 'prod' }],
})
```

The alias belongs to the consuming repository. The directory and commit being mounted are explicit,
reviewable build inputs.

## Available components

| Component | Description |
| --- | --- |
| [`di`](di/) | Immutable, synchronous dependency-injection graph for inline JavaScript composition |
| [`ts-library`](ts-library/) | Curried TypeScript library stack with generated manifests, build, pack, typecheck, and local dependency tarballs |

Stacks stay together here until one genuinely requires separate ownership, permissions, or release
infrastructure.
