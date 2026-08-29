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
  const archetypes = features.filter(feature => feature.role === 'archetype')
  if (archetypes.length !== 1) {
    throw new Error(`A TypeScript stack needs exactly one archetype, got ${archetypes.length}`)
  }
  const archetype = archetypes[0]
  const execution = Object.assign({}, ...features.map(feature => feature.execution))
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
  const { name, slug } = project('dev:sync')

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

  const check = (action, command) => ({
    deps: [`install-${action}`],
    run: ({ images }) => {
      const projection = project(`ci:${action}`)
      return {
        FROM: images[`install-${action}`],
        steps: [
          copySource(projection.semantics.sourceLayout.directory),
          { WORKDIR: '/repo' },
          { RUN: command },
        ],
        IGNORE: ignore,
      }
    },
  })

  const qualityTargets = [
    ...(execution.lint ? ['lint'] : []),
    ...(execution.test ? ['test'] : []),
  ]

  const build = execution.build && {
    deps: ['install-build', ...qualityTargets],
    run: ({ images }) => {
      const projection = project('ci:build')
      return {
        FROM: images['install-build'],
        steps: [
          copySource(projection.semantics.sourceLayout.directory),
          ...copyAssets(projection.buildAssets),
          { WORKDIR: '/repo' },
          { RUN: execution.build === 'vite' ? 'pnpm exec vite build' : 'pnpm exec tsc' },
        ],
        IGNORE: ignore,
      }
    },
  }

  const pack = target => ({
    deps: ['build', ...packTargets],
    run: ({ images }) => ({
      FROM: images.build,
      steps: [
        ...localDeps.map(dependency => ({
          COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/out' },
        })),
        { WORKDIR: '/repo' },
        writeJson('/repo/package.json', project(target).packageJson),
        { RUN: `mkdir -p /tmp/pack /out && pnpm pack --pack-destination /tmp/pack && mv /tmp/pack/*.tgz /out/${slug}.tgz` },
      ],
      IGNORE: ignore,
    }),
  })

  const configActions = [
    'dev',
    ...(execution.typecheck ? ['typecheck'] : []),
    ...(execution.test ? ['test'] : []),
    ...(execution.lint ? ['lint'] : []),
    ...(execution.docs ? ['docs'] : []),
    ...(execution.build ? ['build'] : []),
  ]
  const installActions = configActions.filter(action => action !== 'dev')
  const dev = project('dev:sync')
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
      ...(execution.devInstall
        ? {
            install: {
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
            },
          }
        : {}),
    },
    ci: {
      ...Object.fromEntries(installActions.map(action => [`install-${action}`, install(action)])),
      ...(execution.typecheck ? { typecheck: check('typecheck', 'pnpm exec tsc --noEmit') } : {}),
      ...(execution.test ? { test: check('test', 'pnpm exec vitest run') } : {}),
      ...(execution.lint ? { lint: check('lint', 'pnpm exec eslint .') } : {}),
      ...(build ? { build } : {}),
      ...(execution.docs
        ? {
            docs: {
              deps: ['install-docs'],
              run: ({ images }) => {
                const projection = project('ci:docs')
                return {
                  FROM: images['install-docs'],
                  steps: [
                    copySource(projection.semantics.sourceLayout.directory),
                    { WORKDIR: '/repo' },
                    { RUN: 'pnpm exec typedoc' },
                  ],
                  IGNORE: ignore,
                  EXPORT: { '/repo/docs/': 'docs/' },
                }
              },
            },
          }
        : {}),
      ...(execution.pack ? { pack: pack('ci:pack') } : {}),
    },
    ...(execution.pack ? { publish: { pack: pack('publish:pack') } } : {}),
  }

  return transform(index, {
    location,
    name,
    slug,
    project,
    calculations: graph,
    features,
    archetype,
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
