const facetsByName = new Map()
const facetsByTargetTag = new Map()

export function facet(name) {
  if (!name) throw new Error('TypeScript facet needs a name')
  if (facetsByName.has(name)) return facetsByName.get(name)
  const value = Object.freeze({ name, targets: Symbol(`${name} targets`) })
  facetsByName.set(name, value)
  facetsByTargetTag.set(value.targets, value)
  return value
}

export const configFacet = facet('config')
export const devFacet = facet('dev')
export const ciFacet = facet('ci')
export const publishFacet = facet('publish')

export const setting = (deps, factory, { tags = [] } = {}) => ({ deps, factory, tags })

const calculated = (deps, factory, tags = []) => setting(deps, factory, { tags })

const feature = (name, inputs, definitions) => {
  const settings = {}
  const targets = {}
  const facets = {}
  for (const key of Reflect.ownKeys(definitions)) {
    const definition = definitions[key]
    const targetFacets = definition.tags.map(tag => facetsByTargetTag.get(tag)).filter(Boolean)
    if (targetFacets.length > 1) throw new Error('A target setting cannot belong to multiple facets')
    if (targetFacets.length === 0) {
      settings[key] = definition
      continue
    }
    targets[key] = definition
    facets[targetFacets[0].name] = targetFacets[0]
  }
  return Object.freeze({
    name,
    inputs: Object.freeze({ ...inputs }),
    settings: Object.freeze(settings),
    targets: Object.freeze(targets),
    facets: Object.freeze(facets),
  })
}

export const value = (entry, options) => setting([], () => entry, options)

const versionDefaults = entries => value(
  Object.freeze({ ...entries }),
  { tags: ['versionDefaults'] },
)

export const requires = (...dependencies) => setting(
  dependencies,
  () => true,
  { tags: ['validations'] },
)

export function target(name, { deps = [], run } = {}) {
  if (!name) throw new Error('TypeScript target needs a name')
  if (typeof run !== 'function') throw new Error(`TypeScript target ${JSON.stringify(name)} needs run`)
  return Object.freeze({
    name,
    deps: Object.freeze([...deps]),
    run,
  })
}

export function defineFeature(name, { inputs = {}, settings = {} } = {}) {
  if (!name) throw new Error('TypeScript feature needs a name')
  const conflicts = Object.keys(inputs).filter(key => Object.hasOwn(settings, key))
  if (conflicts.length > 0) {
    throw new Error(`TypeScript feature ${JSON.stringify(name)} declares ${conflicts.join(', ')} as both input and setting`)
  }
  return feature(name, inputs, settings)
}

const hasIntent = (intents, intent) => intents.includes(intent)

const contributedTargetNames = contributions => Reflect.ownKeys(contributions)
  .map(name => contributions[name])
  .filter(target => target !== undefined)
  .map(target => target.name)

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

const copySource = directory => ({ COPY: { src: directory, dest: `/repo/${directory}` } })
const copyAssets = assets => assets.map(path => ({ COPY: { src: path, dest: `/repo/${path}` } }))

const configurationTarget = (name, workspace, runtime) => target(name, {
  deps: [runtime.base],
  run: ({ images }) => ({
    FROM: images[runtime.base],
    steps: [
      { WORKDIR: '/repo' },
      ...Object.entries(workspace.files).map(([path, value]) => runtime.writeProjectedFile(path, value)),
    ],
    IGNORE: runtime.ignore,
  }),
})

const installTarget = (name, workspace, runtime) => target(`install-${name}`, {
  deps: [`config:${name}`, ...runtime.packTargets],
  run: ({ images }) => ({
    FROM: images[`config:${name}`],
    steps: [
      ...runtime.localDeps.map(dependency => ({
        COPY: { from: images[runtime.packTarget(dependency)], src: '/out', dest: '/repo' },
      })),
      { WORKDIR: '/repo' },
      runtime.writeText('/repo/.pnpmfile.cjs', runtime.pnpmfile(runtime.scope)),
      ...(workspace.allowBuilds.length > 0
        ? [runtime.writeYaml('/repo/pnpm-workspace.yaml', {
            allowBuilds: Object.fromEntries(workspace.allowBuilds.map(pkg => [pkg, true])),
          })]
        : []),
      { RUN: 'pnpm install --prod=false' },
    ],
    IGNORE: runtime.ignore,
  }),
})

const commandTarget = (name, command, workspace, runtime, dependencies, { assets = false, export: output } = {}) =>
  target(name, {
    deps: [`install-${name}`, ...contributedTargetNames(dependencies)],
    run: ({ images }) => ({
      FROM: images[`install-${name}`],
      steps: [
        copySource(workspace.semantics.sourceLayout.directory),
        ...(assets ? copyAssets(workspace.buildAssets) : []),
        { WORKDIR: '/repo' },
        { RUN: command },
      ],
      IGNORE: runtime.ignore,
      ...(output ? { EXPORT: output } : {}),
    }),
  })

const commandTargets = (prefix, name, command, {
  assets = false,
  buildDependency = false,
  dependencies = false,
  enabled,
  export: output,
} = {}) => {
  const enabledDeps = enabled ? [enabled] : []
  const enabledFactory = factory => (...values) => {
    const isEnabled = enabled ? values.shift() : true
    return isEnabled ? factory(...values) : undefined
  }
  return {
    [`${prefix}ConfigTarget`]: calculated(
      [...enabledDeps, `config:${name}/workspace`, '#dagrRuntime'],
      enabledFactory((workspace, runtime) => configurationTarget(name, workspace, runtime)),
      [configFacet.targets],
    ),
    [`${prefix}InstallTarget`]: calculated(
      [...enabledDeps, `config:${name}/workspace`, '#dagrRuntime'],
      enabledFactory((workspace, runtime) => installTarget(name, workspace, runtime)),
      [ciFacet.targets],
    ),
    [`${prefix}Target`]: calculated(
      [
        ...enabledDeps,
        ...(dependencies ? [{ tag: 'buildDependencies' }] : []),
        `ci:${name}/workspace`,
        '#dagrRuntime',
      ],
      enabledFactory((...values) => {
        const runtime = values.pop()
        const workspace = values.pop()
        const runtimeDependencies = dependencies ? values.pop() : {}
        return commandTarget(name, command, workspace, runtime, runtimeDependencies, { assets, export: output })
      }),
      [ciFacet.targets, ...(buildDependency ? ['buildDependencies'] : [])],
    ),
  }
}

const packTarget = (name, workspace, runtime, dependencies, { dependencyFacet } = {}) => {
  const dependencyNames = contributedTargetNames(dependencies)
    .map(dependency => dependencyFacet ? `${dependencyFacet}:${dependency}` : dependency)
  return target(name, {
    deps: [...dependencyNames, ...runtime.packTargets],
    run: ({ images }) => ({
      FROM: images[dependencyNames[0]],
      steps: [
        ...runtime.localDeps.map(dependency => ({
          COPY: { from: images[runtime.packTarget(dependency)], src: '/out', dest: '/out' },
        })),
        { WORKDIR: '/repo' },
        runtime.writeJson('/repo/package.json', workspace.packageJson),
        { RUN: `mkdir -p /tmp/pack /out && pnpm pack --pack-destination /tmp/pack && mv /tmp/pack/*.tgz /out/${workspace.slug}.tgz` },
      ],
      IGNORE: runtime.ignore,
    }),
  })
}

const hostInstallTarget = (name, workspace, runtime) => target(name, {
  deps: ['config:dev', ...runtime.packTargets],
  run: ({ images, host }) => ({
    FROM: images['config:dev'],
    steps: [
      ...runtime.localDeps.map(dependency => ({
        COPY: { from: images[runtime.packTarget(dependency)], src: '/out', dest: '/repo' },
      })),
      { WORKDIR: '/repo' },
      runtime.writeText('/repo/.pnpmfile.cjs', runtime.pnpmfile(runtime.scope)),
      ...(workspace.allowBuilds.length > 0
        ? [runtime.writeYaml('/repo/pnpm-workspace.yaml', {
            allowBuilds: Object.fromEntries(workspace.allowBuilds.map(pkg => [pkg, true])),
          })]
        : []),
      { RUN: `pnpm install --prod=false --os ${host.os} --cpu ${host.arch}` },
    ],
    IGNORE: runtime.ignore,
    EXPORT: { '/repo/node_modules': 'node_modules' },
  }),
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
  const inputs = {
    productKind: 'library',
    runtimeKind: runtime,
    languageTarget: language,
    sourceMapIntent: sourceMaps,
    buildAssetInputs: Object.freeze([...assets]),
  }
  const settings = {
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
      ['intent', 'developmentIntents', 'runtimeKind'],
      (intent, intents, runtime) => hasIntent(intents, intent)
        ? ['@tsconfig/strictest', ...(runtime === 'node' ? ['@types/node'] : []), 'typescript']
        : [],
      ['toolPackages'],
    ),
    productRuntimePackages: calculated([], () => [], ['runtimePackages']),
    productAllowBuilds: calculated([], () => [], ['allowBuilds']),
    libraryVersionDefaults: versionDefaults({ '@types/node': '26.2.0' }),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    ...commandTargets('libraryTypecheck', 'typecheck', 'pnpm exec tsc --noEmit'),
    ...commandTargets('libraryBuild', 'build', 'pnpm exec tsc', {
      assets: true,
      dependencies: true,
    }),
    libraryCiPackTarget: calculated(
      ['libraryBuildTarget', 'ci:pack/workspace', '#dagrRuntime'],
      (build, workspace, runtime) => packTarget('pack', workspace, runtime, { build }),
      [ciFacet.targets],
    ),
    libraryPublishPackTarget: calculated(
      ['libraryBuildTarget', 'publish:pack/workspace', '#dagrRuntime'],
      (build, workspace, runtime) => packTarget('pack', workspace, runtime, { build }, {
        dependencyFacet: ciFacet.name,
      }),
      [publishFacet.targets],
    ),
  }
  return feature('library', inputs, settings)
}

export function cloudflareWorker({ language = 'ES2022' } = {}) {
  const inputs = {
    productKind: 'worker',
    runtimeKind: 'cloudflare-worker',
    languageTarget: language,
    sourceMapIntent: false,
    buildAssetInputs: Object.freeze([]),
  }
  const settings = {
    moduleKind: calculated([], () => 'NodeNext'),
    moduleResolutionKind: calculated([], () => 'NodeNext'),
    standardLibraries: calculated(['languageTarget'], target => [target]),
    baseAmbientTypes: calculated([], () => ['@cloudflare/workers-types'], ['ambientTypes']),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    productToolPackages: calculated(['intent', 'developmentIntents'], (intent, intents) =>
      hasIntent(intents, intent)
        ? ['@tsconfig/strictest', '@cloudflare/workers-types', 'typescript', 'wrangler']
        : [], ['toolPackages']),
    productRuntimePackages: calculated([], () => [], ['runtimePackages']),
    productAllowBuilds: calculated([], () => ['sharp', 'workerd'], ['allowBuilds']),
    cloudflareVersionDefaults: versionDefaults({
      '@cloudflare/workers-types': '4.20250620.0',
      wrangler: '4.0.0',
    }),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    ...commandTargets('cloudflareTypecheck', 'typecheck', 'pnpm exec tsc --noEmit'),
  }
  return feature('cloudflare-worker', inputs, settings)
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
  const inputs = {
    productKind: 'web',
    runtimeKind: 'browser',
    languageTarget: language,
    sourceMapIntent: false,
    buildAssetInputs: Object.freeze(['index.html', 'public']),
  }
  const settings = {
    moduleKind: calculated([], () => 'ESNext'),
    moduleResolutionKind: calculated([], () => 'Bundler'),
    standardLibraries: calculated(['languageTarget'], target => [target, 'DOM', 'DOM.Iterable']),
    baseAmbientTypes: calculated([], () => [], ['ambientTypes']),
    sourceAlias: calculated(
      ['sourceDirectory'],
      directory => ({ specifier: '#*', sourcePath: `./${directory}/*`, viteName: '#' }),
    ),
    productToolPackages: calculated(['intent', 'developmentIntents'], (intent, intents) =>
      hasIntent(intents, intent)
        ? ['@tsconfig/strictest', '@types/node', '@types/react', '@types/react-dom', 'typescript', 'vite']
        : [], ['toolPackages']),
    productRuntimePackages: calculated([], () => viteRuntimePackages, ['runtimePackages']),
    productAllowBuilds: calculated([], () => ['esbuild'], ['allowBuilds']),
    viteVersionDefaults: versionDefaults({
      '@tailwindcss/vite': '4.3.3',
      '@types/node': '26.2.0',
      '@types/react': '19.2.18',
      '@types/react-dom': '19.2.4',
      '@vitejs/plugin-react': '4.7.0',
      'class-variance-authority': '0.7.1',
      clsx: '2.1.1',
      react: '19.2.8',
      'react-dom': '19.2.8',
      'react-router-dom': '7.18.2',
      'tailwind-merge': '3.6.0',
      tailwindcss: '4.3.3',
      vite: '5.3.1',
    }),
    buildAssets: calculated(['buildAssetInputs'], assets => assets),
    viteIntents: calculated([], () => Object.freeze(['dev', 'test', 'build'])),
    'vite.plugins': calculated([], () => ['react', 'tailwindcss']),
    'vite.resolve.alias': calculated(
      ['sourceAlias', 'sourceDirectory'],
      (alias, directory) => ({ [alias.viteName]: `./${directory}` }),
    ),
    viteConfig: calculated(
      ['intent', 'viteIntents', 'vite.plugins', 'vite.resolve.alias'],
      (intent, intents, plugins, alias) => hasIntent(intents, intent)
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
    ...commandTargets('viteTypecheck', 'typecheck', 'pnpm exec tsc --noEmit'),
    ...commandTargets('viteBuild', 'build', 'pnpm exec vite build', {
      assets: true,
      dependencies: true,
    }),
    viteDevInstallTarget: calculated(
      ['config:dev/workspace', '#dagrRuntime'],
      (workspace, runtime) => hostInstallTarget('install', workspace, runtime),
      [devFacet.targets],
    ),
  }
  return feature('vite-react', inputs, settings)
}

export function prettier({
  semi = false,
  tabWidth = 2,
  singleQuote = true,
  printWidth = 100,
  trailingComma = 'none',
} = {}) {
  const inputs = {
    formatSemicolons: semi,
    formatTabWidth: tabWidth,
    formatSingleQuotes: singleQuote,
    formatPrintWidth: printWidth,
    formatTrailingCommas: trailingComma,
  }
  const settings = {
    prettierIntents: calculated([], () => Object.freeze(['dev', 'lint'])),
    prettierVersionDefaults: versionDefaults({ prettier: '3.3.3' }),
    prettierToolPackages: calculated(['intent', 'prettierIntents'], (intent, intents) =>
      hasIntent(intents, intent) ? ['prettier'] : [], ['toolPackages']),
    'prettier.$schema': calculated([], () => 'https://json.schemastore.org/prettierrc'),
    'prettier.semi': calculated(['formatSemicolons'], value => value),
    'prettier.tabWidth': calculated(['formatTabWidth'], value => value),
    'prettier.singleQuote': calculated(['formatSingleQuotes'], value => value),
    'prettier.printWidth': calculated(['formatPrintWidth'], value => value),
    'prettier.trailingComma': calculated(['formatTrailingCommas'], value => value),
    prettierConfig: calculated(
      [
        'intent',
        'prettierIntents',
        'prettier.$schema',
        'prettier.semi',
        'prettier.tabWidth',
        'prettier.singleQuote',
        'prettier.printWidth',
        'prettier.trailingComma',
      ],
      (intent, intents, schema, semicolons, width, quotes, printWidth, commas) =>
        hasIntent(intents, intent)
          ? { $schema: schema, semi: semicolons, tabWidth: width, singleQuote: quotes, printWidth, trailingComma: commas }
          : undefined,
    ),
    prettierGeneratedFiles: calculated(
      ['prettierConfig'],
      config => config === undefined ? {} : { '.prettierrc.json': config },
      ['generatedFiles'],
    ),
  }
  return feature('prettier', inputs, settings)
}

export function biome({ formatter = true, linter = true } = {}) {
  return defineFeature('biome', {
    inputs: {
      biomeFormatterIntent: formatter,
      biomeLinterIntent: linter,
    },
    settings: {
      biomeIntents: value(Object.freeze(['dev', 'lint'])),
      biomeVersionDefaults: versionDefaults({ '@biomejs/biome': '2.5.10' }),
      biomeToolPackages: setting(
        ['intent', 'biomeIntents'],
        (intent, intents) => hasIntent(intents, intent) ? ['@biomejs/biome'] : [],
        { tags: ['toolPackages'] },
      ),
      'biome.formatter.enabled': setting(['biomeFormatterIntent'], enabled => enabled),
      'biome.linter.enabled': setting(['biomeLinterIntent'], enabled => enabled),
      biomeConfig: setting(
        ['intent', 'biomeIntents', 'biome.formatter.enabled', 'biome.linter.enabled'],
        (intent, intents, formatterEnabled, linterEnabled) => hasIntent(intents, intent)
          ? { formatter: { enabled: formatterEnabled }, linter: { enabled: linterEnabled } }
          : undefined,
      ),
      biomeGeneratedFiles: setting(
        ['biomeConfig'],
        config => config === undefined ? {} : { 'biome.json': config },
        { tags: ['generatedFiles'] },
      ),
      ...commandTargets('biomeLint', 'lint', 'pnpm exec biome check .', {
        buildDependency: true,
        enabled: 'ci:lint/biomeLinterIntent',
      }),
    },
  })
}

export function vitest({ environment = 'node', globals = false, typecheck = false } = {}) {
  const inputs = {
    testEnvironment: environment,
    testGlobalsIntent: globals,
    testTypecheckIntent: typecheck,
  }
  const settings = {
    vitestIntents: calculated([], () => Object.freeze(['dev', 'test'])),
    vitestDependencyIntents: calculated([], () => Object.freeze(['dev', 'test', 'lint'])),
    vitestTypeIntents: calculated([], () => Object.freeze(['dev', 'test', 'lint'])),
    vitestVersionDefaults: versionDefaults({
      jsdom: '30.0.1',
      vitest: '3.2.7',
    }),
    ...(environment === 'jsdom' ? { vitestViteRequirement: requires('viteConfig') } : {}),
    vitestToolPackages: calculated(['intent', 'vitestDependencyIntents', 'testEnvironment'], (intent, intents, env) =>
      hasIntent(intents, intent) ? ['vitest', ...(env === 'jsdom' ? ['jsdom'] : [])] : [], ['toolPackages']),
    vitestAmbientTypes: calculated(
      ['intent', 'vitestTypeIntents', 'testGlobalsIntent'],
      (intent, intents, globals) => globals && hasIntent(intents, intent) ? ['vitest/globals'] : [],
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
        'intent',
        'vitestIntents',
        'vitest.test.environment',
        'vitest.test.globals',
        'vitest.test.typecheck.enabled',
        'vitest.test.exclude',
        'vitest.test.root',
      ],
      (intent, intents, env, globals, typecheckEnabled, exclude, root) => {
        if (!hasIntent(intents, intent)) return undefined
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
    ...commandTargets('vitestTest', 'test', 'pnpm exec vitest run', {
      buildDependency: true,
    }),
  }
  return feature('vitest', inputs, settings)
}

export function eslint({ prettier: enforceFormatting = false, explicitReturnTypes = false } = {}) {
  const inputs = {
    lintFormattingIntent: enforceFormatting,
    lintExplicitReturnTypesIntent: explicitReturnTypes,
  }
  const settings = {
    eslintIntents: calculated([], () => Object.freeze(['dev', 'lint'])),
    eslintVersionDefaults: versionDefaults({
      '@eslint/js': '9.12.0',
      '@typescript-eslint/eslint-plugin': '8.66.0',
      '@typescript-eslint/parser': '8.66.0',
      eslint: '9.12.0',
      'eslint-plugin-prettier': '5.2.1',
      prettier: '3.3.3',
    }),
    'eslint.enabled': calculated([], () => true),
    eslintToolPackages: calculated(
      ['intent', 'eslintIntents', 'lintFormattingIntent'],
      (intent, intents, formatting) => hasIntent(intents, intent)
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
        'intent',
        'eslintIntents',
        'lintFormattingIntent',
        'eslint.files',
        'eslint.testFiles',
        'eslint.languageOptions.parserOptions.project',
        'eslintRules',
      ],
      (intent, intents, formatting, files, testFiles, project, rules) => hasIntent(intents, intent)
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
    ...commandTargets('eslintLint', 'lint', 'pnpm exec eslint .', {
      buildDependency: true,
    }),
  }
  return feature('eslint', inputs, settings)
}

export function typedoc({ title } = {}) {
  const inputs = { documentationTitle: title }
  const settings = {
    typedocIntents: calculated([], () => Object.freeze(['dev', 'docs'])),
    typedocVersionDefaults: versionDefaults({ typedoc: '0.28.13' }),
    typedocToolPackages: calculated(['intent', 'typedocIntents'], (intent, intents) =>
      hasIntent(intents, intent) ? ['typedoc'] : [], ['toolPackages']),
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
        'intent',
        'typedocIntents',
        'typedoc.entryPoints',
        'typedoc.name',
        'typedoc.includeVersion',
        'typedoc.excludeExternals',
        'typedoc.excludePrivate',
        'typedoc.excludeProtected',
        'typedoc.exclude',
      ],
      (intent, intents, entryPoints, name, includeVersion, excludeExternals,
        excludePrivate, excludeProtected, exclude) => hasIntent(intents, intent)
        ? { entryPoints, name, includeVersion, excludeExternals, excludePrivate, excludeProtected, exclude }
        : undefined,
    ),
    typedocGeneratedFiles: calculated(
      ['typedocConfig'],
      config => config === undefined ? {} : { 'typedoc.json': config },
      ['generatedFiles'],
    ),
    ...commandTargets('typedocDocs', 'docs', 'pnpm exec typedoc', {
      export: { '/repo/docs/': 'docs/' },
    }),
  }
  return feature('typedoc', inputs, settings)
}
