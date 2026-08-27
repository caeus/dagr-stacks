import bundledVersions from '//dagr.versions.yaml'
import { buildPackageJson, pnpmfile, projectName } from '//dagr.utils.js'
import { writeJson, writeText } from '//dagr.file_utils.js'
import { RECOMMENDED_IGNORE } from '//dagr.dockerignore.js'

const CORE_DEV_DEPS = ['@tsconfig/strictest', 'typescript']

const TSCONFIG = {
  extends: '@tsconfig/strictest/tsconfig.json',
  include: ['src/**/*'],
  compilerOptions: {
    rootDir: 'src',
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    noEmit: true,
  }
}

const PRETTIERRC = {
  $schema: 'https://json.schemastore.org/prettierrc',
  semi: false,
  tabWidth: 2,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'none',
}

const MANIFESTS = ['package.json', 'tsconfig.json', '.prettierrc.json']

export default function typescript({
  base = '//packages/base:ci:node-pnpm',
  scope = 'internal',
  versions = bundledVersions.deps,
  ignore = RECOMMENDED_IGNORE,
  tsconfig = TSCONFIG,
  prettier = PRETTIERRC,
  transform = index => index,
} = {}) {
  return function stack({
    location,
    version = '0.1.0',
    deps = [],
    packageJson = {},
  }) {
    const name = projectName(location, scope)
    const slug = name.slice(name.indexOf('/') + 1)
    const localDeps = deps.filter(d => 'pkg' in d)
    const packTarget = dep => `${dep.pkg}:ci:pack`
    const packTargets = localDeps.map(packTarget)
    const manifest = buildPackageJson({
      name, scope, version, deps, coreDevDeps: CORE_DEV_DEPS, versions,
      extra: {
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
        files: ['dist'],
        ...packageJson,
      }
    })

    const index = {
      config: {
        manifest: {
          deps: [base],
          run: ({ images: d }) => ({
            FROM: d[base],
            steps: [
              { WORKDIR: '/repo' },
              writeJson('/repo/package.json', manifest),
              writeJson('/repo/tsconfig.json', tsconfig),
              writeJson('/repo/.prettierrc.json', prettier),
            ],
            IGNORE: ignore,
          })
        }
      },
      dev: {
        sync: {
          deps: ['config:manifest'],
          run: ({ images: d }) => ({
            FROM: d['config:manifest'],
            steps: [],
            IGNORE: ignore,
            EXPORT: Object.fromEntries(MANIFESTS.map(f => [`/repo/${f}`, f])),
          })
        }
      },
      ci: {
        install: {
          deps: ['config:manifest', ...packTargets],
          run: ({ images: d }) => ({
            FROM: d['config:manifest'],
            steps: [
              ...localDeps.map(dep => ({
                COPY: { from: d[packTarget(dep)], src: '/out', dest: '/repo' }
              })),
              { WORKDIR: '/repo' },
              writeText('/repo/.pnpmfile.cjs', pnpmfile(scope)),
              { RUN: 'pnpm install --prod=false' },
            ],
            IGNORE: ignore,
          })
        },
        build: {
          deps: ['install'],
          run: ({ images: d }) => ({
            FROM: d['install'],
            steps: [
              { COPY: { src: 'src', dest: '/repo/src' } },
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec tsc --outDir dist --declaration --noEmit false' },
            ],
            IGNORE: ignore,
          })
        },
        pack: {
          deps: ['build', ...packTargets],
          run: ({ images: d }) => ({
            FROM: d['build'],
            steps: [
              ...localDeps.map(dep => ({
                COPY: { from: d[packTarget(dep)], src: '/out', dest: '/out' }
              })),
              { WORKDIR: '/repo' },
              { RUN: `mkdir -p /tmp/pack /out && pnpm pack --pack-destination /tmp/pack && mv /tmp/pack/*.tgz /out/${slug}.tgz` },
            ],
            IGNORE: ignore,
          })
        },
        typecheck: {
          deps: ['install'],
          run: ({ images: d }) => ({
            FROM: d['install'],
            steps: [
              { COPY: { src: 'src', dest: '/repo/src' } },
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec tsc --noEmit' },
            ],
            IGNORE: ignore,
          })
        }
      }
    }

    return transform(index, { location, name, slug, manifest })
  }
}
