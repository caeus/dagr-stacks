import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { typescriptLibraryProjector } from './dagr.utils.js'

const versions = {
  '@tsconfig/strictest': '2.0.8',
  prettier: '3.2.5',
  typescript: '6.0.3',
  vitest: '3.2.7',
  zod: '4.4.3',
}

function projector(overrides = {}) {
  return typescriptLibraryProjector({
    name: '@internal/example',
    scope: 'internal',
    version: '1.2.3',
    deps: [{ npm: 'zod', at: 'prod' }],
    metadata: { description: 'An example' },
    versions,
    ...overrides,
  })
}

describe('TypeScript library projections', () => {
  it('materializes only development and test tooling in the dev projection', () => {
    const dev = projector()('dev')

    assert.equal(dev.packageJson.private, true)
    assert.equal(dev.packageJson.main, './src/index.ts')
    assert.equal(dev.packageJson.devDependencies.vitest, '3.2.7')
    assert.equal(dev.tsconfig.compilerOptions.noEmit, true)
    assert.deepEqual(Object.keys(dev.files), [
      'package.json',
      'tsconfig.json',
      '.prettierrc.json',
      'vitest.config.js',
    ])
  })

  it('keeps CI projections independent even when some values currently agree', () => {
    const project = projector()
    const typecheck = project('typecheck')
    const test = project('test')
    const build = project('build')

    assert.equal(typecheck.tsconfig.compilerOptions.noEmit, true)
    assert.equal(typecheck.packageJson.devDependencies.prettier, undefined)
    assert.equal(typecheck.packageJson.devDependencies.vitest, '3.2.7')
    assert.equal(typecheck.files['vitest.config.js'], undefined)
    assert.equal(test.tsconfig.compilerOptions.noEmit, true)
    assert.ok(test.files['vitest.config.js'].includes('"environment": "node"'))
    assert.equal(build.tsconfig.compilerOptions.noEmit, false)
    assert.equal(build.tsconfig.compilerOptions.declaration, true)
    assert.equal(build.packageJson.devDependencies.prettier, undefined)
    assert.equal(build.packageJson.devDependencies.vitest, undefined)
    assert.equal(build.files['vitest.config.js'], undefined)
    assert.equal(build.files['.prettierrc.json'], undefined)
  })

  it('derives one output agreement for the compiler and package artifacts', () => {
    const project = projector()
    const build = project('build')
    const pack = project('pack')

    assert.equal(build.tsconfig.compilerOptions.outDir, pack.output.directory)
    assert.deepEqual(pack.packageJson.files, [pack.output.directory])
    assert.equal(pack.packageJson.main, pack.output.import)
    assert.equal(pack.packageJson.types, pack.output.types)
    assert.deepEqual(pack.packageJson.exports, {
      '.': { types: pack.output.types, import: pack.output.import },
    })
  })

  it('derives publishability from the selected action', () => {
    const project = projector()
    const pack = project('pack').packageJson
    const publish = project('publish').packageJson

    assert.equal(pack.private, true)
    assert.equal(publish.private, false)
    assert.equal('publishConfig' in publish, false)
    assert.equal('devDependencies' in pack, false)
    assert.equal('devDependencies' in publish, false)
  })

  it('rejects package metadata that tries to override derived values', () => {
    assert.throws(
      () => projector({ metadata: { private: false, files: ['whatever'] } }),
      /package metadata cannot configure non-metadata fields private, files/,
    )
  })

  it('rejects an action the stack cannot map', () => {
    assert.throws(() => projector()('deploy'), /unknown TypeScript library action "deploy"/)
  })

  it('rejects dependencies whose versions are not repository input', () => {
    assert.throws(
      () => projector({ deps: [{ npm: 'missing', at: 'prod' }] })('dev'),
      /no version configured for npm dependency missing/,
    )
  })
})
