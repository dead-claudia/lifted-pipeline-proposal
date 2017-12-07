[*Original es-discuss thread*](https://esdiscuss.org/topic/function-composition-syntax)

# Function Composition Strawman

*Before I continue, if you came here wondering what the heck this is, or what the point of it is, I invite you to read [this blog post](http://blog.ricardofilipe.com/post/javascript-composition-for-dummies) or [this one (slightly academic)](https://medium.com/@chetcorcos/functional-programming-for-javascript-people-1915d8775504#.fkkayimp4), and I encourage you to google it. Long story short, yes, it's a thing, and yes, it's actually useful for a variety of reasons.*

Function composition has been used for years, even in JS applications. It's one thing people have been continually reinventing as well. Many utility belts I've found have this function – in particular, most common ones have it:

- Underscore: [`_.compose`](http://underscorejs.org/#compose)
- Lodash: [`_.flow`](https://lodash.com/docs/4.15.0#flow) and [`_.flowRight`](https://lodash.com/docs/4.15.0#flowRight)
- Ramda: [`R.compose`](http://ramdajs.com/docs/#compose) and [`R.pipe`](http://ramdajs.com/docs/#pipe)

There's also the [numerous npm modules](https://www.npmjs.com/search?q=function+composition) and manual implementations (it's trivial to write a basic implementation). Conceptually, it's pretty basic:

```js
function compose(f, ...fs) {
    return function () {
        var result = f.apply(this, arguments);

        for (var i = 0; i < fs.length; i++) {
            result = fs[i].call(this, result);
        }

        return result;
    }
}
```

It lets you do turn code like this:

```js
function toSlug(input) {
    return encodeURIComponent(
        input.split(" ")
            .map(str => str.toLowerCase())
            .join("-")
    )
}
```

to this:

```js
const toSlug = compose(
    _ => _.split(" "),
    _ => _.map(str => str.toLowerCase()),
    _ => _.join("-"),
    encodeURIComponent
)
```

Or, using this proposal:

```js
const toSlug =
    encodeURIComponent
    :> _ => _.split(" ")
    :> _ => _.map(str => str.toLowerCase())
    :> _ => _.join("-")
```

These are, of course, very convenient functions to have, but it's very inefficient to implement at the language level. Instead, if it was implemented at the engine level, you could optimize it in ways not possible at the language level:

1. It's possible to create pipelines which are as fast, if not faster, than standard function calls.

2. Engines can better optimize the types. In the example language implementation above, which is the usual optimized function implementation, `result` would be quickly marked as megamorphic, since the return value is generally not optimized during execution.

3. The call sequence can be special-cased for these, knowing they require minimal stack manipulation and are relatively trivial to implement. Also, after you verify the types, you don't need to type-check the functions when calling them.

## Proposed syntax/semantics

Here's what I propose: A new `f :> g` infix operator for left-to-right composition, and `g <: f` for right-to-left composition, that basically does this:

```js
function compose(f, g) {
    if (typeof f !== "function") throw new TypeError("Expected `f` to be a function");
    if (typeof g !== "function") throw new TypeError("Expected `g` to be a function");
    return Object.defineProperty(
        {""(...args) { return g.call(this, f.call(this, ...args)) }}[""],
        "length", {value: f.length}
    );
}
```

## Why an operator, not a function?

**Pros:**

(Easier to optimize, and for some, read.)

1. Fewer parentheses. That is always a bonus.
1. Engines can optimize anonymous functions in the middle (to avoid function call overhead) when generating baseline code.
1. Transpilers like Babel can generate properly optimized code from the beginning.
1. No issues with a slow polyfill.

**Cons:**

(Impossible to polyfill, looks odd to some.)

1. It's syntax that must be transpiled, not a function that can be polyfilled.
1. The operator looks a bit foreign and/or weird.
    - Yeah...I initially used `>=>` in the mailing list and `>:>`/`<:<` here, but I was mostly looking for an operator that a) didn't conflict with existing syntax (`f <<- g` conflicts with `f << -g`, for example), and b) indicated some sort of direction. If you have a better idea, [I'm all ears](https://github.com/isiahmeadows/function-composition-proposal/issues/1).
1. It adds to an already-complicated language, and can still be implemented in userland.
    - In theory, yes, and I do feel [there should be a high bar](https://esdiscuss.org/topic/the-tragedy-of-the-common-lisp-or-why-large-languages-explode-was-revive-let-blocks) for introducing new language features, but I feel this does reach that bar.

## Possible expansions:

These are just ideas; none of them really have to make it.

- Composed async functions: `async f :> g :> ...` or `async ... <: g <: f` (basically `async` *ComposedFunctionChain*)
- Optional-propagating chain: `f ?:> g` or `g <:? f` (adding a `?` behind the operator)

Alternatively, we could prefer helper functions for each (as originally proposed by [James Forbes](https://github.com/JAForbes)), optionally reifying some of them in the spec (this could also play more nicely with the pipeline operator proposal):

```js
const then = f => x => x.then(f)
const map = f => x => x.map(f)
const applyTo = x => f => f(x)
const ifExists = f => x => x != null ? f(x) : x
const each = f => x => { x.forEach(f); return x }
```

These could be used like so:

```js
const getTemperatureFromServerInLocalUnits =
  getTemperatureKelvinFromServerAsync
  :> then(convertTemperatureKelvinToLocalUnits)
```

To reify and simplify this, we could add a `Symbol.lift` hook and `Function.lift(func)` to allow lifted composition/application without special syntax. It'd work like this:

```js
Function.lift = func => x => {
    if (x == null) {
        return x
    } else if (typeof x[Symbol.lift] === "function") {
        return x[Symbol.lift](x => func(x))
    } else {
        return func(x)
    }
}
```

- This is roughly equivalent to Fantasy Land's [`map`](https://github.com/fantasyland/fantasy-land#functor) method, although much more permissive.
- You could add `Symbol.lift` to promises, functions, and most language iterables/iterators.
- Lifted functions, for usability, return the argument without calling `func` for `null`/`undefined`.
- This would also be independently helpful for the pipeline operator proposal.
- `Symbol.lift` is not applied recursively, since this is functionally closer to iteration than thenable resolution.
- Yes, this would probably set off some purists, because of its dynamicism.

## Related strawmen/proposals

This is most certainly *not* on its own little island. Here's a few other proposals that also deal with functions and/or functional programming in general:

- `this` binding/pipelining: https://github.com/tc39/proposal-bind-operator
- Function pipelining: https://github.com/tc39/proposal-pipeline-operator
- Partial application: https://github.com/rbuckton/proposal-partial-application
- Do expressions: https://gist.github.com/dherman/1c97dfb25179fa34a41b5fff040f9879
- Pattern matching: https://github.com/tc39/proposal-pattern-matching

Here's an example of this with some of the other proposals:

```js
// Original
import * as _ from "lodash"
function toSlug(input) {
    return encodeURIComponent(
        _(input)
            .split(" ")
            .map(_.toLower)
            .join("-")
    )
}

// With this proposal + the partial application proposal
import * as _ from "lodash"
const toSlug =
    encodeURIComponent
    :> _.split(?, " ")
    :> _.map(?, _.toLower)
    :> _.join(?, "-")
```
