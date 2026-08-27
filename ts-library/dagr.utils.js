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

const DEPENDENCY_LOCATIONS = ['prod', 'dev']

export function buildPackageJson({ name, scope, version, deps = [], coreDeps = [], coreDevDeps = [], extra = {}, versions }) {
  // Without this a mistyped `at` would drop the dependency from both manifest fields, leaving a
  // package that installs cleanly and fails at import time.
  for (const d of deps) {
    const sources = ['pkg', 'npm'].filter(source => source in d)
    if (sources.length !== 1) {
      throw new Error(`${name}: dependency needs exactly one of pkg or npm`)
    }
    if (!DEPENDENCY_LOCATIONS.includes(d.at)) {
      throw new Error(`${name}: dependency ${d.pkg ?? d.npm} needs at ${DEPENDENCY_LOCATIONS.join(' or ')}, got ${JSON.stringify(d.at)}`)
    }
  }

  const entry = (d) => 'pkg' in d
    ? [projectName(d.pkg, scope), '>=0.0.0']
    : [d.npm, versions[d.npm]]
  const at = (location) => deps.filter(d => d.at === location).map(entry)

  const dependencies = Object.fromEntries([
    ...coreDeps.map(pkg => [pkg, versions[pkg]]),
    ...at('prod'),
  ])
  const devDependencies = Object.fromEntries([
    ...coreDevDeps.map(pkg => [pkg, versions[pkg]]),
    ...at('dev'),
  ])
  return {
    name,
    version,
    type: 'module',
    // The internal scope is not a real npm org, so a stray publish would either fail or
    // squat a name. pnpm pack still works, which is all ci:pack needs.
    private: true,
    ...extra,
    dependencies,
    devDependencies,
  }
}
