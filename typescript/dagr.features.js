import { calculated, calculationModule, external } from './dagr.graph.js'

const freeze = value => Object.freeze(value)

const feature = (name, role, intent, module, execution = {}) => {
  const frozenIntent = freeze({ ...intent })
  const externalValues = Object.fromEntries(
    Object.entries(module.nodes)
      .filter(([, definition]) => definition.kind === 'external')
      .map(([nodeName]) => [nodeName, frozenIntent]),
  )
  return freeze({
    name,
    role,
    intent: frozenIntent,
    externalValues: freeze(externalValues),
    module,
    execution: freeze({ ...execution }),
  })
}

const hasAction = (actions, action) => actions.includes(action)

const prettierDefaults = freeze({
  $schema: 'https://json.schemastore.org/prettierrc',
  semi: false,
  tabWidth: 2,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'none',
})

export function library({
  runtime = 'portable',
  language = runtime === 'node' ? 'ES2023' : 'ES2022',
  sourceMaps = false,
  assets = [],
} = {}) {
  if (!['portable', 'node'].includes(runtime)) {
    throw new Error(`library runtime must be portable or node, got ${JSON.stringify(runtime)}`)
  }
  const intent = { runtime, language, sourceMaps, assets: [...assets] }
  const module = calculationModule('library', {
    libraryIntent: external(),
    libraryToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action) ? ['@tsconfig/strictest', 'typescript'] : []),
    libraryPackageFields: calculated(
      ['action', 'distributionActions', 'sourceImport', 'outputImport', 'outputTypes', 'outputDirectory'],
      (action, actions, sourceImport, outputImport, outputTypes, outputDirectory) => {
        const distribution = hasAction(actions, action)
        const importPath = distribution ? outputImport : sourceImport
        const typesPath = distribution ? outputTypes : sourceImport
        return {
          main: importPath,
          types: typesPath,
          exports: { '.': { types: typesPath, import: importPath } },
          ...(distribution ? { files: [outputDirectory] } : {}),
        }
      },
    ),
    libraryTsconfig: calculated(
      ['action', 'emitActions', 'libraryIntent', 'sourceDirectory', 'outputDirectory'],
      (action, actions, options, sourceDirectory, outputDirectory) => {
        const emit = hasAction(actions, action)
        const node = options.runtime === 'node'
        return {
          extends: '@tsconfig/strictest/tsconfig.json',
          include: [`${sourceDirectory}/**/*.ts`],
          ...(emit ? { exclude: [`${sourceDirectory}/**/*.test.ts`, `${sourceDirectory}/**/*.spec.ts`] } : {}),
          compilerOptions: {
            rootDir: sourceDirectory,
            target: options.language,
            lib: [options.language],
            module: node ? 'NodeNext' : 'ESNext',
            moduleResolution: node ? 'NodeNext' : 'Bundler',
            ...(options.sourceMaps ? { sourceMap: true, inlineSources: true } : {}),
            ...(emit
              ? { outDir: outputDirectory, declaration: true, noEmit: false }
              : { noEmit: true }),
          },
        }
      },
    ),
    libraryOutput: calculated(
      ['outputDirectory', 'outputImport', 'outputTypes'],
      (directory, importPath, types) => ({ directory, import: importPath, types }),
    ),
    libraryBuildAssets: calculated(['libraryIntent'], options => options.assets),
  }, {
    toolPackages: ['libraryToolPackages'],
    packageFields: ['libraryPackageFields'],
    tsconfig: ['libraryTsconfig'],
    output: ['libraryOutput'],
    buildAssets: ['libraryBuildAssets'],
  })

  return feature('library', 'archetype', intent, module, {
    typecheck: true,
    build: 'tsc',
    pack: true,
  })
}

export function cloudflareWorker({ language = 'ES2022' } = {}) {
  const intent = { language }
  const module = calculationModule('cloudflare-worker', {
    workerIntent: external(),
    workerToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@cloudflare/workers-types', 'typescript', 'wrangler']
        : []),
    workerPackageFields: calculated([], () => ({ imports: { '#*': './src/*' } })),
    workerTsconfig: calculated(['workerIntent', 'sourceDirectory'], (options, sourceDirectory) => ({
      extends: '@tsconfig/strictest/tsconfig.json',
      include: [`${sourceDirectory}/**/*`],
      compilerOptions: {
        rootDir: sourceDirectory,
        target: options.language,
        lib: [options.language],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        types: ['@cloudflare/workers-types'],
        paths: { '#*': [`./${sourceDirectory}/*`] },
      },
    })),
    workerAllowBuilds: calculated([], () => ['sharp', 'workerd']),
  }, {
    toolPackages: ['workerToolPackages'],
    packageFields: ['workerPackageFields'],
    tsconfig: ['workerTsconfig'],
    allowBuilds: ['workerAllowBuilds'],
  })

  return feature('cloudflare-worker', 'archetype', intent, module, { typecheck: true })
}

const viteDependencies = freeze([
  '@tailwindcss/vite',
  '@vitejs/plugin-react',
  'class-variance-authority',
  'clsx',
  'react',
  'react-dom',
  'react-router-dom',
  'tailwind-merge',
  'tailwindcss',
])

const viteConfig = `import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '#': fileURLToPath(new URL('./src', import.meta.url)) } },
})
`

export function viteReact({ language = 'ES2020' } = {}) {
  const intent = { language }
  const module = calculationModule('vite-react', {
    viteReactIntent: external(),
    viteToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@types/node', '@types/react', '@types/react-dom', 'typescript', 'vite']
        : []),
    viteRuntimePackages: calculated([], () => viteDependencies),
    vitePackageFields: calculated([], () => ({ imports: { '#*': './src/*' } })),
    viteTsconfig: calculated(['viteReactIntent', 'sourceDirectory'], (options, sourceDirectory) => ({
      extends: '@tsconfig/strictest/tsconfig.json',
      include: [`${sourceDirectory}/**/*`],
      compilerOptions: {
        rootDir: sourceDirectory,
        target: options.language,
        lib: [options.language, 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        allowImportingTsExtensions: true,
        moduleDetection: 'force',
        jsx: 'react-jsx',
        paths: { '#*': [`./${sourceDirectory}/*`] },
      },
    })),
    viteFiles: calculated(['action', 'viteActions'], (action, actions) =>
      hasAction(actions, action) ? { 'vite.config.ts': viteConfig } : {}),
    viteAllowBuilds: calculated([], () => ['esbuild']),
    viteOutput: calculated(['outputDirectory'], directory => ({ directory })),
    viteBuildAssets: calculated([], () => ['index.html', 'public']),
  }, {
    toolPackages: ['viteToolPackages'],
    runtimePackages: ['viteRuntimePackages'],
    packageFields: ['vitePackageFields'],
    tsconfig: ['viteTsconfig'],
    files: ['viteFiles'],
    allowBuilds: ['viteAllowBuilds'],
    output: ['viteOutput'],
    buildAssets: ['viteBuildAssets'],
  })

  return feature('vite-react', 'archetype', intent, module, {
    typecheck: true,
    build: 'vite',
    devInstall: true,
  })
}

export function prettier(options = {}) {
  const intent = { ...prettierDefaults, ...options }
  const module = calculationModule('prettier', {
    prettierIntent: external(),
    prettierToolPackages: calculated(['action', 'devAction'], (action, devAction) =>
      action === devAction ? ['prettier'] : []),
    prettierFiles: calculated(['action', 'devAction', 'prettierIntent'], (action, devAction, policy) =>
      action === devAction ? { '.prettierrc.json': policy } : {}),
  }, {
    toolPackages: ['prettierToolPackages'],
    files: ['prettierFiles'],
  })
  return feature('prettier', 'capability', intent, module)
}

export function vitest({ environment = 'node', globals = false, typecheck = false } = {}) {
  const intent = { environment, globals, typecheck }
  const module = calculationModule('vitest', {
    vitestIntent: external(),
    vitestToolPackages: calculated(['action', 'vitestDependencyActions'], (action, actions) =>
      hasAction(actions, action) ? ['vitest', ...(environment === 'jsdom' ? ['jsdom'] : [])] : []),
    vitestTsconfig: calculated(
      ['action', 'vitestTypeActions', 'vitestIntent'],
      (action, actions, options) => options.globals && hasAction(actions, action)
        ? { compilerOptions: { types: ['vitest/globals'] } }
        : {},
    ),
    vitestFiles: calculated(['action', 'vitestActions', 'vitestIntent'], (action, actions, options) => {
      if (!hasAction(actions, action)) return {}
      const body = options.environment === 'jsdom'
        ? `import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({ test: {
  environment: 'jsdom',
  exclude: [...configDefaults.exclude, 'e2e/**'],
  root: fileURLToPath(new URL('./', import.meta.url)),
  globals: ${options.globals},
  typecheck: { enabled: ${options.typecheck} },
} }))
`
        : `import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  environment: ${JSON.stringify(options.environment)},
  globals: ${options.globals},
  typecheck: { enabled: ${options.typecheck} },
} })
`
      return { 'vitest.config.ts': body }
    }),
    vitestAllowBuilds: calculated([], () => ['esbuild']),
  }, {
    toolPackages: ['vitestToolPackages'],
    tsconfig: ['vitestTsconfig'],
    files: ['vitestFiles'],
    allowBuilds: ['vitestAllowBuilds'],
  })
  return feature('vitest', 'capability', intent, module, { test: true })
}

const eslintConfig = options => `import js from '@eslint/js'
import parser from '@typescript-eslint/parser'
import plugin from '@typescript-eslint/eslint-plugin'
${options.prettier ? "import prettier from 'eslint-plugin-prettier'\n" : ''}
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: { parser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': plugin${options.prettier ? ', prettier' : ''} },
    rules: {
      ...plugin.configs.recommended.rules,
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      ${options.explicitReturnTypes ? "'@typescript-eslint/explicit-function-return-type': 'error'," : ''}
      ${options.prettier ? "'prettier/prettier': 'error'," : ''}
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
`

export function eslint({ prettier: prettierEnabled = false, explicitReturnTypes = false } = {}) {
  const intent = { prettier: prettierEnabled, explicitReturnTypes }
  const module = calculationModule('eslint', {
    eslintIntent: external(),
    eslintToolPackages: calculated(['action', 'eslintActions', 'eslintIntent'], (action, actions, options) =>
      hasAction(actions, action)
        ? [
            '@eslint/js',
            '@typescript-eslint/eslint-plugin',
            '@typescript-eslint/parser',
            'eslint',
            ...(options.prettier ? ['eslint-plugin-prettier', 'prettier'] : []),
          ]
        : []),
    eslintFiles: calculated(['action', 'eslintActions', 'eslintIntent'], (action, actions, options) =>
      hasAction(actions, action) ? { 'eslint.config.mjs': eslintConfig(options) } : {}),
  }, {
    toolPackages: ['eslintToolPackages'],
    files: ['eslintFiles'],
  })
  return feature('eslint', 'capability', intent, module, { lint: true })
}

export function typedoc({ title } = {}) {
  const intent = { title }
  const module = calculationModule('typedoc', {
    typedocIntent: external(),
    typedocToolPackages: calculated(['action', 'typedocActions'], (action, actions) =>
      hasAction(actions, action) ? ['typedoc'] : []),
    typedocFiles: calculated(
      ['action', 'typedocActions', 'typedocIntent', 'sourceEntry', 'name'],
      (action, actions, options, sourceEntry, name) => hasAction(actions, action)
        ? {
            'typedoc.json': {
              entryPoints: [sourceEntry],
              name: options.title ?? name,
              includeVersion: true,
              excludeExternals: true,
              excludePrivate: true,
              excludeProtected: true,
              exclude: ['**/*.test.ts', '**/*.spec.ts'],
            },
          }
        : {},
    ),
  }, {
    toolPackages: ['typedocToolPackages'],
    files: ['typedocFiles'],
  })
  return feature('typedoc', 'capability', intent, module, { docs: true })
}
