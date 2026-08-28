# Composable TypeScript stack

This component turns project intent and a selected dagr target into generated tool configuration
and executable targets. Consumers mount only this directory.

```js
import typescript, {
  eslint,
  library,
  prettier,
  typedoc,
  vitest,
} from '//stacks/ts//dagr.stack.js'

const stack = typescript({
  base: '//packages/base:ci:node-pnpm',
  scope: 'caeus',
  versions,
})
  .with(library({ runtime: 'node', sourceMaps: true, assets: ['README.md', 'LICENSE'] }))
  .with(prettier({ semi: true, trailingComma: 'all' }))
  .with(vitest({ globals: true, typecheck: true }))
  .with(eslint({ prettier: true, explicitReturnTypes: true }))
  .with(typedoc({ title: 'Wyr' }))

export default stack({
  location: import.meta.dagr.location,
  version: '0.1.0',
  metadata: { license: 'MIT' },
})
```

`typescript()` owns the common projection and target machinery. Each `.with(...)` argument adds a
small calculation module. The modules are merged into one inspectable DAG before DI shakes and
compiles the requested `projection` root.

## Archetypes

Exactly one archetype is required:

- `library()` derives TypeScript build output, package entry points, tarballs, and publishability.
- `cloudflareWorker()` derives the worker runtime, compiler, package imports, and typecheck target.
- `viteReact()` derives the browser compiler, Vite build, React runtime, and host install target.

Archetypes express what is being built. They do not expose `rootDir`, `outDir`, package `files`, or
other values that only exist to make tools agree.

## Capabilities

- `prettier()` adds formatting policy and the development projection.
- `vitest()` adds test-runtime intent, generated configuration, and `ci:test`.
- `eslint()` adds lint policy, generated configuration, and `ci:lint`.
- `typedoc()` adds documentation intent, generated configuration, and `ci:docs`.

Capabilities contribute named dependency, configuration, file, and package nodes. Aggregate nodes
declare the complete contribution lists as their incoming edges. A collision fails instead of
silently choosing whichever tool happened to run last.

The package declaration accepts only facts that cannot be derived: logical location, version,
dependencies, and passive metadata. `private`, output paths, exports, generated files, scripts, and
registry access are not package inputs. `private` becomes false only for `publish:pack`; the
publishing adapter still owns registry visibility and authentication.
