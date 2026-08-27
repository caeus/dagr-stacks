# TypeScript library stack

A curried dagr stack for TypeScript libraries, extracted from
[`caeus/caeus.github.io`](https://github.com/caeus/caeus.github.io/tree/df44fa552979c8cb622490446ab39efa7a7eed56/stacks).

The first call configures repository policy and returns a reusable stack function. The second call
declares one package and produces its dagr facets and targets.

```js
// dagr.typescript.js in the consuming repository
import typescript from '//stacks/typescript//dagr.stack.js'
import versions from '//config/dagr.versions.yaml'

export default typescript({
  base: '//packages/base:ci:node-pnpm',
  scope: 'internal',
  versions: versions.deps,
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
})
```

## Repository configuration

`typescript(options)` accepts:

- `base`: target providing Node and pnpm. Defaults to `//packages/base:ci:node-pnpm`.
- `scope`: generated npm scope. Defaults to `internal`.
- `versions`: npm package version map.
- `ignore`: dagr build-context exclusions.
- `tsconfig` and `prettier`: generated configuration objects.
- `transform(index, context)`: final escape hatch for adding or changing facets and targets.

## Package declaration

The returned stack accepts:

- `location`: normally `import.meta.dagr.location`.
- `version`: defaults to `0.1.0`.
- `deps`: `{ npm, at }` or `{ pkg, at }` dependencies, where `at` is `prod` or `dev`.
- `packageJson`: shallow overrides for the generated package manifest.

It produces `config:manifest`, `dev:sync`, and the `ci:install`, `ci:build`, `ci:pack`,
and `ci:typecheck` targets. Packed libraries carry the transitive closure of local package
tarballs.
