export const pnpmfile = (scope) => `const localScope = '@${scope}/'

function readPackage(pkg) {
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[depField]
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith(localScope)) {
        const tarball = name.slice(localScope.length).replace(/\\//g, '-')
        deps[name] = \`file:./\${tarball}.tgz\`
      }
    }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
`

export function projectName(location, scope) {
  if (!location.startsWith('//')) {
    throw new Error(`Expected a logical package location, got ${JSON.stringify(location)}`)
  }

  const path = location.slice(2)
  const relativePath = path.startsWith('packages/') ? path.slice('packages/'.length) : path
  if (!relativePath) {
    throw new Error(`Cannot infer a project name from ${location}`)
  }

  return `@${scope}/${relativePath.replaceAll('/', '-')}`
}

const ACTIONS = ['dev', 'typecheck', 'test', 'build', 'pack', 'publish']
const DEVELOPMENT_ACTIONS = new Set(['dev', 'typecheck', 'test', 'build'])
const DISTRIBUTION_ACTIONS = new Set(['pack', 'publish'])
const DEPENDENCY_LOCATIONS = ['prod', 'dev']
const TOOL_DEPENDENCIES = {
  dev: ['@tsconfig/strictest', 'prettier', 'typescript', 'vitest'],
  typecheck: ['@tsconfig/strictest', 'typescript', 'vitest'],
  test: ['@tsconfig/strictest', 'typescript', 'vitest'],
  build: ['@tsconfig/strictest', 'typescript'],
  pack: [],
  publish: [],
}
const METADATA_FIELDS = new Set([
  'author',
  'bugs',
  'contributors',
  'description',
  'funding',
  'homepage',
  'keywords',
  'license',
  'repository',
])

// These paths are an agreement between projections, not package input. A caller declares a
// TypeScript library; the stack is responsible for making the compiler and packager agree.
const SOURCE_ENTRY = 'src/index.ts'
const OUTPUT_DIRECTORY = 'dist'
const OUTPUT_IMPORT = `./${OUTPUT_DIRECTORY}/index.js`
const OUTPUT_TYPES = `./${OUTPUT_DIRECTORY}/index.d.ts`
const SOURCE_IMPORT = `./${SOURCE_ENTRY}`

const PRETTIER = {
  $schema: 'https://json.schemastore.org/prettierrc',
  semi: false,
  tabWidth: 2,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'none',
}

function validateDependencies(name, deps, versions) {
  for (const dependency of deps) {
    const sources = ['pkg', 'npm'].filter(source => source in dependency)
    if (sources.length !== 1) {
      throw new Error(`${name}: dependency needs exactly one of pkg or npm`)
    }
    if (!DEPENDENCY_LOCATIONS.includes(dependency.at)) {
      throw new Error(`${name}: dependency ${dependency.pkg ?? dependency.npm} needs at ${DEPENDENCY_LOCATIONS.join(' or ')}, got ${JSON.stringify(dependency.at)}`)
    }
    if ('npm' in dependency && versions[dependency.npm] === undefined) {
      throw new Error(`${name}: no version configured for npm dependency ${dependency.npm}`)
    }
  }
}

function validateMetadata(name, metadata) {
  const conflicts = Object.keys(metadata).filter(field => !METADATA_FIELDS.has(field))
  if (conflicts.length > 0) {
    throw new Error(`${name}: package metadata cannot configure non-metadata field${conflicts.length === 1 ? '' : 's'} ${conflicts.join(', ')}`)
  }
}

function dependencyFields({ name, scope, deps, versions, action }) {
  validateDependencies(name, deps, versions)

  const entry = dependency => 'pkg' in dependency
    ? [projectName(dependency.pkg, scope), '>=0.0.0']
    : [dependency.npm, versions[dependency.npm]]
  const at = location => deps.filter(dependency => dependency.at === location).map(entry)

  const dependencies = Object.fromEntries(at('prod'))
  const devDependencies = Object.fromEntries([
    ...TOOL_DEPENDENCIES[action].map(pkg => {
      if (versions[pkg] === undefined) {
        throw new Error(`${name}: no version configured for stack dependency ${pkg}`)
      }
      return [pkg, versions[pkg]]
    }),
    ...at('dev'),
  ])

  return DEVELOPMENT_ACTIONS.has(action)
    ? { dependencies, devDependencies }
    : { dependencies }
}

function packageJson({ name, scope, version, deps, metadata, versions, action }) {
  const distribution = DISTRIBUTION_ACTIONS.has(action)
  const importPath = distribution ? OUTPUT_IMPORT : SOURCE_IMPORT
  const typesPath = distribution ? OUTPUT_TYPES : SOURCE_IMPORT

  return {
    ...metadata,
    name,
    version,
    type: 'module',
    // Publishing is an action. It is not a second package-level input that can disagree with it.
    private: action !== 'publish',
    main: importPath,
    types: typesPath,
    exports: { '.': { types: typesPath, import: importPath } },
    ...(distribution ? { files: [OUTPUT_DIRECTORY] } : {}),
    ...dependencyFields({ name, scope, deps, versions, action }),
  }
}

function tsconfig(action) {
  const emit = action === 'build' || DISTRIBUTION_ACTIONS.has(action)

  return {
    extends: '@tsconfig/strictest/tsconfig.json',
    include: ['src/**/*'],
    ...(emit ? { exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'] } : {}),
    compilerOptions: {
      rootDir: 'src',
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      ...(emit
        ? { outDir: OUTPUT_DIRECTORY, declaration: true, noEmit: false }
        : { noEmit: true }),
    },
  }
}

function vitest(environment) {
  return `export default ${JSON.stringify({ test: { environment } }, null, 2)}\n`
}

/**
 * Produces target-specific tool configuration from project facts and intent.
 *
 * The returned function requires an action. Paths, private, entry points, files, compiler emission,
 * and tool-only dependencies are derived from that action and cannot be supplied independently.
 */
export function typescriptLibraryProjector({
  name,
  scope,
  version,
  deps = [],
  metadata = {},
  versions,
  testEnvironment = 'node',
}) {
  validateMetadata(name, metadata)

  return function project(action) {
    if (!ACTIONS.includes(action)) {
      throw new Error(`${name}: unknown TypeScript library action ${JSON.stringify(action)}; expected ${ACTIONS.join(', ')}`)
    }

    const manifest = packageJson({
      name,
      scope,
      version,
      deps,
      metadata,
      versions,
      action,
    })
    const compiler = tsconfig(action)
    const files = {
      'package.json': manifest,
      'tsconfig.json': compiler,
      ...(action === 'dev' ? { '.prettierrc.json': PRETTIER } : {}),
      ...(['dev', 'test'].includes(action)
        ? { 'vitest.config.js': vitest(testEnvironment) }
        : {}),
    }

    return {
      action,
      packageJson: manifest,
      tsconfig: compiler,
      files,
      output: {
        directory: OUTPUT_DIRECTORY,
        import: OUTPUT_IMPORT,
        types: OUTPUT_TYPES,
      },
    }
  }
}
