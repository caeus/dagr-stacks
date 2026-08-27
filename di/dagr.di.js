/**
 * @template T
 * @typedef {(...dependencies: unknown[]) => T} Factory
 */

/**
 * A frozen recipe for producing one binding.
 *
 * @template T
 * @typedef {Readonly<{
 *   deps: readonly string[],
 *   factory: Factory<T>
 * }>} Definition
 */

/** @typedef {Record<string, Definition<unknown>>} Bindings */

const bindingName = name => JSON.stringify(name)

/**
 * @template T
 * @param {readonly string[]} deps
 * @param {Factory<T>} factory
 * @returns {Definition<T>}
 */
function definition(deps, factory) {
  if (!Array.isArray(deps) || deps.some(dep => typeof dep !== 'string')) {
    throw new TypeError('Binding dependencies must be an array of strings')
  }
  if (typeof factory !== 'function') {
    throw new TypeError('Binding factory must be a function')
  }

  return Object.freeze({ deps: Object.freeze([...deps]), factory })
}

/**
 * @template T
 * @param {T} value
 * @returns {Definition<T>}
 */
export function toValue(value) {
  return definition([], () => value)
}

/**
 * @template T
 * @param {readonly string[]} deps
 * @param {Factory<T>} factory
 * @returns {Definition<T>}
 */
export function toFun(deps, factory) {
  return definition(deps, factory)
}

/**
 * @template T
 * @param {readonly string[]} deps
 * @param {new (...dependencies: unknown[]) => T} Class
 * @returns {Definition<T>}
 */
export function toClass(deps, Class) {
  if (typeof Class !== 'function') {
    throw new TypeError('Binding class must be a constructor')
  }
  return definition(deps, (...args) => new Class(...args))
}

/**
 * Copies and freezes user-provided definitions at the module boundary.
 *
 * @param {Bindings} bindings
 * @returns {Map<string, Definition<unknown>>}
 */
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

/** An immutable dependency graph that can be transformed and compiled. */
class Module {
  /** @type {Map<string, Definition<unknown>>} */
  #bindings

  /** @param {Map<string, Definition<unknown>>} bindings */
  constructor(bindings) {
    this.#bindings = bindings
    Object.freeze(this)
  }

  /**
   * @param {string} name
   * @returns {Definition<unknown> | undefined}
   */
  definitionOf(name) {
    return this.#bindings.get(name)
  }

  /** @returns {IterableIterator<string>} */
  keys() {
    return this.#bindings.keys()
  }

  /**
   * Returns a module where definitions from `other` override definitions from this module.
   *
   * @param {Module} other
   * @returns {Module}
   */
  merge(other) {
    if (!(other instanceof Module)) throw new TypeError('Can only merge another DI module')
    return new Module(new Map([...this.#bindings, ...other.#bindings]))
  }

  /**
   * Retains each root and its transitive dependencies.
   *
   * @param {readonly string[]} roots
   * @returns {Module}
   */
  shake(roots) {
    if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) {
      throw new TypeError('Shake roots must be an array of strings')
    }

    const retained = new Set()
    /**
     * @param {string} name
     * @param {string | undefined} [requiredBy]
     */
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

  /**
   * Eagerly resolves every binding once. Values, including promises, are never awaited or unwrapped.
   *
   * @returns {Readonly<Record<string, unknown>>}
   */
  compile() {
    const values = new Map()
    const resolving = []

    /**
     * @param {string} name
     * @param {string | undefined} [requiredBy]
     * @returns {unknown}
     */
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

    /** @type {Record<string, unknown>} */
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

/**
 * @param {Bindings} bindings
 * @returns {Module}
 */
export function module(bindings) {
  return new Module(normalize(bindings))
}

export default Object.freeze({ module, toValue, toFun, toClass })
