# dagr stacks

Reusable build stacks for [dagr](https://github.com/caeus/dagr).

A stack is a self-contained JavaScript factory for a project archetype. It returns the complete set
of dagr facets and targets needed by that archetype, while the consuming repository supplies what
makes a particular package different.

## Configuration model

Stacks accept project facts and developer intent. The selected target supplies the action, and the
stack combines those with irreducible external policy to derive tool configuration for that action.
Generated files are projections, not canonical project truth.

The calculation itself is an explicit DAG. Each node declares whether its value comes from external
configuration, from the selected target, or from a calculation over named dependency nodes. The
`ts-library` stack executes that DAG with the shared [`di`](di/) component rather than carrying a
second graph evaluator.

This means a stack owns consistency between tools. For example, a compiler output directory and a
package manifest's entry points and file list are one derived agreement, not unrelated consumer
options. Likewise, publishability comes from selecting a publishing target; it is not a second
boolean that can contradict the action. A publishing location owns registry visibility and other
location-specific policy.

See [`ts-library`](ts-library/) for the concrete fact, intent, action, external policy, and derived
configuration mapping.

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
