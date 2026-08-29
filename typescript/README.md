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

## DI keys

Keys are plain JavaScript strings. The exact graph depends on the selected archetype and
capabilities. Only the convention keys are accepted by `typescript({ conventions })`; the remaining
keys describe the internal calculation graph and are available to transforms through
`calculations.nodes`.

```js
typescript({
  transform(index, { calculations }) {
    for (const [name, definition] of Object.entries(calculations.nodes)) {
      console.log(name, definition.kind, definition.deps)
    }
    return index
  },
})
```

### Core keys

| Source | Keys |
| --- | --- |
| Conventions | `targetActions`, `developmentActions`, `distributionActions`, `emitActions`, `testSourceActions`, `vitestActions`, `vitestDependencyActions`, `vitestTypeActions`, `eslintActions`, `typedocActions`, `viteActions`, `devAction`, `publishAction`, `dependencyLocations`, `metadataFields`, `sourceDirectory`, `entryFile`, `outputDirectory`, `javascriptModuleFormat` |
| External package facts | `location`, `scope`, `version`, `deps`, `metadata`, `versions` |
| Selected context | `target` |
| Semantic calculations | `action`, `name`, `slug`, `validatedMetadata`, `sourceLayout`, `sourceEntry`, `outputLayout`, `distributionIntent`, `emissionIntent`, `testSourcesIncluded`, `sourceSet`, `runtimeEntry`, `declarationEntry`, `emittedArtifacts`, `publishable`, `sourceMapEmission`, `ambientTypes` |
| Feature aggregates | `featureToolPackages`, `featureRuntimePackages`, `featureAmbientTypes`, `featureGeneratedFiles`, `featureAllowBuilds` |

### Package and TypeScript projections

| Group | Keys |
| --- | --- |
| Dependency calculations | `dependencyEntries`, `toolDependencyEntries` |
| Package fields | `packageJson.name`, `packageJson.version`, `packageJson.type`, `packageJson.private`, `packageJson.main`, `packageJson.types`, `packageJson.exports`, `packageJson.files`, `packageJson.imports`, `packageJson.dependencies`, `packageJson.devDependencies` |
| Package assembly | `packageJson` |
| TypeScript fields | `tsconfig.extends`, `tsconfig.include`, `tsconfig.exclude`, `tsconfig.compilerOptions.rootDir`, `tsconfig.compilerOptions.outDir`, `tsconfig.compilerOptions.target`, `tsconfig.compilerOptions.lib`, `tsconfig.compilerOptions.module`, `tsconfig.compilerOptions.moduleResolution`, `tsconfig.compilerOptions.noEmit`, `tsconfig.compilerOptions.declaration`, `tsconfig.compilerOptions.sourceMap`, `tsconfig.compilerOptions.inlineSources`, `tsconfig.compilerOptions.types`, `tsconfig.compilerOptions.paths`, `tsconfig.compilerOptions.allowImportingTsExtensions`, `tsconfig.compilerOptions.moduleDetection`, `tsconfig.compilerOptions.jsx` |
| TypeScript assembly | `compilerOptions`, `tsconfig` |
| Final projection | `files`, `allowBuilds`, `output`, `projection` |

### Archetype keys

Every archetype provides the same tool-neutral contract:

| Kind | Keys |
| --- | --- |
| Archetype facts | `productKind`, `runtimeKind`, `languageTarget`, `sourceMapIntent`, `buildAssetInputs` |
| Archetype calculations | `moduleKind`, `moduleResolutionKind`, `standardLibraries`, `baseAmbientTypes`, `sourceAlias`, `archetypeToolPackages`, `archetypeRuntimePackages`, `archetypeAllowBuilds`, `buildAssets` |
| Additional `viteReact()` keys | `vite.plugins`, `vite.resolve.alias`, `viteConfig`, `viteGeneratedFiles` |

### Capability keys

| Capability | Keys |
| --- | --- |
| `prettier()` | `formatSemicolons`, `formatTabWidth`, `formatSingleQuotes`, `formatPrintWidth`, `formatTrailingCommas`, `prettierToolPackages`, `prettier.$schema`, `prettier.semi`, `prettier.tabWidth`, `prettier.singleQuote`, `prettier.printWidth`, `prettier.trailingComma`, `prettierConfig`, `prettierGeneratedFiles` |
| `vitest()` | `testEnvironment`, `testGlobalsIntent`, `testTypecheckIntent`, `vitestToolPackages`, `vitestAmbientTypes`, `vitest.test.environment`, `vitest.test.globals`, `vitest.test.typecheck.enabled`, `vitest.test.exclude`, `vitest.test.root`, `vitestConfig`, `vitestGeneratedFiles`, `vitestAllowBuilds` |
| `eslint()` | `lintFormattingIntent`, `lintExplicitReturnTypesIntent`, `eslintToolPackages`, `eslint.languageOptions.parser`, `eslint.languageOptions.parserOptions.project`, `eslint.files`, `eslint.testFiles`, `eslint.rules.no-undef`, `eslint.rules.no-redeclare`, `eslint.rules.@typescript-eslint/no-empty-object-type`, `eslint.rules.@typescript-eslint/no-unused-vars`, `eslint.rules.@typescript-eslint/explicit-function-return-type`, `eslint.rules.prettier/prettier`, `eslintRules`, `eslintConfig`, `eslintGeneratedFiles` |
| `typedoc()` | `documentationTitle`, `typedocToolPackages`, `typedoc.entryPoints`, `typedoc.name`, `typedoc.includeVersion`, `typedoc.excludeExternals`, `typedoc.excludePrivate`, `typedoc.excludeProtected`, `typedoc.exclude`, `typedocConfig`, `typedocGeneratedFiles` |

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
