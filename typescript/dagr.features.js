const node = (kind, deps = [], factory) => Object.freeze({
  kind,
  deps: Object.freeze([...deps]),
  ...(factory === undefined ? {} : { factory }),
})

const external = () => node('external')
const calculated = (deps, factory) => node('calculated', deps, factory)
const calculationModule = (name, nodes, contributions = {}) => Object.freeze({
  name,
  nodes: Object.freeze({ ...nodes }),
  contributions: Object.freeze(Object.fromEntries(
    Object.entries(contributions).map(([kind, names]) => [kind, Object.freeze([...names])]),
  )),
})

const feature = (name, role, externalValues, module, execution = {}) => Object.freeze({
  name,
  role,
  externalValues: Object.freeze({ ...externalValues }),
  module,
  execution: Object.freeze({ ...execution }),
})

const hasAction = (actions, action) => actions.includes(action)

export function library({
  runtime = 'portable',
  language = runtime === 'node' ? 'ES2023' : 'ES2022',
  sourceMaps = false,
  assets = [],
} = {}) {
  if (!['portable', 'node'].includes(runtime)) {
    throw new Error(`library runtime must be portable or node, got ${JSON.stringify(runtime)}`)
  }
  const externalValues = {
    productKind: 'library',
    runtimeKind: runtime,
    languageTarget: language,
    sourceMapIntent: sourceMaps,
    buildAssetInputs: Object.freeze([...assets]),
  }
  const module = calculationModule('library', {
    productKind: external(),
    runtimeKind: external(),
    languageTarget: external(),
    sourceMapIntent: external(),
    buildAssetInputs: external(),
    moduleKind: calculated(['runtimeKind'], runtime => runtime === 'node' ? 'NodeNext' : 'ESNext'),
    moduleResolutionKind: calculated(
      ['runtimeKind'],
      runtime => runtime === 'node' ? 'NodeNext' : 'Bundler',
    ),
    standardLibraries: calculated(['languageTarget'], target => [target]),
    baseAmbientTypes: calculated(['runtimeKind'], runtime => runtime === 'node' ? ['node'] : []),
    sourceAlias: calculated([], () => undefined),
    archetypeToolPackages: calculated(
      ['action', 'developmentActions', 'runtimeKind'],
      (action, actions, runtime) => hasAction(actions, action)
        ? ['@tsconfig/strictest', ...(runtime === 'node' ? ['@types/node'] : []), 'typescript']
        : [],
    ),
    archetypeRuntimePackages: calculated([], () => []),
    archetypeAllowBuilds: calculated([], () => []),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
  }, {
    toolPackages: ['archetypeToolPackages'],
    runtimePackages: ['archetypeRuntimePackages'],
    ambientTypes: ['baseAmbientTypes'],
    allowBuilds: ['archetypeAllowBuilds'],
  })
  return feature('library', 'archetype', externalValues, module, {
    typecheck: true,
    build: 'tsc',
    pack: true,
  })
}

export function cloudflareWorker({ language = 'ES2022' } = {}) {
  const externalValues = {
    productKind: 'worker',
    runtimeKind: 'cloudflare-worker',
    languageTarget: language,
    sourceMapIntent: false,
    buildAssetInputs: Object.freeze([]),
  }
  const module = calculationModule('cloudflare-worker', {
    productKind: external(),
    runtimeKind: external(),
    languageTarget: external(),
    sourceMapIntent: external(),
    buildAssetInputs: external(),
    moduleKind: calculated([], () => 'NodeNext'),
    moduleResolutionKind: calculated([], () => 'NodeNext'),
    standardLibraries: calculated(['languageTarget'], target => [target]),
    baseAmbientTypes: calculated([], () => ['@cloudflare/workers-types']),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    archetypeToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@cloudflare/workers-types', 'typescript', 'wrangler']
        : []),
    archetypeRuntimePackages: calculated([], () => []),
    archetypeAllowBuilds: calculated([], () => ['sharp', 'workerd']),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
  }, {
    toolPackages: ['archetypeToolPackages'],
    runtimePackages: ['archetypeRuntimePackages'],
    ambientTypes: ['baseAmbientTypes'],
    allowBuilds: ['archetypeAllowBuilds'],
  })
  return feature('cloudflare-worker', 'archetype', externalValues, module, { typecheck: true })
}

const viteRuntimePackages = Object.freeze([
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

export function viteReact({ language = 'ES2020' } = {}) {
  const externalValues = {
    productKind: 'web',
    runtimeKind: 'browser',
    languageTarget: language,
    sourceMapIntent: false,
    buildAssetInputs: Object.freeze(['index.html', 'public']),
  }
  const module = calculationModule('vite-react', {
    productKind: external(),
    runtimeKind: external(),
    languageTarget: external(),
    sourceMapIntent: external(),
    buildAssetInputs: external(),
    moduleKind: calculated([], () => 'ESNext'),
    moduleResolutionKind: calculated([], () => 'Bundler'),
    standardLibraries: calculated(['languageTarget'], target => [target, 'DOM', 'DOM.Iterable']),
    baseAmbientTypes: calculated([], () => []),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    archetypeToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@types/node', '@types/react', '@types/react-dom', 'typescript', 'vite']
        : []),
    archetypeRuntimePackages: calculated([], () => viteRuntimePackages),
    archetypeAllowBuilds: calculated([], () => ['esbuild']),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    'vite.plugins': calculated([], () => ['react', 'tailwindcss']),
    'vite.resolve.alias': calculated(
      ['sourceAlias', 'sourceDirectory'],
      (alias, directory) => ({ [alias.viteName]: `./${directory}` }),
    ),
    viteConfig: calculated(
      ['action', 'viteActions', 'vite.plugins', 'vite.resolve.alias'],
      (action, actions, plugins, alias) => hasAction(actions, action)
        ? `import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [${plugins.map(plugin => `${plugin}()`).join(', ')}],
  resolve: { alias: { '#': fileURLToPath(new URL(${JSON.stringify(alias['#'])}, import.meta.url)) } },
})
`
        : undefined,
    ),
    viteGeneratedFiles: calculated(
      ['viteConfig'],
      config => config === undefined ? {} : { 'vite.config.ts': config },
    ),
  }, {
    toolPackages: ['archetypeToolPackages'],
    runtimePackages: ['archetypeRuntimePackages'],
    ambientTypes: ['baseAmbientTypes'],
    allowBuilds: ['archetypeAllowBuilds'],
    generatedFiles: ['viteGeneratedFiles'],
  })
  return feature('vite-react', 'archetype', externalValues, module, {
    typecheck: true,
    build: 'vite',
    devInstall: true,
  })
}

export function prettier({
  semi = false,
  tabWidth = 2,
  singleQuote = true,
  printWidth = 100,
  trailingComma = 'none',
} = {}) {
  const externalValues = {
    formatSemicolons: semi,
    formatTabWidth: tabWidth,
    formatSingleQuotes: singleQuote,
    formatPrintWidth: printWidth,
    formatTrailingCommas: trailingComma,
  }
  const module = calculationModule('prettier', {
    formatSemicolons: external(),
    formatTabWidth: external(),
    formatSingleQuotes: external(),
    formatPrintWidth: external(),
    formatTrailingCommas: external(),
    prettierToolPackages: calculated(['action', 'devAction'], (action, devAction) =>
      action === devAction ? ['prettier'] : []),
    'prettier.$schema': calculated([], () => 'https://json.schemastore.org/prettierrc'),
    'prettier.semi': calculated(['formatSemicolons'], value => value),
    'prettier.tabWidth': calculated(['formatTabWidth'], value => value),
    'prettier.singleQuote': calculated(['formatSingleQuotes'], value => value),
    'prettier.printWidth': calculated(['formatPrintWidth'], value => value),
    'prettier.trailingComma': calculated(['formatTrailingCommas'], value => value),
    prettierConfig: calculated(
      [
        'action',
        'devAction',
        'prettier.$schema',
        'prettier.semi',
        'prettier.tabWidth',
        'prettier.singleQuote',
        'prettier.printWidth',
        'prettier.trailingComma',
      ],
      (action, devAction, schema, semicolons, width, quotes, printWidth, commas) =>
        action === devAction
          ? { $schema: schema, semi: semicolons, tabWidth: width, singleQuote: quotes, printWidth, trailingComma: commas }
          : undefined,
    ),
    prettierGeneratedFiles: calculated(
      ['prettierConfig'],
      config => config === undefined ? {} : { '.prettierrc.json': config },
    ),
  }, {
    toolPackages: ['prettierToolPackages'],
    generatedFiles: ['prettierGeneratedFiles'],
  })
  return feature('prettier', 'capability', externalValues, module)
}

export function vitest({ environment = 'node', globals = false, typecheck = false } = {}) {
  const externalValues = {
    testEnvironment: environment,
    testGlobalsIntent: globals,
    testTypecheckIntent: typecheck,
  }
  const module = calculationModule('vitest', {
    testEnvironment: external(),
    testGlobalsIntent: external(),
    testTypecheckIntent: external(),
    vitestToolPackages: calculated(['action', 'vitestDependencyActions', 'testEnvironment'], (action, actions, env) =>
      hasAction(actions, action) ? ['vitest', ...(env === 'jsdom' ? ['jsdom'] : [])] : []),
    vitestAmbientTypes: calculated(
      ['action', 'vitestTypeActions', 'testGlobalsIntent'],
      (action, actions, globals) => globals && hasAction(actions, action) ? ['vitest/globals'] : [],
    ),
    'vitest.test.environment': calculated(['testEnvironment'], value => value),
    'vitest.test.globals': calculated(['testGlobalsIntent'], value => value),
    'vitest.test.typecheck.enabled': calculated(['testTypecheckIntent'], value => value),
    'vitest.test.exclude': calculated(
      ['testEnvironment'],
      env => env === 'jsdom' ? ['...configDefaults.exclude', 'e2e/**'] : undefined,
    ),
    'vitest.test.root': calculated(
      ['testEnvironment'],
      env => env === 'jsdom' ? './' : undefined,
    ),
    vitestConfig: calculated(
      [
        'action',
        'vitestActions',
        'vitest.test.environment',
        'vitest.test.globals',
        'vitest.test.typecheck.enabled',
        'vitest.test.exclude',
        'vitest.test.root',
      ],
      (action, actions, env, globals, typecheckEnabled, exclude, root) => {
        if (!hasAction(actions, action)) return undefined
        if (env === 'jsdom') return `import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({ test: {
  environment: ${JSON.stringify(env)},
  exclude: [...configDefaults.exclude, ${JSON.stringify(exclude[1])}],
  root: fileURLToPath(new URL(${JSON.stringify(root)}, import.meta.url)),
  globals: ${globals},
  typecheck: { enabled: ${typecheckEnabled} },
} }))
`
        return `import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  environment: ${JSON.stringify(env)},
  globals: ${globals},
  typecheck: { enabled: ${typecheckEnabled} },
} })
`
      },
    ),
    vitestGeneratedFiles: calculated(
      ['vitestConfig'],
      config => config === undefined ? {} : { 'vitest.config.ts': config },
    ),
    vitestAllowBuilds: calculated([], () => ['esbuild']),
  }, {
    toolPackages: ['vitestToolPackages'],
    ambientTypes: ['vitestAmbientTypes'],
    generatedFiles: ['vitestGeneratedFiles'],
    allowBuilds: ['vitestAllowBuilds'],
  })
  return feature('vitest', 'capability', externalValues, module, { test: true })
}

export function eslint({ prettier: enforceFormatting = false, explicitReturnTypes = false } = {}) {
  const externalValues = {
    lintFormattingIntent: enforceFormatting,
    lintExplicitReturnTypesIntent: explicitReturnTypes,
  }
  const module = calculationModule('eslint', {
    lintFormattingIntent: external(),
    lintExplicitReturnTypesIntent: external(),
    eslintToolPackages: calculated(
      ['action', 'eslintActions', 'lintFormattingIntent'],
      (action, actions, formatting) => hasAction(actions, action)
        ? [
            '@eslint/js',
            '@typescript-eslint/eslint-plugin',
            '@typescript-eslint/parser',
            'eslint',
            ...(formatting ? ['eslint-plugin-prettier', 'prettier'] : []),
          ]
        : [],
    ),
    'eslint.languageOptions.parser': calculated([], () => '@typescript-eslint/parser'),
    'eslint.languageOptions.parserOptions.project': calculated([], () => './tsconfig.json'),
    'eslint.files': calculated(
      ['sourceLayout'],
      layout => [`${layout.directory}/**/*.ts`, `${layout.directory}/**/*.tsx`],
    ),
    'eslint.testFiles': calculated(
      ['sourceLayout'],
      layout => [
        `${layout.directory}/**/*.test.ts`,
        `${layout.directory}/**/*.spec.ts`,
        `${layout.directory}/**/*.test.tsx`,
        `${layout.directory}/**/*.spec.tsx`,
      ],
    ),
    'eslint.rules.no-undef': calculated([], () => 'off'),
    'eslint.rules.no-redeclare': calculated([], () => 'off'),
    'eslint.rules.@typescript-eslint/no-empty-object-type': calculated([], () => 'off'),
    'eslint.rules.@typescript-eslint/no-unused-vars': calculated([], () => 'error'),
    'eslint.rules.@typescript-eslint/explicit-function-return-type': calculated(
      ['lintExplicitReturnTypesIntent'],
      enabled => enabled ? 'error' : undefined,
    ),
    'eslint.rules.prettier/prettier': calculated(
      ['lintFormattingIntent'],
      enabled => enabled ? 'error' : undefined,
    ),
    eslintRules: calculated(
      [
        'eslint.rules.no-undef',
        'eslint.rules.no-redeclare',
        'eslint.rules.@typescript-eslint/no-empty-object-type',
        'eslint.rules.@typescript-eslint/no-unused-vars',
        'eslint.rules.@typescript-eslint/explicit-function-return-type',
        'eslint.rules.prettier/prettier',
      ],
      (noUndef, noRedeclare, emptyObject, unused, returns, formatting) => ({
        'no-undef': noUndef,
        'no-redeclare': noRedeclare,
        '@typescript-eslint/no-empty-object-type': emptyObject,
        '@typescript-eslint/no-unused-vars': unused,
        ...(returns === undefined ? {} : { '@typescript-eslint/explicit-function-return-type': returns }),
        ...(formatting === undefined ? {} : { 'prettier/prettier': formatting }),
      }),
    ),
    eslintConfig: calculated(
      [
        'action',
        'eslintActions',
        'lintFormattingIntent',
        'eslint.files',
        'eslint.testFiles',
        'eslint.languageOptions.parserOptions.project',
        'eslintRules',
      ],
      (action, actions, formatting, files, testFiles, project, rules) => hasAction(actions, action)
        ? `import js from '@eslint/js'
import parser from '@typescript-eslint/parser'
import plugin from '@typescript-eslint/eslint-plugin'
${formatting ? "import prettier from 'eslint-plugin-prettier'\n" : ''}
export default [
  js.configs.recommended,
  {
    files: ${JSON.stringify(files)},
    languageOptions: { parser, parserOptions: { project: ${JSON.stringify(project)} } },
    plugins: { '@typescript-eslint': plugin${formatting ? ', prettier' : ''} },
    rules: { ...plugin.configs.recommended.rules, ...${JSON.stringify(rules)} },
  },
  {
    files: ${JSON.stringify(testFiles)},
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
`
        : undefined,
    ),
    eslintGeneratedFiles: calculated(
      ['eslintConfig'],
      config => config === undefined ? {} : { 'eslint.config.mjs': config },
    ),
  }, {
    toolPackages: ['eslintToolPackages'],
    generatedFiles: ['eslintGeneratedFiles'],
  })
  return feature('eslint', 'capability', externalValues, module, { lint: true })
}

export function typedoc({ title } = {}) {
  const externalValues = { documentationTitle: title }
  const module = calculationModule('typedoc', {
    documentationTitle: external(),
    typedocToolPackages: calculated(['action', 'typedocActions'], (action, actions) =>
      hasAction(actions, action) ? ['typedoc'] : []),
    'typedoc.entryPoints': calculated(['sourceEntry'], entry => [entry]),
    'typedoc.name': calculated(
      ['documentationTitle', 'name'],
      (title, name) => title ?? name,
    ),
    'typedoc.includeVersion': calculated([], () => true),
    'typedoc.excludeExternals': calculated([], () => true),
    'typedoc.excludePrivate': calculated([], () => true),
    'typedoc.excludeProtected': calculated([], () => true),
    'typedoc.exclude': calculated(
      ['sourceSet'],
      sources => sources.exclude ?? [],
    ),
    typedocConfig: calculated(
      [
        'action',
        'typedocActions',
        'typedoc.entryPoints',
        'typedoc.name',
        'typedoc.includeVersion',
        'typedoc.excludeExternals',
        'typedoc.excludePrivate',
        'typedoc.excludeProtected',
        'typedoc.exclude',
      ],
      (action, actions, entryPoints, name, includeVersion, excludeExternals,
        excludePrivate, excludeProtected, exclude) => hasAction(actions, action)
        ? { entryPoints, name, includeVersion, excludeExternals, excludePrivate, excludeProtected, exclude }
        : undefined,
    ),
    typedocGeneratedFiles: calculated(
      ['typedocConfig'],
      config => config === undefined ? {} : { 'typedoc.json': config },
    ),
  }, {
    toolPackages: ['typedocToolPackages'],
    generatedFiles: ['typedocGeneratedFiles'],
  })
  return feature('typedoc', 'capability', externalValues, module, { docs: true })
}
