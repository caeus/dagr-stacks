import bundledVersions from '//dagr.versions.yaml'
import di from '//di//dagr.di.js'
import { writeJson, writeText, writeYaml } from '//dagr.file_utils.js'
import { pnpmfile } from '//dagr.utils.js'
import { RECOMMENDED_IGNORE } from '//dagr.dockerignore.js'
import { typescriptProgram } from '//dagr.program.js'

export * from '//dagr.features.js'

function writeProjectedFile(path, value) {
  return typeof value === 'string'
    ? writeText(`/repo/${path}`, value)
    : writeJson(`/repo/${path}`, value)
}

const copySource = directory => ({ COPY: { src: directory, dest: `/repo/${directory}` } })
const copyAssets = assets => assets.map(path => ({ COPY: { src: path, dest: `/repo/${path}` } }))
const targetName = target => `${target.facet}:${target.name}`

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
  const program = typescriptProgram(di, {
    location,
    scope,
    version,
    deps,
    metadata,
    versions,
    features,
    conventions,
  })

  const dependenciesIn = (target, candidates) => candidates
    .filter(candidate => target.deps.includes(targetName(candidate)))
  const targets = []
  const remainingTargets = [...program.targets]
  while (remainingTargets.length > 0) {
    const next = remainingTargets.findIndex(target =>
      dependenciesIn(target, program.targets).every(dependency => targets.includes(dependency)))
    if (next === -1) throw new Error('Circular TypeScript target dependencies')
    targets.push(remainingTargets.splice(next, 1)[0])
  }
  const dependenciesOf = target => dependenciesIn(target, targets).map(candidate => candidate.name)

  const configuration = workspace => ({
    deps: [base],
    run: ({ images }) => ({
      FROM: images[base],
      steps: [
        { WORKDIR: '/repo' },
        ...Object.entries(workspace.files).map(([path, value]) => writeProjectedFile(path, value)),
      ],
      IGNORE: ignore,
    }),
  })

  const install = (name, workspace) => ({
    deps: [`config:${name}`, ...packTargets],
    run: ({ images }) => ({
      FROM: images[`config:${name}`],
      steps: [
        ...localDeps.map(dependency => ({
          COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/repo' },
        })),
        { WORKDIR: '/repo' },
        writeText('/repo/.pnpmfile.cjs', pnpmfile(scope)),
        ...(workspace.allowBuilds.length > 0
          ? [writeYaml('/repo/pnpm-workspace.yaml', {
              allowBuilds: Object.fromEntries(workspace.allowBuilds.map(pkg => [pkg, true])),
            })]
          : []),
        { RUN: 'pnpm install --prod=false' },
      ],
      IGNORE: ignore,
    }),
  })

  const command = (target, workspace) => ({
    deps: [`install-${target.name}`, ...dependenciesOf(target)],
    run: ({ images }) => ({
      FROM: images[`install-${target.name}`],
      steps: [
        copySource(workspace.semantics.sourceLayout.directory),
        ...(target.assets ? copyAssets(workspace.buildAssets) : []),
        { WORKDIR: '/repo' },
        { RUN: target.command },
      ],
      IGNORE: ignore,
      ...(target.export ? { EXPORT: target.export } : {}),
    }),
  })

  const pack = (target, workspace, slug) => ({
    deps: [...dependenciesOf(target), ...packTargets],
    run: ({ images }) => ({
      FROM: images.build,
      steps: [
        ...localDeps.map(dependency => ({
          COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/out' },
        })),
        { WORKDIR: '/repo' },
        writeJson('/repo/package.json', workspace.packageJson),
        { RUN: `mkdir -p /tmp/pack /out && pnpm pack --pack-destination /tmp/pack && mv /tmp/pack/*.tgz /out/${slug}.tgz` },
      ],
      IGNORE: ignore,
    }),
  })

  const devInstall = workspace => ({
    deps: ['config:dev', ...packTargets],
    run: ({ images, host }) => ({
      FROM: images['config:dev'],
      steps: [
        ...localDeps.map(dependency => ({
          COPY: { from: images[packTarget(dependency)], src: '/out', dest: '/repo' },
        })),
        { WORKDIR: '/repo' },
        writeText('/repo/.pnpmfile.cjs', pnpmfile(scope)),
        ...(workspace.allowBuilds.length > 0
          ? [writeYaml('/repo/pnpm-workspace.yaml', {
              allowBuilds: Object.fromEntries(workspace.allowBuilds.map(pkg => [pkg, true])),
            })]
          : []),
        { RUN: `pnpm install --prod=false --os ${host.os} --cpu ${host.arch}` },
      ],
      IGNORE: ignore,
      EXPORT: { '/repo/node_modules': 'node_modules' },
    }),
  })

  const materialize = (target, workspace, slug) => {
    if (target.kind === 'command') return command(target, workspace)
    if (target.kind === 'pack') return pack(target, workspace, slug)
    if (target.kind === 'dev-install') return devInstall(workspace)
    throw new Error(`Unknown TypeScript target kind ${JSON.stringify(target.kind)}`)
  }

  const configurationNames = [
    'dev',
    ...new Set(targets.filter(target => target.kind === 'command').map(target => target.name)),
  ]
  const targetContributions = [
    ...configurationNames.map(name => ({
      facet: 'config',
      name,
      workspace: `config:${name}`,
      factory: workspace => configuration(workspace),
    })),
    {
      facet: 'dev',
      name: 'sync',
      workspace: 'dev:sync',
      factory: workspace => ({
        deps: ['config:dev'],
        run: ({ images }) => ({
          FROM: images['config:dev'],
          steps: [],
          IGNORE: ignore,
          EXPORT: Object.fromEntries(Object.keys(workspace.files).map(path => [`/repo/${path}`, path])),
        }),
      }),
    },
    ...configurationNames.filter(name => name !== 'dev').map(name => ({
      facet: 'ci',
      name: `install-${name}`,
      workspace: `config:${name}`,
      factory: workspace => install(name, workspace),
    })),
    ...targets.map(target => ({
      facet: target.facet,
      name: target.name,
      workspace: target.kind === 'dev-install' ? 'config:dev' : targetName(target),
      spec: targetName(target),
      factory: (workspace, slug, specs) => materialize(specs[targetName(target)], workspace, slug),
    })),
  ]

  const duplicateTarget = targetContributions.find((candidate, index) =>
    targetContributions.findIndex(other => other.facet === candidate.facet && other.name === candidate.name) !== index)
  if (duplicateTarget) {
    throw new Error(`TypeScript target ${JSON.stringify(`${duplicateTarget.facet}:${duplicateTarget.name}`)} already exists`)
  }

  const facetsTag = Symbol('typescript facets')
  const facetTags = new Map([...new Set(targetContributions.map(target => target.facet))]
    .map(facet => [facet, Symbol(`typescript ${facet} targets`)]))
  const bindings = {}

  for (const contribution of targetContributions) {
    const fullName = `${contribution.facet}:${contribution.name}`
    const deps = [program.key(contribution.workspace, 'workspace'), program.key('dev:sync', 'slug')]
    if (contribution.spec) deps.push(program.key('dev:sync', 'featureTargets'))
    bindings[`target:${fullName}`] = di.toFun(
      deps,
      (workspace, slug, specs) => ({ name: contribution.name, target: contribution.factory(workspace, slug, specs) }),
      [facetTags.get(contribution.facet)],
    )
  }

  for (const [facet, targetsTag] of facetTags) {
    bindings[`facet:${facet}`] = di.toFun(
      [{ tag: targetsTag }],
      contributions => ({
        name: facet,
        targets: Object.fromEntries(Reflect.ownKeys(contributions).map(key => {
          const contribution = contributions[key]
          return [contribution.name, contribution.target]
        })),
      }),
      [facetsTag],
    )
  }

  let calculations
  bindings.index = di.toFun(
    [{ tag: facetsTag }, program.key('dev:sync', 'name'), program.key('dev:sync', 'slug')],
    (facetContributions, name, slug) => transform(
      Object.fromEntries(Reflect.ownKeys(facetContributions).map(key => {
        const facet = facetContributions[key]
        return [facet.name, facet.targets]
      })),
      { location, name, slug, calculations, features },
    ),
  )

  calculations = Object.freeze({
    nodes: Object.freeze({
      ...program.graph.nodes,
      ...Object.fromEntries(Object.entries(bindings).map(([name, definition]) => [
        name,
        Object.freeze({ kind: 'calculated', deps: definition.deps, tags: definition.tags }),
      ])),
    }),
    owners: Object.freeze({
      ...program.graph.owners,
      ...Object.fromEntries(Object.keys(bindings).map(name => [name, 'typescript-targets'])),
    }),
  })

  return program.module
    .merge(di.module(bindings))
    .shake(['index'])
    .compile()
    .index
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
