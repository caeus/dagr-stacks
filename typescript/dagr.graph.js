const node = (kind, deps = [], factory) => Object.freeze({
  kind,
  deps: Object.freeze([...deps]),
  ...(factory === undefined ? {} : { factory }),
})

export const external = () => node('external')
export const target = () => node('target')
export const calculated = (deps, factory) => node('calculated', deps, factory)

export function calculationModule(name, nodes, contributions = {}) {
  return Object.freeze({
    name,
    nodes: Object.freeze({ ...nodes }),
    contributions: Object.freeze(Object.fromEntries(
      Object.entries(contributions).map(([kind, names]) => [kind, Object.freeze([...names])]),
    )),
  })
}

export function mergeCalculationModules(modules) {
  const nodes = {}
  const owners = {}
  const contributions = {}

  for (const module of modules) {
    for (const [name, definition] of Object.entries(module.nodes)) {
      if (Object.hasOwn(nodes, name)) {
        throw new Error(`Calculation node ${JSON.stringify(name)} is declared by both ${owners[name]} and ${module.name}`)
      }
      nodes[name] = definition
      owners[name] = module.name
    }
    for (const [kind, names] of Object.entries(module.contributions)) {
      contributions[kind] = [...(contributions[kind] ?? []), ...names]
    }
  }

  return Object.freeze({
    nodes: Object.freeze(nodes),
    owners: Object.freeze(owners),
    contributions: Object.freeze(Object.fromEntries(
      Object.entries(contributions).map(([kind, names]) => [kind, Object.freeze(names)]),
    )),
  })
}

export function compileCalculationGraph(graph, di, externalValues, targetValues, roots) {
  const sourceModule = kind => di.module(Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, definition]) => definition.kind === kind)
      .map(([name]) => {
        const values = kind === 'external' ? externalValues : targetValues
        if (!Object.hasOwn(values, name)) {
          throw new Error(`Missing ${kind} calculation node ${JSON.stringify(name)}`)
        }
        return [name, di.toValue(values[name])]
      }),
  ))
  const calculations = di.module(Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, definition]) => definition.kind === 'calculated')
      .map(([name, definition]) => [name, di.toFun(definition.deps, definition.factory)]),
  ))

  return sourceModule('external')
    .merge(sourceModule('target'))
    .merge(calculations)
    .shake(roots)
    .compile()
}
