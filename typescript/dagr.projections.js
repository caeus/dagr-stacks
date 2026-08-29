const node = (kind, deps = [], factory) => Object.freeze({
  kind,
  deps: Object.freeze([...deps]),
  ...(factory === undefined ? {} : { factory }),
})

const external = () => node('external')
const target = () => node('target')
const calculated = (deps, factory) => node('calculated', deps, factory)

const calculationModule = (name, nodes, contributions = {}) => Object.freeze({
  name,
  nodes: Object.freeze({ ...nodes }),
  contributions: Object.freeze(Object.fromEntries(
    Object.entries(contributions).map(([kind, names]) => [kind, Object.freeze([...names])]),
  )),
})

function mergeCalculationModules(modules) {
  const nodes = {}
  const owners = {}
  const contributions = {}
  for (const module of modules) {
    for (const [name, definition] of Object.entries(module.nodes)) {
      if (Object.hasOwn(nodes, name)) {
        throw new Error(`Calculation node ${JSON.stringify(name)} is declared by both ${owners[name]} and ${module.name}`)
      }
      nodes[name] = definition
      owners[name] = module.name
    }
    for (const [kind, names] of Object.entries(module.contributions)) {
      contributions[kind] = [...(contributions[kind] ?? []), ...names]
    }
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
    owners: Object.freeze(owners),
    contributions: Object.freeze(Object.fromEntries(
      Object.entries(contributions).map(([kind, names]) => [kind, Object.freeze(names)]),
    )),
  })
}

function compileCalculationGraph(graph, di, externalValues, targetValues, roots) {
  const sourceModule = kind => di.module(Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, definition]) => definition.kind === kind)
      .map(([name]) => {
        const values = kind === 'external' ? externalValues : targetValues
        if (!Object.hasOwn(values, name)) {
          throw new Error(`Missing ${kind} calculation node ${JSON.stringify(name)}`)
        }
        return [name, di.toValue(values[name])]
      }),
  ))
  const calculations = di.module(Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, definition]) => definition.kind === 'calculated')
      .map(([name, definition]) => [name, di.toFun(definition.deps, definition.factory)]),
  ))
  return sourceModule('external')
    .merge(sourceModule('target'))
    .merge(calculations)
    .shake(roots)
    .compile()
}

const DEFAULT_CONVENTIONS = Object.freeze({
  targetActions: Object.freeze({
    'config:dev': 'dev',
    'config:typecheck': 'typecheck',
    'config:test': 'test',
    'config:lint': 'lint',
    'config:docs': 'docs',
    'config:build': 'build',
    'dev:sync': 'dev',
    'ci:install-typecheck': 'typecheck',
    'ci:install-test': 'test',
    'ci:install-lint': 'lint',
    'ci:install-docs': 'docs',
    'ci:install-build': 'build',
    'ci:typecheck': 'typecheck',
    'ci:test': 'test',
    'ci:lint': 'lint',
    'ci:docs': 'docs',
    'ci:build': 'build',
    'ci:pack': 'pack',
    'publish:pack': 'publish',
  }),
  developmentActions: Object.freeze(['dev', 'typecheck', 'test', 'lint', 'docs', 'build']),
  distributionActions: Object.freeze(['pack', 'publish']),
  emitActions: Object.freeze(['build', 'pack', 'publish']),
  testSourceActions: Object.freeze(['dev', 'test', 'lint']),
  vitestActions: Object.freeze(['dev', 'test']),
  vitestDependencyActions: Object.freeze(['dev', 'test', 'lint']),
  vitestTypeActions: Object.freeze(['dev', 'test', 'lint']),
  eslintActions: Object.freeze(['dev', 'lint']),
  typedocActions: Object.freeze(['dev', 'docs']),
  viteActions: Object.freeze(['dev', 'test', 'build']),
  devAction: 'dev',
  publishAction: 'publish',
  dependencyLocations: Object.freeze(['prod', 'dev']),
  metadataFields: Object.freeze([
    'author', 'bugs', 'contributors', 'description', 'funding', 'homepage', 'keywords', 'license', 'repository',
  ]),
  sourceDirectory: 'src',
  entryFile: 'index.ts',
  outputDirectory: 'dist',
  javascriptModuleFormat: 'esm',
})

function conventionModule(overrides = {}) {
  const unknown = Object.keys(overrides).filter(name => !Object.hasOwn(DEFAULT_CONVENTIONS, name))
  if (unknown.length > 0) {
    throw new Error(`Unknown TypeScript convention${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}`)
  }
  return calculationModule('typescript-conventions', Object.fromEntries(
    Object.entries(DEFAULT_CONVENTIONS).map(([name, fallback]) => [
      name,
      calculated([], () => Object.hasOwn(overrides, name) ? overrides[name] : fallback),
    ]),
  ))
}

export function projectName(location, scope) {
  if (!location.startsWith('//')) {
    throw new Error(`Expected a logical package location, got ${JSON.stringify(location)}`)
  }
  const path = location.slice(2)
  const relativePath = path.startsWith('packages/') ? path.slice('packages/'.length) : path
  if (!relativePath) throw new Error(`Cannot infer a project name from ${location}`)
  return `@${scope}/${relativePath.replaceAll('/', '-')}`
}

const unique = values => [...new Set(values.flat())]

const mergeObjects = (label, values) => {
  const result = {}
  for (const value of values) {
    for (const [key, entry] of Object.entries(value)) {
      if (Object.hasOwn(result, key)) {
        throw new Error(`${label} contribution ${JSON.stringify(key)} has more than one owner`)
      }
      result[key] = entry
    }
  }
  return result
}

const present = entries => Object.fromEntries(entries.filter(([, value]) => value !== undefined))

const validateMetadata = (name, metadata, metadataFields) => {
  const conflicts = Object.keys(metadata).filter(field => !metadataFields.includes(field))
  if (conflicts.length > 0) {
    const plural = conflicts.length === 1 ? '' : 's'
    throw new Error(`${name}: package metadata cannot configure non-metadata field${plural} ${conflicts.join(', ')}`)
  }
  return metadata
}

const dependencyEntries = (name, scope, deps, versions, dependencyLocations, runtimePackages) => {
  for (const dependency of deps) {
    const sources = ['pkg', 'npm'].filter(source => source in dependency)
    if (sources.length !== 1) throw new Error(`${name}: dependency needs exactly one of pkg or npm`)
    if (!dependencyLocations.includes(dependency.at)) {
      throw new Error(`${name}: dependency ${dependency.pkg ?? dependency.npm} needs at ${dependencyLocations.join(' or ')}, got ${JSON.stringify(dependency.at)}`)
    }
    if ('npm' in dependency && versions[dependency.npm] === undefined) {
      throw new Error(`${name}: no version configured for npm dependency ${dependency.npm}`)
    }
  }
  for (const pkg of runtimePackages) {
    if (versions[pkg] === undefined) {
      throw new Error(`${name}: no version configured for stack runtime dependency ${pkg}`)
    }
  }
  const entry = dependency => 'pkg' in dependency
    ? [projectName(dependency.pkg, scope), '>=0.0.0']
    : [dependency.npm, versions[dependency.npm]]
  const at = location => deps.filter(dependency => dependency.at === location).map(entry)
  return {
    prod: [...runtimePackages.map(pkg => [pkg, versions[pkg]]), ...at('prod')],
    dev: at('dev'),
  }
}

function aggregateModule(contributions) {
  const deps = kind => contributions[kind] ?? []
  return calculationModule('feature-contributions', {
    featureToolPackages: calculated(deps('toolPackages'), (...values) => unique(values)),
    featureRuntimePackages: calculated(deps('runtimePackages'), (...values) => unique(values)),
    featureAmbientTypes: calculated(deps('ambientTypes'), (...values) => unique(values)),
    featureGeneratedFiles: calculated(
      deps('generatedFiles'),
      (...values) => mergeObjects('generated file', values),
    ),
    featureAllowBuilds: calculated(deps('allowBuilds'), (...values) => unique(values)),
  })
}

const coreModule = calculationModule('typescript-semantics', {
  location: external(),
  scope: external(),
  version: external(),
  deps: external(),
  metadata: external(),
  versions: external(),
  target: target(),

  action: calculated(['target', 'targetActions'], (selectedTarget, targetActions) => {
    const action = targetActions[selectedTarget]
    if (action === undefined) throw new Error(`Unknown TypeScript target ${JSON.stringify(selectedTarget)}`)
    return action
  }),
  name: calculated(['location', 'scope'], projectName),
  slug: calculated(['name'], name => name.slice(name.indexOf('/') + 1)),
  validatedMetadata: calculated(['name', 'metadata', 'metadataFields'], validateMetadata),
  sourceLayout: calculated(
    ['sourceDirectory', 'entryFile'],
    (directory, entry) => ({ directory, entry }),
  ),
  sourceEntry: calculated(['sourceLayout'], layout => `${layout.directory}/${layout.entry}`),
  outputLayout: calculated(
    ['productKind', 'outputDirectory', 'entryFile'],
    (product, directory, entry) => {
      if (product === 'worker') return undefined
      if (product === 'web') return { directory }
      const stem = entry.replace(/\.[^.]+$/, '')
      return {
        directory,
        runtimeFile: `${directory}/${stem}.js`,
        declarationFile: `${directory}/${stem}.d.ts`,
      }
    },
  ),
  distributionIntent: calculated(
    ['action', 'distributionActions'],
    (action, actions) => actions.includes(action),
  ),
  emissionIntent: calculated(
    ['productKind', 'action', 'emitActions'],
    (product, action, actions) => product === 'library' && actions.includes(action),
  ),
  testSourcesIncluded: calculated(
    ['productKind', 'action', 'testSourceActions'],
    (product, action, actions) => product !== 'library' || actions.includes(action),
  ),
  sourceSet: calculated(
    ['productKind', 'sourceLayout', 'testSourcesIncluded'],
    (product, layout, includeTests) => ({
      include: [`${layout.directory}/**/${product === 'web' ? '*' : '*.ts'}`],
      exclude: includeTests
        ? undefined
        : [`${layout.directory}/**/*.test.ts`, `${layout.directory}/**/*.spec.ts`],
    }),
  ),
  runtimeEntry: calculated(
    ['productKind', 'distributionIntent', 'sourceEntry', 'outputLayout'],
    (product, distribution, source, output) => product === 'library'
      ? `./${distribution ? output.runtimeFile : source}`
      : undefined,
  ),
  declarationEntry: calculated(
    ['productKind', 'distributionIntent', 'sourceEntry', 'outputLayout'],
    (product, distribution, source, output) => product === 'library'
      ? `./${distribution ? output.declarationFile : source}`
      : undefined,
  ),
  emittedArtifacts: calculated(
    ['productKind', 'distributionIntent', 'outputLayout'],
    (product, distribution, output) => {
      if (product === 'web') return [output.directory]
      if (product === 'library' && distribution) return [output.directory]
      return []
    },
  ),
  publishable: calculated(
    ['action', 'publishAction'],
    (action, publishAction) => action === publishAction,
  ),
  sourceMapEmission: calculated(
    ['sourceMapIntent', 'emissionIntent'],
    (requested, emitting) => requested && emitting,
  ),
  ambientTypes: calculated(['featureAmbientTypes'], types => types),
})

const packageModule = calculationModule('package-json-fields', {
  dependencyEntries: calculated(
    ['name', 'scope', 'deps', 'versions', 'dependencyLocations', 'featureRuntimePackages'],
    dependencyEntries,
  ),
  toolDependencyEntries: calculated(['name', 'versions', 'featureToolPackages'], (name, versions, packages) =>
    packages.map(pkg => {
      if (versions[pkg] === undefined) throw new Error(`${name}: no version configured for stack dependency ${pkg}`)
      return [pkg, versions[pkg]]
    })),
  'packageJson.name': calculated(['name'], value => value),
  'packageJson.version': calculated(['version'], value => value),
  'packageJson.type': calculated(
    ['javascriptModuleFormat'],
    format => format === 'esm' ? 'module' : 'commonjs',
  ),
  'packageJson.private': calculated(['publishable'], value => !value),
  'packageJson.main': calculated(['runtimeEntry'], value => value),
  'packageJson.types': calculated(['declarationEntry'], value => value),
  'packageJson.exports': calculated(
    ['runtimeEntry', 'declarationEntry'],
    (runtime, declarations) => runtime === undefined
      ? undefined
      : { '.': { types: declarations, import: runtime } },
  ),
  'packageJson.files': calculated(
    ['productKind', 'distributionIntent', 'emittedArtifacts'],
    (product, distribution, artifacts) => product === 'library' && distribution ? artifacts : undefined,
  ),
  'packageJson.imports': calculated(
    ['sourceAlias'],
    alias => alias === undefined ? undefined : { [alias.specifier]: alias.sourcePath },
  ),
  'packageJson.dependencies': calculated(
    ['dependencyEntries'],
    entries => Object.fromEntries(entries.prod),
  ),
  'packageJson.devDependencies': calculated(
    ['action', 'developmentActions', 'dependencyEntries', 'toolDependencyEntries'],
    (action, actions, dependencies, tools) => actions.includes(action)
      ? Object.fromEntries([...tools, ...dependencies.dev])
      : undefined,
  ),
  packageJson: calculated(
    [
      'validatedMetadata',
      'packageJson.name',
      'packageJson.version',
      'packageJson.type',
      'packageJson.private',
      'packageJson.main',
      'packageJson.types',
      'packageJson.exports',
      'packageJson.files',
      'packageJson.imports',
      'packageJson.dependencies',
      'packageJson.devDependencies',
    ],
    (metadata, name, version, type, isPrivate, main, types, exports, files, imports,
      dependencies, devDependencies) => ({
      ...metadata,
      ...present([
        ['name', name], ['version', version], ['type', type], ['private', isPrivate],
        ['main', main], ['types', types], ['exports', exports], ['files', files], ['imports', imports],
        ['dependencies', dependencies], ['devDependencies', devDependencies],
      ]),
    }),
  ),
})

const tsconfigModule = calculationModule('tsconfig-fields', {
  'tsconfig.extends': calculated([], () => '@tsconfig/strictest/tsconfig.json'),
  'tsconfig.include': calculated(['sourceSet'], value => value.include),
  'tsconfig.exclude': calculated(['sourceSet'], value => value.exclude),
  'tsconfig.compilerOptions.rootDir': calculated(['sourceLayout'], value => value.directory),
  'tsconfig.compilerOptions.outDir': calculated(
    ['emissionIntent', 'outputLayout'],
    (emit, output) => emit ? output.directory : undefined,
  ),
  'tsconfig.compilerOptions.target': calculated(['languageTarget'], value => value),
  'tsconfig.compilerOptions.lib': calculated(['standardLibraries'], value => value),
  'tsconfig.compilerOptions.module': calculated(['moduleKind'], value => value),
  'tsconfig.compilerOptions.moduleResolution': calculated(['moduleResolutionKind'], value => value),
  'tsconfig.compilerOptions.noEmit': calculated(['emissionIntent'], emit => !emit),
  'tsconfig.compilerOptions.declaration': calculated(
    ['productKind', 'emissionIntent'],
    (product, emit) => product === 'library' && emit ? true : undefined,
  ),
  'tsconfig.compilerOptions.sourceMap': calculated(
    ['sourceMapEmission'],
    value => value ? true : undefined,
  ),
  'tsconfig.compilerOptions.inlineSources': calculated(
    ['sourceMapEmission'],
    value => value ? true : undefined,
  ),
  'tsconfig.compilerOptions.types': calculated(
    ['ambientTypes'],
    value => value.length > 0 ? value : undefined,
  ),
  'tsconfig.compilerOptions.paths': calculated(
    ['sourceAlias'],
    alias => alias === undefined ? undefined : { [alias.specifier]: [alias.sourcePath] },
  ),
  'tsconfig.compilerOptions.allowImportingTsExtensions': calculated(
    ['productKind'],
    product => product === 'web' ? true : undefined,
  ),
  'tsconfig.compilerOptions.moduleDetection': calculated(
    ['productKind'],
    product => product === 'web' ? 'force' : undefined,
  ),
  'tsconfig.compilerOptions.jsx': calculated(
    ['productKind'],
    product => product === 'web' ? 'react-jsx' : undefined,
  ),
  compilerOptions: calculated(
    [
      'tsconfig.compilerOptions.rootDir',
      'tsconfig.compilerOptions.outDir',
      'tsconfig.compilerOptions.target',
      'tsconfig.compilerOptions.lib',
      'tsconfig.compilerOptions.module',
      'tsconfig.compilerOptions.moduleResolution',
      'tsconfig.compilerOptions.noEmit',
      'tsconfig.compilerOptions.declaration',
      'tsconfig.compilerOptions.sourceMap',
      'tsconfig.compilerOptions.inlineSources',
      'tsconfig.compilerOptions.types',
      'tsconfig.compilerOptions.paths',
      'tsconfig.compilerOptions.allowImportingTsExtensions',
      'tsconfig.compilerOptions.moduleDetection',
      'tsconfig.compilerOptions.jsx',
    ],
    (rootDir, outDir, target, lib, module, moduleResolution, noEmit, declaration,
      sourceMap, inlineSources, types, paths, allowImportingTsExtensions, moduleDetection, jsx) => present([
      ['rootDir', rootDir], ['outDir', outDir], ['target', target], ['lib', lib], ['module', module],
      ['moduleResolution', moduleResolution], ['noEmit', noEmit], ['declaration', declaration],
      ['sourceMap', sourceMap], ['inlineSources', inlineSources], ['types', types], ['paths', paths],
      ['allowImportingTsExtensions', allowImportingTsExtensions],
      ['moduleDetection', moduleDetection], ['jsx', jsx],
    ]),
  ),
  tsconfig: calculated(
    ['tsconfig.extends', 'tsconfig.include', 'tsconfig.exclude', 'compilerOptions'],
    (extendsConfig, include, exclude, compilerOptions) => present([
      ['extends', extendsConfig], ['include', include], ['exclude', exclude], ['compilerOptions', compilerOptions],
    ]),
  ),
})

const projectionModule = calculationModule('tool-projections', {
  files: calculated(
    ['packageJson', 'tsconfig', 'featureGeneratedFiles'],
    (packageJson, tsconfig, generated) => ({ 'package.json': packageJson, 'tsconfig.json': tsconfig, ...generated }),
  ),
  allowBuilds: calculated(['featureAllowBuilds'], value => value),
  output: calculated(['outputLayout'], value => value),
  projection: calculated(
    [
      'target', 'action', 'name', 'slug', 'packageJson', 'tsconfig', 'files', 'output',
      'allowBuilds', 'buildAssets', 'sourceLayout', 'sourceSet', 'runtimeEntry',
      'declarationEntry', 'emittedArtifacts',
    ],
    (selectedTarget, action, name, slug, packageJson, tsconfig, files, output,
      allowBuilds, buildAssets, sourceLayout, sourceSet, runtimeEntry, declarationEntry,
      emittedArtifacts) => ({
      target: selectedTarget,
      action,
      name,
      slug,
      packageJson,
      tsconfig,
      files,
      output,
      allowBuilds,
      buildAssets,
      semantics: { sourceLayout, sourceSet, outputLayout: output, runtimeEntry, declarationEntry, emittedArtifacts },
    }),
  ),
})

function validateFeatures(features) {
  const archetypes = features.filter(feature => feature.role === 'archetype')
  if (archetypes.length !== 1) {
    throw new Error(`A TypeScript stack needs exactly one archetype, got ${archetypes.length}`)
  }
  const duplicate = features.find((feature, index) => features.findIndex(other => other.name === feature.name) !== index)
  if (duplicate) throw new Error(`TypeScript stack feature ${JSON.stringify(duplicate.name)} was added more than once`)
}

export function typescriptCalculationGraph(features, conventions = {}) {
  validateFeatures(features)
  const featureGraph = mergeCalculationModules(features.map(feature => feature.module))
  return mergeCalculationModules([
    conventionModule(conventions),
    coreModule,
    ...features.map(feature => feature.module),
    aggregateModule(featureGraph.contributions),
    packageModule,
    tsconfigModule,
    projectionModule,
  ])
}

export function typescriptProjector(di, {
  location,
  scope,
  version,
  deps = [],
  metadata = {},
  versions,
  features,
  conventions = {},
}) {
  const graph = typescriptCalculationGraph(features, conventions)
  const externalValues = {
    location,
    scope,
    version,
    deps,
    metadata,
    versions,
    ...Object.assign({}, ...features.map(feature => feature.externalValues)),
  }
  const calculate = (selectedTarget, roots) => compileCalculationGraph(
    graph,
    di,
    externalValues,
    { target: selectedTarget },
    roots,
  )
  return Object.freeze({
    graph,
    project: selectedTarget => calculate(selectedTarget, ['projection']).projection,
  })
}
