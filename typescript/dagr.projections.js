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

const POLICY = Object.freeze({
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
  vitestActions: Object.freeze(['dev', 'test']),
  vitestDependencyActions: Object.freeze(['dev', 'typecheck', 'test', 'lint']),
  vitestTypeActions: Object.freeze(['dev', 'typecheck', 'test', 'lint']),
  eslintActions: Object.freeze(['dev', 'lint']),
  typedocActions: Object.freeze(['dev', 'docs']),
  viteActions: Object.freeze(['dev', 'test', 'build']),
  testSourceActions: Object.freeze(['dev', 'typecheck', 'test', 'lint']),
  devAction: 'dev',
  publishAction: 'publish',
  dependencyLocations: Object.freeze(['prod', 'dev']),
  metadataFields: Object.freeze([
    'author',
    'bugs',
    'contributors',
    'description',
    'funding',
    'homepage',
    'keywords',
    'license',
    'repository',
  ]),
  sourceDirectory: 'src',
  entryFile: 'index.ts',
  outputDirectory: 'dist',
  moduleType: 'module',
})

export function projectName(location, scope) {
  if (!location.startsWith('//')) {
    throw new Error(`Expected a logical package location, got ${JSON.stringify(location)}`)
  }
  const path = location.slice(2)
  const relativePath = path.startsWith('packages/') ? path.slice('packages/'.length) : path
  if (!relativePath) throw new Error(`Cannot infer a project name from ${location}`)
  return `@${scope}/${relativePath.replaceAll('/', '-')}`
}

const validateMetadata = (name, metadata, metadataFields) => {
  const conflicts = Object.keys(metadata).filter(field => !metadataFields.includes(field))
  if (conflicts.length > 0) {
    const plural = conflicts.length === 1 ? '' : 's'
    throw new Error(`${name}: package metadata cannot configure non-metadata field${plural} ${conflicts.join(', ')}`)
  }
  return metadata
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

const mergeConfig = (left, right) => {
  const result = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (Array.isArray(value)) {
      result[key] = unique([...(Array.isArray(result[key]) ? result[key] : []), ...value])
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeConfig(result[key] ?? {}, value)
    } else if (result[key] !== undefined && result[key] !== value) {
      throw new Error(`TypeScript configuration contribution ${JSON.stringify(key)} conflicts`)
    } else {
      result[key] = value
    }
  }
  return result
}

const mergeConfigs = values => values.reduce(mergeConfig, {})

const dependencyEntries = (name, scope, deps, versions, dependencyLocations, runtimePackages) => {
  for (const dependency of deps) {
    const sources = ['pkg', 'npm'].filter(source => source in dependency)
    if (sources.length !== 1) {
      throw new Error(`${name}: dependency needs exactly one of pkg or npm`)
    }
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
    featurePackageFields: calculated(deps('packageFields'), (...values) => mergeObjects('package field', values)),
    featureTsconfig: calculated(deps('tsconfig'), (...values) => mergeConfigs(values)),
    featureFiles: calculated(deps('files'), (...values) => mergeObjects('generated file', values)),
    featureAllowBuilds: calculated(deps('allowBuilds'), (...values) => unique(values)),
    featureOutput: calculated(deps('output'), (...values) => {
      if (values.length > 1) throw new Error('More than one feature owns the build output agreement')
      return values[0]
    }),
    featureBuildAssets: calculated(deps('buildAssets'), (...values) => unique(values)),
  })
}

const coreModule = calculationModule('typescript-core', {
  location: external(),
  scope: external(),
  version: external(),
  deps: external(),
  metadata: external(),
  versions: external(),
  targetActions: external(),
  developmentActions: external(),
  distributionActions: external(),
  emitActions: external(),
  vitestActions: external(),
  vitestDependencyActions: external(),
  vitestTypeActions: external(),
  eslintActions: external(),
  typedocActions: external(),
  viteActions: external(),
  testSourceActions: external(),
  devAction: external(),
  publishAction: external(),
  dependencyLocations: external(),
  metadataFields: external(),
  sourceDirectory: external(),
  entryFile: external(),
  outputDirectory: external(),
  moduleType: external(),
  target: target(),

  action: calculated(['target', 'targetActions'], (selectedTarget, targetActions) => {
    const action = targetActions[selectedTarget]
    if (action === undefined) throw new Error(`Unknown TypeScript target ${JSON.stringify(selectedTarget)}`)
    return action
  }),
  name: calculated(['location', 'scope'], projectName),
  slug: calculated(['name'], name => name.slice(name.indexOf('/') + 1)),
  validatedMetadata: calculated(['name', 'metadata', 'metadataFields'], validateMetadata),
  sourceEntry: calculated(['sourceDirectory', 'entryFile'], (directory, file) => `${directory}/${file}`),
  sourceImport: calculated(['sourceEntry'], path => `./${path}`),
  outputStem: calculated(['entryFile'], file => file.replace(/\.[^.]+$/, '')),
  outputImport: calculated(['outputDirectory', 'outputStem'], (directory, stem) => `./${directory}/${stem}.js`),
  outputTypes: calculated(['outputDirectory', 'outputStem'], (directory, stem) => `./${directory}/${stem}.d.ts`),
  publishable: calculated(['action', 'publishAction'], (action, publishAction) => action === publishAction),
})

function finalModule() {
  return calculationModule('typescript-projection', {
    dependencyEntries: calculated(
      ['name', 'scope', 'deps', 'versions', 'dependencyLocations', 'featureRuntimePackages'],
      dependencyEntries,
    ),
    toolDependencyEntries: calculated(['name', 'versions', 'featureToolPackages'], (name, versions, packages) =>
      packages.map(pkg => {
        if (versions[pkg] === undefined) {
          throw new Error(`${name}: no version configured for stack dependency ${pkg}`)
        }
        return [pkg, versions[pkg]]
      })),
    dependencyFields: calculated(
      ['action', 'developmentActions', 'dependencyEntries', 'toolDependencyEntries'],
      (action, actions, dependencies, tools) => ({
        dependencies: Object.fromEntries(dependencies.prod),
        ...(actions.includes(action)
          ? { devDependencies: Object.fromEntries([...tools, ...dependencies.dev]) }
          : {}),
      }),
    ),
    packageJson: calculated(
      ['validatedMetadata', 'name', 'version', 'moduleType', 'publishable', 'featurePackageFields', 'dependencyFields'],
      (metadata, name, version, type, publishable, fields, dependencies) => ({
        ...metadata,
        name,
        version,
        type,
        private: !publishable,
        ...fields,
        ...dependencies,
      }),
    ),
    tsconfig: calculated(['featureTsconfig'], config => config),
    files: calculated(['packageJson', 'tsconfig', 'featureFiles'], (packageJson, tsconfig, files) => ({
      'package.json': packageJson,
      'tsconfig.json': tsconfig,
      ...files,
    })),
    output: calculated(['featureOutput'], output => output),
    allowBuilds: calculated(['featureAllowBuilds'], packages => packages),
    buildAssets: calculated(['featureBuildAssets'], assets => assets),
    projection: calculated(
      ['target', 'action', 'name', 'slug', 'packageJson', 'tsconfig', 'files', 'output', 'allowBuilds', 'buildAssets'],
      (selectedTarget, action, name, slug, packageJson, tsconfig, files, output, allowBuilds, buildAssets) => ({
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
      }),
    ),
  })
}

export function typescriptCalculationGraph(features) {
  const featureGraph = mergeCalculationModules(features.map(feature => feature.module))
  return mergeCalculationModules([
    coreModule,
    ...features.map(feature => feature.module),
    aggregateModule(featureGraph.contributions),
    finalModule(),
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
}) {
  const graph = typescriptCalculationGraph(features)
  const externalValues = {
    ...POLICY,
    location,
    scope,
    version,
    deps,
    metadata,
    versions,
    ...Object.assign({}, ...features.map(feature => feature.externalValues)),
  }
  return Object.freeze({
    graph,
    project: selectedTarget => compileCalculationGraph(
      graph,
      di,
      externalValues,
      { target: selectedTarget },
      ['projection'],
    ).projection,
  })
}
