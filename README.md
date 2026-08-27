# dagr stacks

Reusable build stacks for [dagr](https://github.com/caeus/dagr).

A stack is a self-contained JavaScript factory for a project archetype. It returns the complete set
of dagr facets and targets needed by that archetype, while the consuming repository supplies what
makes a particular package different.

## Convention

Each top-level directory contains one independently consumable stack:

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

A consuming repository mounts a stack under `stacks/<alias>` and imports across the mount boundary:

```js
import tsLibrary from '//stacks/ts-library//dagr.stack.js'

export default tsLibrary({
  name: 'common',
  deps: ['zod'],
})
```

The alias belongs to the consuming repository. The directory and commit being mounted are explicit,
reviewable build inputs.

## Available stacks

| Stack | Description |
| --- | --- |
| [`ts-library`](ts-library/) | Curried TypeScript library stack with generated manifests, build, pack, typecheck, and local dependency tarballs |

Stacks stay together here until one genuinely requires separate ownership, permissions, or release
infrastructure.
