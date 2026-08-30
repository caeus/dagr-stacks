import bundledVersions from '//dagr.versions.yaml'
import di from '//di//dagr.di.js'
import { writeJson, writeText, writeYaml } from '//dagr.file_utils.js'
import { pnpmfile } from '//dagr.utils.js'
import { RECOMMENDED_IGNORE } from '//dagr.dockerignore.js'
import { typescriptProjector } from '//dagr.projections.js'

export * from '//dagr.features.js'

function writeProjectedFile(path, value) {
  return typeof value === 'string'
    ? writeText(`/repo/${path}`, value)
    : writeJson(`/repo/${path}`, value)
}

const copySource = directory => ({ COPY: { src: directory, dest: `/repo/${directory}` } })

const copyAssets = assets => assets.map(path => ({ COPY: { src: path, dest: `/repo/${path}` } }))

function createStack(options, features, declaration) {
  const {
    base = '//packages/base:ci:node-pnpm',
    scope = 'internal',
    versions = bundledVersions.deps,
    conventions = {},
    ignore = RECOMMENDED_IGNORE,
    transform = index => index,
  } = options
  const { location, version = '0.1.0', deps = [], metadata = {} } = declaration
  const localDeps = deps.filter(dependency => 'pkg' in dependency)
  const packTarget = dependency => `${dependency.pkg}:ci:pack`
  const packTargets = localDeps.map(packTarget)
  const { graph, project } = typescriptProjector(di, {
    location,
    scope,
    version,
    deps,
    metadata,
    versions,
    features,
    conventions,
  })
  const dev = project('dev:sync')
  const { name, slug } = dev
  const unorderedTargets = Object.values(dev.targets)
  const targetName = target => `${target.facet}:${target.name}`
  const dependenciesIn = (target, candidates) => candidates
    .filter(candidate => target.deps.includes(targetName(candidate)))

  const targets = []
  const remainingTargets = [...unorderedTargets]
  while (remainingTargets.length > 0) {
    const next = remainingTargets.findIndex(target =>
      dependenciesIn(target, unorderedTargets).every(dependency => targets.includes(dependency)))
    if (next === -1) throw new Error('Circular TypeScript target dependencies')
    targets.push(remainingTargets.splice(next, 1)[0])
  }

  const configuration = target => {
    const projection = project(target)
    return {
      deps: [base],
      run: ({ images }) => ({
        FROM: images[base],
        steps: [
          { WORKDIR: '/repo' },
          ...Object.entries(projection.files).map(([path, value]) => writeProjectedFile(path, value)),
        ],
        IGNORE: ignore,
      }),
    }
  }

  const install = action => ({
    deps: [`config:${action}`, ...packTargets],
    run: ({ images }) => {
      const projection = project(`config:${action}`)
      return {
        FROM: images[`config:${action}`],
        steps: [
          ...localDeps.map(dependency => ({
            COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/repo' },
          })),
          { WORKDIR: '/repo' },
          writeText('/repo/.pnpmfile.cjs', pnpmfile(scope)),
          ...(projection.allowBuilds.length > 0
            ? [writeYaml('/repo/pnpm-workspace.yaml', {
                allowBuilds: Object.fromEntries(projection.allowBuilds.map(pkg => [pkg, true])),
              })]
            : []),
          { RUN: 'pnpm install --prod=false' },
        ],
        IGNORE: ignore,
      }
    },
  })

  const dependenciesOf = target => dependenciesIn(target, targets)
    .map(candidate => candidate.name)

  const command = target => ({
    deps: [`install-${target.name}`, ...dependenciesOf(target)],
    run: ({ images }) => {
      const projection = project(targetName(target))
      return {
        FROM: images[`install-${target.name}`],
        steps: [
          copySource(projection.semantics.sourceLayout.directory),
          ...(target.assets ? copyAssets(projection.buildAssets) : []),
          { WORKDIR: '/repo' },
          { RUN: target.command },
        ],
        IGNORE: ignore,
        ...(target.export ? { EXPORT: target.export } : {}),
      }
    },
  })

  const pack = target => ({
    deps: [...dependenciesOf(target), ...packTargets],
    run: ({ images }) => ({
      FROM: images.build,
      steps: [
        ...localDeps.map(dependency => ({
          COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/out' },
        })),
        { WORKDIR: '/repo' },
        writeJson('/repo/package.json', project(targetName(target)).packageJson),
        { RUN: `mkdir -p /tmp/pack /out && pnpm pack --pack-destination /tmp/pack && mv /tmp/pack/*.tgz /out/${slug}.tgz` },
      ],
      IGNORE: ignore,
    }),
  })

  const devInstall = () => ({
    deps: ['config:dev', ...packTargets],
    run: ({ images, host }) => {
      const projection = project('config:dev')
      return {
        FROM: images['config:dev'],
        steps: [
          ...localDeps.map(dependency => ({
            COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/repo' },
          })),
          { WORKDIR: '/repo' },
          writeText('/repo/.pnpmfile.cjs', pnpmfile(scope)),
          ...(projection.allowBuilds.length > 0
            ? [writeYaml('/repo/pnpm-workspace.yaml', {
                allowBuilds: Object.fromEntries(projection.allowBuilds.map(pkg => [pkg, true])),
              })]
            : []),
          { RUN: `pnpm install --prod=false --os ${host.os} --cpu ${host.arch}` },
        ],
        IGNORE: ignore,
        EXPORT: { '/repo/node_modules': 'node_modules' },
      }
    },
  })

  const materialize = target => {
    if (target.kind === 'command') return command(target)
    if (target.kind === 'pack') return pack(target)
    if (target.kind === 'dev-install') return devInstall(target)
    throw new Error(`Unknown TypeScript target kind ${JSON.stringify(target.kind)}`)
  }

  const configActions = [
    'dev',
    ...new Set(targets.filter(target => target.kind === 'command').map(target => target.name)),
  ]
  const installActions = configActions.filter(action => action !== 'dev')
  const index = {
    config: Object.fromEntries(configActions.map(action => [action, configuration(`config:${action}`)])),
    dev: {
      sync: {
        deps: ['config:dev'],
        run: ({ images }) => ({
          FROM: images['config:dev'],
          steps: [],
          IGNORE: ignore,
          EXPORT: Object.fromEntries(Object.keys(dev.files).map(path => [`/repo/${path}`, path])),
        }),
      },
    },
    ci: {
      ...Object.fromEntries(installActions.map(action => [`install-${action}`, install(action)])),
    },
  }

  for (const target of targets) {
    index[target.facet] ??= {}
    if (Object.hasOwn(index[target.facet], target.name)) {
      throw new Error(`TypeScript target ${JSON.stringify(targetName(target))} already exists`)
    }
    index[target.facet][target.name] = materialize(target)
  }

  return transform(index, {
    location,
    name,
    slug,
    project,
    calculations: graph,
    features,
  })
}

function builder(options, features) {
  const stack = declaration => createStack(options, features, declaration)
  return Object.assign(stack, {
    with(next) {
      if (!next?.module || !next?.name) throw new Error('with() expects a TypeScript stack feature')
      if (features.some(feature => feature.name === next.name)) {
        throw new Error(`TypeScript stack feature ${JSON.stringify(next.name)} was added more than once`)
      }
      return builder(options, [...features, next])
    },
    features: Object.freeze([...features]),
  })
}

export default function typescript(options = {}) {
  return builder(options, [])
}
