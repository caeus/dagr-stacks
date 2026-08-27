import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import di, { toClass, toFun, toValue } from './dagr.di.js'

describe('di', () => {
  it('compiles every binding eagerly and once', () => {
    let initialized = 0
    class Greeter {
      greet(name) {
        return `hello ${name}`
      }
    }

    const container = di.module({
      unused: toFun([], () => ++initialized),
      name: toValue('caeus'),
      greeter: toClass([], Greeter),
      greeting: toFun(['name', 'greeter'], (name, greeter) => greeter.greet(name)),
    }).compile()

    assert.equal(initialized, 1)
    assert.equal(container.greeting, 'hello caeus')
    assert.equal(container.unused, 1)
  })

  it('shakes bindings before compilation', () => {
    let initialized = false
    const shaken = di.module({
      unused: toFun([], () => { initialized = true }),
      name: toValue('caeus'),
      greeting: toFun(['name'], name => `hello ${name}`),
    }).shake(['greeting'])

    assert.deepEqual([...shaken.keys()], ['name', 'greeting'])
    assert.equal(shaken.compile().greeting, 'hello caeus')
    assert.equal(initialized, false)
  })

  it('merges with right-biased overrides', () => {
    const left = di.module({ name: toValue('left'), answer: toValue(42) })
    const right = di.module({ name: toValue('right') })
    const merged = left.merge(right)

    assert.equal(merged.compile().name, 'right')
    assert.equal(merged.compile().answer, 42)
  })

  it('exposes immutable definitions', () => {
    const module = di.module({ answer: toValue(42) })
    const binding = module.definitionOf('answer')

    assert.deepEqual(binding.deps, [])
    assert.equal(binding.factory(), 42)
    assert.ok(Object.isFrozen(binding))
  })

  it('rejects missing bindings', () => {
    const module = di.module({ greeting: toFun(['name'], name => `hello ${name}`) })
    assert.throws(() => module.compile(), /Missing binding "name" required by "greeting"/)
  })

  it('rejects circular dependencies', () => {
    const module = di.module({
      a: toFun(['b'], b => b),
      b: toFun(['a'], a => a),
    })
    assert.throws(() => module.compile(), /Circular dependency: a -> b -> a/)
  })

  it('rejects async factories', () => {
    const module = di.module({ value: toFun([], async () => 42) })
    assert.throws(() => module.compile(), /async bindings are not supported/)
  })
})
