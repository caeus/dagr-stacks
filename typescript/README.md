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
small calculation module. The modules are merged into one DAG before DI shakes and compiles the
requested roots.

The topology is graph-first, not manifest-first:

```text
conventions + external facts + selected target
                    |
                    v
              semantic nodes
                    |
                    v
         tool-specific field nodes
                    |
                    v
          assembled files and targets
```

Conventions are zero-dependency calculations, not hidden constants in a manifest generator. The
stack supplies them, and a stack author may replace an exceptional convention without making every
project configure it:

```js
typescript({ conventions: { sourceDirectory: 'source', outputDirectory: 'build' } })
```

That replacement changes `outputLayout`; `packageJson.main`, `packageJson.files`, and
`tsconfig.compilerOptions.outDir` then follow through their declared dependencies. Projects that
accept the convention say nothing.

Configuration files are assemblers, not indivisible calculation nodes. Every behavioral field that
participates in an invariant has its own path-shaped node. Tool-neutral nodes sit between intent and
tool fields:

| Semantic node | Derived tool fields |
| --- | --- |
| `outputLayout` | `tsconfig.compilerOptions.outDir` |
| `runtimeEntry` | `packageJson.main`, `packageJson.exports` |
| `declarationEntry` | `packageJson.types`, `packageJson.exports` |
| `emittedArtifacts` | `packageJson.files` |
| `sourceSet` | `tsconfig.include`, `tsconfig.exclude` |
| `sourceAlias` | `packageJson.imports`, `tsconfig.compilerOptions.paths`, `vite.resolve.alias` |

Neither tool is canonical. For example, `packageJson.main` is not calculated from
`tsconfig.compilerOptions.outDir`; both are projections of `outputLayout` and the relevant entry
semantics. `packageJson` and `tsconfig` only assemble their field nodes plus passive metadata.

The transform context exposes `calculations` as the graph structure. A dedicated inspection API is
intentionally left for later.

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

Capabilities contribute named dependency, configuration-field, and generated-file nodes. Aggregate
nodes declare the complete contribution lists as their incoming edges. A collision fails instead of
silently choosing whichever tool happened to run last.

The package declaration accepts only facts that cannot be derived: logical location, version,
dependencies, and passive metadata. `private`, output paths, exports, generated files, scripts, and
registry access are not package inputs. `private` becomes false only for `publish:pack`; the
publishing adapter still owns registry visibility and authentication.
