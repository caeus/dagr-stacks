const node = (kind, deps = [], factory, tags = []) => Object.freeze({
  kind,
  deps: Object.freeze([...deps]),
  tags: Object.freeze([...tags]),
  ...(factory === undefined ? {} : { factory }),
})

const external = () => node('external')
const calculated = (deps, factory, tags = []) => node('calculated', deps, factory, tags)
const calculationModule = (name, nodes) => Object.freeze({
  name,
  nodes: Object.freeze({ ...nodes }),
})

const feature = (name, externalValues, module) => Object.freeze({
  name,
  externalValues: Object.freeze({ ...externalValues }),
  module,
})

export const setting = (deps, factory, { tags = [] } = {}) => calculated(deps, factory, tags)

export const value = (entry, options) => setting([], () => entry, options)

export const requires = (...dependencies) => setting(
  dependencies,
  () => true,
  { tags: ['validations'] },
)

export function target(name, { kind = 'command', deps = [], ...options } = {}) {
  const separator = name.indexOf(':')
  if (separator <= 0 || separator === name.length - 1) {
    throw new Error(`TypeScript feature target must be facet:name, got ${JSON.stringify(name)}`)
  }
  return Object.freeze({
    facet: name.slice(0, separator),
    name: name.slice(separator + 1),
    kind,
    ...options,
    deps: Object.freeze([...deps]),
  })
}

export function defineFeature(name, { inputs = {}, settings = {} } = {}) {
  if (!name) throw new Error('TypeScript feature needs a name')
  const conflicts = Object.keys(inputs).filter(key => Object.hasOwn(settings, key))
  if (conflicts.length > 0) {
    throw new Error(`TypeScript feature ${JSON.stringify(name)} declares ${conflicts.join(', ')} as both input and setting`)
  }
  return feature(name, inputs, calculationModule(name, {
    ...Object.fromEntries(Object.keys(inputs).map(key => [key, external()])),
    ...settings,
  }))
}

const hasAction = (actions, action) => actions.includes(action)

const contributedTargetNames = contributions => Reflect.ownKeys(contributions)
  .map(name => contributions[name])
  .filter(target => target !== undefined)
  .map(target => `${target.facet}:${target.name}`)

const mergeRecords = (label, records) => {
  const result = {}
  for (const record of records) {
    for (const [key, entry] of Object.entries(record)) {
      if (Object.hasOwn(result, key)) {
        throw new Error(`${label} ${JSON.stringify(key)} has more than one owner`)
      }
      result[key] = entry
    }
  }
  return result
}

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
    baseAmbientTypes: calculated(
      ['runtimeKind'],
      runtime => runtime === 'node' ? ['node'] : [],
      ['ambientTypes'],
    ),
    sourceAlias: calculated([], () => undefined),
    productToolPackages: calculated(
      ['action', 'developmentActions', 'runtimeKind'],
      (action, actions, runtime) => hasAction(actions, action)
        ? ['@tsconfig/strictest', ...(runtime === 'node' ? ['@types/node'] : []), 'typescript']
        : [],
      ['toolPackages'],
    ),
    productRuntimePackages: calculated([], () => [], ['runtimePackages']),
    productAllowBuilds: calculated([], () => [], ['allowBuilds']),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    libraryTypecheckTarget: calculated(
      [],
      () => target('ci:typecheck', { command: 'pnpm exec tsc --noEmit' }),
      ['targets'],
    ),
    libraryBuildTarget: calculated(
      [{ tag: 'buildDependencies' }],
      dependencies => target('ci:build', {
        command: 'pnpm exec tsc',
        assets: true,
        deps: contributedTargetNames(dependencies),
      }),
      ['targets'],
    ),
    libraryCiPackTarget: calculated(
      [],
      () => target('ci:pack', { kind: 'pack', deps: ['ci:build'] }),
      ['targets'],
    ),
    libraryPublishPackTarget: calculated(
      [],
      () => target('publish:pack', { kind: 'pack', deps: ['ci:build'] }),
      ['targets'],
    ),
  })
  return feature('library', externalValues, module)
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
    baseAmbientTypes: calculated([], () => ['@cloudflare/workers-types'], ['ambientTypes']),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    productToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@cloudflare/workers-types', 'typescript', 'wrangler']
        : [], ['toolPackages']),
    productRuntimePackages: calculated([], () => [], ['runtimePackages']),
    productAllowBuilds: calculated([], () => ['sharp', 'workerd'], ['allowBuilds']),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    cloudflareTypecheckTarget: calculated(
      [],
      () => target('ci:typecheck', { command: 'pnpm exec tsc --noEmit' }),
      ['targets'],
    ),
  })
  return feature('cloudflare-worker', externalValues, module)
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
    baseAmbientTypes: calculated([], () => [], ['ambientTypes']),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    productToolPackages: calculated(['action', 'developmentActions'], (action, actions) =>
      hasAction(actions, action)
        ? ['@tsconfig/strictest', '@types/node', '@types/react', '@types/react-dom', 'typescript', 'vite']
        : [], ['toolPackages']),
    productRuntimePackages: calculated([], () => viteRuntimePackages, ['runtimePackages']),
    productAllowBuilds: calculated([], () => ['esbuild'], ['allowBuilds']),
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
      ['generatedFiles'],
    ),
    viteTypecheckTarget: calculated(
      [],
      () => target('ci:typecheck', { command: 'pnpm exec tsc --noEmit' }),
      ['targets'],
    ),
    viteBuildTarget: calculated(
      [{ tag: 'buildDependencies' }],
      dependencies => target('ci:build', {
        command: 'pnpm exec vite build',
        assets: true,
        deps: contributedTargetNames(dependencies),
      }),
      ['targets'],
    ),
    viteDevInstallTarget: calculated([], () => target('dev:install', { kind: 'dev-install' }), ['targets']),
  })
  return feature('vite-react', externalValues, module)
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
    prettierToolPackages: calculated(['action', 'prettierActions'], (action, actions) =>
      hasAction(actions, action) ? ['prettier'] : [], ['toolPackages']),
    'prettier.$schema': calculated([], () => 'https://json.schemastore.org/prettierrc'),
    'prettier.semi': calculated(['formatSemicolons'], value => value),
    'prettier.tabWidth': calculated(['formatTabWidth'], value => value),
    'prettier.singleQuote': calculated(['formatSingleQuotes'], value => value),
    'prettier.printWidth': calculated(['formatPrintWidth'], value => value),
    'prettier.trailingComma': calculated(['formatTrailingCommas'], value => value),
    prettierConfig: calculated(
      [
        'action',
        'prettierActions',
        'prettier.$schema',
        'prettier.semi',
        'prettier.tabWidth',
        'prettier.singleQuote',
        'prettier.printWidth',
        'prettier.trailingComma',
      ],
      (action, actions, schema, semicolons, width, quotes, printWidth, commas) =>
        hasAction(actions, action)
          ? { $schema: schema, semi: semicolons, tabWidth: width, singleQuote: quotes, printWidth, trailingComma: commas }
          : undefined,
    ),
    prettierGeneratedFiles: calculated(
      ['prettierConfig'],
      config => config === undefined ? {} : { '.prettierrc.json': config },
      ['generatedFiles'],
    ),
  })
  return feature('prettier', externalValues, module)
}

export function biome({ formatter = true, linter = true } = {}) {
  return defineFeature('biome', {
    inputs: {
      biomeFormatterIntent: formatter,
      biomeLinterIntent: linter,
    },
    settings: {
      biomeActions: value(Object.freeze(['dev', 'lint'])),
      biomeToolPackages: setting(
        ['action', 'biomeActions'],
        (action, actions) => hasAction(actions, action) ? ['@biomejs/biome'] : [],
        { tags: ['toolPackages'] },
      ),
      'biome.formatter.enabled': setting(['biomeFormatterIntent'], enabled => enabled),
      'biome.linter.enabled': setting(['biomeLinterIntent'], enabled => enabled),
      biomeConfig: setting(
        ['action', 'biomeActions', 'biome.formatter.enabled', 'biome.linter.enabled'],
        (action, actions, formatterEnabled, linterEnabled) => hasAction(actions, action)
          ? { formatter: { enabled: formatterEnabled }, linter: { enabled: linterEnabled } }
          : undefined,
      ),
      biomeGeneratedFiles: setting(
        ['biomeConfig'],
        config => config === undefined ? {} : { 'biome.json': config },
        { tags: ['generatedFiles'] },
      ),
      biomeLintTarget: setting(
        ['biomeLinterIntent'],
        enabled => enabled
          ? target('ci:lint', {
              command: 'pnpm exec biome check .',
            })
          : undefined,
        { tags: ['targets', 'buildDependencies'] },
      ),
    },
  })
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
    ...(environment === 'jsdom' ? { vitestViteRequirement: requires('viteConfig') } : {}),
    vitestToolPackages: calculated(['action', 'vitestDependencyActions', 'testEnvironment'], (action, actions, env) =>
      hasAction(actions, action) ? ['vitest', ...(env === 'jsdom' ? ['jsdom'] : [])] : [], ['toolPackages']),
    vitestAmbientTypes: calculated(
      ['action', 'vitestTypeActions', 'testGlobalsIntent'],
      (action, actions, globals) => globals && hasAction(actions, action) ? ['vitest/globals'] : [],
      ['ambientTypes'],
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
      ['generatedFiles'],
    ),
    vitestAllowBuilds: calculated([], () => ['esbuild'], ['allowBuilds']),
    vitestTestTarget: calculated(
      [],
      () => target('ci:test', {
        command: 'pnpm exec vitest run',
      }),
      ['targets', 'buildDependencies'],
    ),
  })
  return feature('vitest', externalValues, module)
}

export function eslint({ prettier: enforceFormatting = false, explicitReturnTypes = false } = {}) {
  const externalValues = {
    lintFormattingIntent: enforceFormatting,
    lintExplicitReturnTypesIntent: explicitReturnTypes,
  }
  const module = calculationModule('eslint', {
    lintFormattingIntent: external(),
    lintExplicitReturnTypesIntent: external(),
    'eslint.enabled': calculated([], () => true),
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
      ['toolPackages'],
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
    'eslint.rules.no-dupe-class-members': calculated([], () => 'off'),
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
        'eslint.rules.no-dupe-class-members',
        'eslint.rules.@typescript-eslint/no-empty-object-type',
        'eslint.rules.@typescript-eslint/no-unused-vars',
        'eslint.rules.@typescript-eslint/explicit-function-return-type',
        'eslint.rules.prettier/prettier',
        { tag: 'eslint.ruleSets' },
      ],
      (noUndef, noRedeclare, noDupeClassMembers, emptyObject, unused, returns, formatting, extensions) =>
        mergeRecords('ESLint rule', [
          {
            'no-undef': noUndef,
            'no-redeclare': noRedeclare,
            'no-dupe-class-members': noDupeClassMembers,
            '@typescript-eslint/no-empty-object-type': emptyObject,
            '@typescript-eslint/no-unused-vars': unused,
            ...(returns === undefined ? {} : { '@typescript-eslint/explicit-function-return-type': returns }),
            ...(formatting === undefined ? {} : { 'prettier/prettier': formatting }),
          },
          ...Reflect.ownKeys(extensions).map(name => extensions[name]),
        ]),
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
      ['generatedFiles'],
    ),
    eslintLintTarget: calculated(
      [],
      () => target('ci:lint', {
        command: 'pnpm exec eslint .',
      }),
      ['targets', 'buildDependencies'],
    ),
  })
  return feature('eslint', externalValues, module)
}

export function typedoc({ title } = {}) {
  const externalValues = { documentationTitle: title }
  const module = calculationModule('typedoc', {
    documentationTitle: external(),
    typedocToolPackages: calculated(['action', 'typedocActions'], (action, actions) =>
      hasAction(actions, action) ? ['typedoc'] : [], ['toolPackages']),
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
      ['generatedFiles'],
    ),
    typedocDocsTarget: calculated(
      [],
      () => target('ci:docs', {
        command: 'pnpm exec typedoc',
        export: { '/repo/docs/': 'docs/' },
      }),
      ['targets'],
    ),
  })
  return feature('typedoc', externalValues, module)
}
