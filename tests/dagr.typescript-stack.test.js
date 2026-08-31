import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, it } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const component = resolve(root, 'typescript')
const di = resolve(root, 'di')

async function loadStack() {
  const context = vm.createContext({ Buffer })
  const cache = new Map()

  const load = async path => {
    const canonical = await realpath(path)
    if (cache.has(canonical)) return cache.get(canonical)

    if (extname(canonical) === '.yaml') {
      const module = new vm.SyntheticModule(['default'], function () {
        this.setExport('default', { deps: {} })
      }, { context, identifier: canonical })
      cache.set(canonical, module)
      return module
    }

    const module = new vm.SourceTextModule(await readFile(canonical, 'utf8'), {
      context,
      identifier: canonical,
    })
    cache.set(canonical, module)
    await module.link(async specifier => {
      if (specifier === 'dagr:yaml') {
        const builtin = new vm.SyntheticModule(['stringify'], function () {
          this.setExport('stringify', value => JSON.stringify(value, null, 2))
        }, { context, identifier: specifier })
        await builtin.link(() => {})
        return builtin
      }
      if (!specifier.startsWith('//')) {
        throw new Error(`Dagr imports must start with //, got: ${specifier}`)
      }
      if (specifier.startsWith('//di//')) {
        return load(resolve(di, specifier.slice('//di//'.length)))
      }
      return load(resolve(component, specifier.slice(2)))
    })
    return module
  }

  const module = await load(resolve(component, 'dagr.stack.js'))
  await module.evaluate()
  return module.namespace
}

describe('mountable TypeScript stack', () => {
  it('loads with dagr import rules and composes executable targets', async () => {
    const stack = await loadStack()
    const versions = {
      '@tsconfig/strictest': '2',
      'typescript': '6',
      'vitest': '3',
    }
    let calculations
    const project = stack.default({
      base: 'base',
      versions,
      conventions: { sourceDirectory: 'source' },
      transform(index, context) {
        calculations = context.calculations
        return index
      },
    })
      .with(stack.library())
      .with(stack.vitest())
    const index = project({ location: '//example', version: '1.0.0' })

    assert.deepEqual(Object.keys(index.config).sort(), ['build', 'dev', 'test', 'typecheck'])
    assert.deepEqual(Object.keys(index.ci).sort(), [
      'build',
      'install-typecheck',
      'install-test',
      'install-build',
      'pack',
      'test',
      'typecheck',
    ].sort())
    assert.deepEqual(Object.keys(index.publish), ['pack'])
    assert.equal(index.ci.test.name, 'test')
    assert.deepEqual([...index.ci.test.deps], ['install-test'])
    assert.equal(typeof index.ci.test.run, 'function')
    assert.equal(calculations.nodes['dev:sync/intent'].kind, 'calculated')
    assert.equal(calculations.nodes['dev:sync/intent'].deps.length, 0)
    assert.equal(calculations.nodes.index.deps[0].tag.description, 'typescript facets')
    const ciTargets = calculations.nodes['facet:ci'].deps[0].tag
    assert.equal(ciTargets.description, 'ci targets')
    assert.ok(calculations.nodes.vitestTestTarget.tags.includes(ciTargets))
    const sourceCopy = index.ci.typecheck.run({ images: { 'install-typecheck': 'image' } }).steps[0]
    assert.equal(sourceCopy.COPY.src, 'source')
    assert.equal(sourceCopy.COPY.dest, '/repo/source')
    assert.deepEqual([...index.publish.pack.deps], ['ci:build'])
    assert.equal(index.publish.pack.run({ images: { 'ci:build': 'build-image' } }).FROM, 'build-image')

    const qualityFacet = stack.facet('quality')
    const health = stack.defineFeature('health', {
      settings: {
        healthTarget: stack.setting([], () => stack.target('health', {
          deps: [],
          run: () => ({ FROM: 'scratch', steps: [], IGNORE: [] }),
        }), { tags: [qualityFacet.targets] }),
      },
    })
    const extended = stack.default({ base: 'base', versions })
      .with(stack.library())
      .with(health)
    assert.equal(extended({ location: '//example' }).quality.health.name, 'health')

    const first = stack.defineFeature('first-target', {
      settings: {
        firstTarget: stack.setting([], () => stack.target('same', {
          deps: [],
          run: () => ({ FROM: 'scratch', steps: [], IGNORE: [] }),
        }), { tags: [stack.ciFacet.targets] }),
      },
    })
    const second = stack.defineFeature('second-target', {
      settings: {
        secondTarget: stack.setting([], () => stack.target('same', {
          deps: [],
          run: () => ({ FROM: 'scratch', steps: [], IGNORE: [] }),
        }), { tags: [stack.ciFacet.targets] }),
      },
    })
    const conflicting = stack.default({ base: 'base', versions })
      .with(stack.library())
      .with(first)
      .with(second)
    assert.throws(
      () => conflicting({ location: '//example', version: '1.0.0' }),
      /target "same" has more than one owner/,
    )
  })
})
