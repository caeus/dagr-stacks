import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import di from '../di/dagr.di.js'
import {
  cloudflareWorker,
  eslint,
  library,
  prettier,
  typedoc,
  viteReact,
  vitest,
} from '../typescript/dagr.features.js'
import { typescriptProjector } from '../typescript/dagr.projections.js'

const versions = {
  '@cloudflare/workers-types': '4',
  '@eslint/js': '9',
  '@tailwindcss/vite': '4',
  '@tsconfig/strictest': '2',
  '@typescript-eslint/eslint-plugin': '8',
  '@typescript-eslint/parser': '8',
  '@types/node': '22',
  '@types/react': '19',
  '@types/react-dom': '19',
  '@vitejs/plugin-react': '4',
  'class-variance-authority': '0.7',
  'clsx': '2',
  'eslint': '9',
  'eslint-plugin-prettier': '5',
  'jsdom': '30',
  'prettier': '3',
  'react': '19',
  'react-dom': '19',
  'react-router-dom': '7',
  'tailwind-merge': '3',
  'tailwindcss': '4',
  'typedoc': '0.28',
  'typescript': '6',
  'vite': '5',
  'vitest': '3',
  'wrangler': '4',
}

const projector = features => typescriptProjector(di, {
  location: '//packages/example',
  scope: 'internal',
  version: '1.2.3',
  deps: [],
  metadata: { description: 'Example' },
  versions,
  features,
})

describe('composable TypeScript projections', () => {
  it('merges small calculation modules into one explicit DAG', () => {
    const features = [
      library({ runtime: 'node' }),
      prettier(),
      vitest({ globals: true }),
      eslint({ prettier: true }),
      typedoc(),
    ]
    const { graph, project } = projector(features)

    assert.equal(graph.owners.moduleKind, 'library')
    assert.equal(graph.owners.outputDirectory, 'typescript-conventions')
    assert.equal(graph.nodes.outputDirectory.kind, 'calculated')
    assert.deepEqual(graph.nodes.outputDirectory.deps, [])
    assert.equal(graph.owners['vitest.test.environment'], 'vitest')
    assert.equal(graph.owners['packageJson.main'], 'package-json-fields')
    assert.equal(graph.owners['tsconfig.compilerOptions.outDir'], 'tsconfig-fields')
    assert.deepEqual(graph.nodes['packageJson.main'].deps, ['runtimeEntry'])
    assert.deepEqual(graph.nodes['packageJson.files'].deps, [
      'productKind',
      'distributionIntent',
      'emittedArtifacts',
    ])
    assert.deepEqual(graph.nodes['tsconfig.compilerOptions.outDir'].deps, [
      'emissionIntent',
      'outputLayout',
    ])
    assert.equal(graph.nodes.libraryTsconfig, undefined)
    assert.equal(graph.nodes.featurePackageFields, undefined)

    const pack = project('ci:pack')
    assert.deepEqual(pack.semantics.outputLayout, {
      directory: 'dist',
      runtimeFile: 'dist/index.js',
      declarationFile: 'dist/index.d.ts',
    })
    assert.equal(pack.semantics.runtimeEntry, './dist/index.js')
    assert.equal(pack.semantics.declarationEntry, './dist/index.d.ts')
    assert.deepEqual(pack.semantics.emittedArtifacts, ['dist'])
    assert.equal(pack.packageJson.main, './dist/index.js')
    assert.equal(pack.packageJson.types, './dist/index.d.ts')
    assert.deepEqual(pack.packageJson.files, ['dist'])
    assert.equal(pack.tsconfig.compilerOptions.outDir, 'dist')
    assert.deepEqual(Object.keys(project('dev:sync').files), [
      'package.json',
      'tsconfig.json',
      '.prettierrc.json',
      'vitest.config.ts',
      'eslint.config.mjs',
      'typedoc.json',
    ])
  })

  it('treats conventions as replaceable roots of the semantic graph', () => {
    const { project } = typescriptProjector(di, {
      location: '//packages/example',
      scope: 'internal',
      version: '1.2.3',
      deps: [],
      metadata: {},
      versions,
      features: [library()],
      conventions: { sourceDirectory: 'source', outputDirectory: 'build' },
    })

    const pack = project('ci:pack')
    assert.deepEqual(pack.semantics.outputLayout, {
      directory: 'build',
      runtimeFile: 'build/index.js',
      declarationFile: 'build/index.d.ts',
    })
    assert.deepEqual(pack.semantics.sourceLayout, { directory: 'source', entry: 'index.ts' })
    assert.equal(project('ci:build').tsconfig.compilerOptions.outDir, 'build')
    assert.equal(project('ci:build').tsconfig.compilerOptions.rootDir, 'source')
    assert.deepEqual(pack.packageJson.files, ['build'])
    assert.equal(pack.packageJson.main, './build/index.js')
  })

  it('projects source conventions into every tool that consumes source paths', () => {
    const { project } = typescriptProjector(di, {
      location: '//packages/example',
      scope: 'internal',
      version: '1.2.3',
      deps: [],
      metadata: {},
      versions,
      features: [library(), eslint(), typedoc()],
      conventions: { sourceDirectory: 'source' },
    })

    const lint = project('ci:lint')
    const docs = project('ci:docs')
    assert.match(lint.files['eslint.config.mjs'], /source\/\*\*\/\*\.ts/)
    assert.deepEqual(docs.files['typedoc.json'].exclude, [
      'source/**/*.test.ts',
      'source/**/*.spec.ts',
    ])
  })

  it('derives Wyr-style library projections from intent and target', () => {
    const { project } = projector([
      library({ runtime: 'node', language: 'ES2023', sourceMaps: true, assets: ['README.md', 'LICENSE'] }),
      prettier({ semi: true, trailingComma: 'all' }),
      vitest({ globals: true, typecheck: true }),
      eslint({ prettier: true }),
      typedoc({ title: 'Wyr' }),
    ])
    const dev = project('dev:sync')
    const build = project('ci:build')
    const docs = project('ci:docs')
    const pack = project('ci:pack')
    const publish = project('publish:pack')

    assert.equal(dev.tsconfig.compilerOptions.module, 'NodeNext')
    assert.equal(dev.tsconfig.compilerOptions.noEmit, true)
    assert.deepEqual(dev.tsconfig.compilerOptions.types, ['node', 'vitest/globals'])
    assert.deepEqual(project('ci:typecheck').tsconfig.exclude, [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
    ])
    assert.equal(dev.files['.prettierrc.json'].semi, true)
    assert.deepEqual(project('ci:lint').files['.prettierrc.json'], {
      $schema: 'https://json.schemastore.org/prettierrc',
      semi: true,
      tabWidth: 2,
      singleQuote: true,
      printWidth: 100,
      trailingComma: 'all',
    })
    assert.match(project('ci:lint').files['eslint.config.mjs'], /"no-dupe-class-members":"off"/)
    assert.match(dev.files['vitest.config.ts'], /typecheck: \{ enabled: true \}/)
    assert.deepEqual(build.buildAssets, ['README.md', 'LICENSE'])
    assert.deepEqual(docs.tsconfig.exclude, ['src/**/*.test.ts', 'src/**/*.spec.ts'])
    assert.equal(build.tsconfig.compilerOptions.noEmit, false)
    assert.equal(build.tsconfig.compilerOptions.sourceMap, true)
    assert.equal(pack.packageJson.private, true)
    assert.equal(publish.packageJson.private, false)
    assert.equal(pack.packageJson.main, './dist/index.js')
  })

  it('derives worker policy instead of accepting raw tsconfig', () => {
    const { project } = projector([cloudflareWorker(), prettier()])
    const dev = project('dev:sync')

    assert.equal(dev.packageJson.imports['#*'], './src/*')
    assert.equal(dev.tsconfig.compilerOptions.moduleResolution, 'NodeNext')
    assert.deepEqual(dev.tsconfig.compilerOptions.types, ['@cloudflare/workers-types'])
    assert.deepEqual(dev.allowBuilds.sort(), ['sharp', 'workerd'])
  })

  it('derives the Vite React runtime, browser compiler, and test environment', () => {
    const { project } = projector([
      viteReact(),
      prettier(),
      eslint(),
      vitest({ environment: 'jsdom' }),
    ])
    const dev = project('dev:sync')
    const build = project('ci:build')

    assert.equal(dev.packageJson.dependencies.react, '19')
    assert.deepEqual(dev.tsconfig.compilerOptions.lib, ['ES2020', 'DOM', 'DOM.Iterable'])
    assert.match(dev.files['vitest.config.ts'], /environment: "jsdom"/)
    assert.deepEqual(build.buildAssets, ['index.html', 'public'])
    assert.deepEqual(build.output, { directory: 'dist' })
  })

  it('rejects derived package fields disguised as metadata', () => {
    const { project } = typescriptProjector(di, {
      location: '//packages/example',
      scope: 'internal',
      version: '1.2.3',
      metadata: { private: false },
      versions,
      features: [library()],
    })
    assert.throws(() => project('dev:sync'), /cannot configure non-metadata field private/)
  })
})
