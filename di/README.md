# DI

A tiny synchronous dependency-injection graph for inline JavaScript composition.

```js
import di, { toClass, toFun, toValue } from '//stacks/di//dagr.di.js'

const module0 = di.module({
  unused: toValue(42),
  name: toValue('caeus'),
  greeter: toClass([], Greeter),
  greeting: toFun(['name', 'greeter'], (name, greeter) => greeter.greet(name)),
})

const module1 = di.module({ name: toValue('caeus!') })
const module = module0.merge(module1)

module.definitionOf('name')
module.keys()

const container = module.shake(['greeting']).compile()
container.greeting
```

Modules are immutable. `merge` is right-biased, like object spread: definitions in the argument
override definitions in the receiver. `shake` returns a new module containing the requested roots
and their transitive dependencies.

`compile()` takes no arguments and eagerly initializes every binding in the module exactly once.
Shake first when bindings should be excluded from initialization. Missing dependencies, circular
dependencies are rejected. Promises are ordinary values: compilation never awaits or unwraps them.
