const bindingName = name => JSON.stringify(name)

function definition(deps, factory) {
  if (!Array.isArray(deps) || deps.some(dep => typeof dep !== 'string')) {
    throw new TypeError('Binding dependencies must be an array of strings')
  }
  if (typeof factory !== 'function') {
    throw new TypeError('Binding factory must be a function')
  }

  return Object.freeze({ deps: Object.freeze([...deps]), factory })
}

export function toValue(value) {
  return definition([], () => value)
}

export function toFun(deps, factory) {
  return definition(deps, factory)
}

export function toClass(deps, Class) {
  if (typeof Class !== 'function') {
    throw new TypeError('Binding class must be a constructor')
  }
  return definition(deps, (...args) => new Class(...args))
}

function normalize(bindings) {
  if (bindings === null || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new TypeError('Module bindings must be an object')
  }

  return new Map(
    Object.entries(bindings).map(([name, binding]) => {
      if (binding === null || typeof binding !== 'object') {
        throw new TypeError(`Binding ${bindingName(name)} must be a definition`)
      }
      return [name, definition(binding.deps, binding.factory)]
    })
  )
}

class Module {
  #bindings

  constructor(bindings) {
    this.#bindings = bindings
    Object.freeze(this)
  }

  definitionOf(name) {
    return this.#bindings.get(name)
  }

  keys() {
    return this.#bindings.keys()
  }

  merge(other) {
    if (!(other instanceof Module)) throw new TypeError('Can only merge another DI module')
    return new Module(new Map([...this.#bindings, ...other.#bindings]))
  }

  shake(roots) {
    if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) {
      throw new TypeError('Shake roots must be an array of strings')
    }

    const retained = new Set()
    const visit = (name, requiredBy) => {
      const binding = this.#bindings.get(name)
      if (!binding) {
        const suffix = requiredBy === undefined
          ? ''
          : ` required by ${bindingName(requiredBy)}`
        throw new Error(`Missing binding ${bindingName(name)}${suffix}`)
      }
      if (retained.has(name)) return
      retained.add(name)
      for (const dep of binding.deps) visit(dep, name)
    }

    for (const root of roots) visit(root)
    return new Module(new Map([...this.#bindings].filter(([name]) => retained.has(name))))
  }

  compile() {
    const values = new Map()
    const resolving = []

    const resolve = (name, requiredBy) => {
      if (values.has(name)) return values.get(name)

      const binding = this.#bindings.get(name)
      if (!binding) {
        const suffix = requiredBy === undefined
          ? ''
          : ` required by ${bindingName(requiredBy)}`
        throw new Error(`Missing binding ${bindingName(name)}${suffix}`)
      }

      const cycleAt = resolving.indexOf(name)
      if (cycleAt !== -1) {
        throw new Error(`Circular dependency: ${[...resolving.slice(cycleAt), name].join(' -> ')}`)
      }

      resolving.push(name)
      try {
        const value = binding.factory(...binding.deps.map(dep => resolve(dep, name)))
        values.set(name, value)
        return value
      } finally {
        resolving.pop()
      }
    }

    for (const name of this.#bindings.keys()) resolve(name)

    const container = Object.create(null)
    for (const [name, value] of values) {
      Object.defineProperty(container, name, {
        value,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    return Object.freeze(container)
  }
}

export function module(bindings) {
  return new Module(normalize(bindings))
}

export default Object.freeze({ module, toValue, toFun, toClass })
