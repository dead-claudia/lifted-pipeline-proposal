[*Original es-discuss thread*](https://esdiscuss.org/topic/function-composition-syntax)

# Lifted Pipeline Strawman

*Previously, was specific to function composition. I've since generalized it.*

-----

*Before I continue, if you came here wondering what the heck this is, or what the point of it is, I invite you to read [this blog post about composition](http://blog.ricardofilipe.com/post/javascript-composition-for-dummies) and [this one on monads](https://jameswestby.net/weblog/tech/why-monads-are-useful.html), and I encourage you to google both concepts. Long story short, yes, it's a thing, and yes, it's pretty useful for a variety of reasons.*

Function composition has been used for years, even in JS applications. It's one thing people have been continually reinventing as well. Many utility belts I've found have this function – in particular, most common ones have it:

- Underscore: [`_.compose`](http://underscorejs.org/#compose)
- Lodash: [`_.flow`](https://lodash.com/docs/4.15.0#flow) and [`_.flowRight`](https://lodash.com/docs/4.15.0#flowRight)
- Ramda: [`R.compose`](http://ramdajs.com/docs/#compose) and [`R.pipe`](http://ramdajs.com/docs/#pipe)

There's also the [numerous npm modules](https://www.npmjs.com/search?q=function+composition) and manual implementations (it's trivial to write a basic implementation). Conceptually, it's pretty basic:

```js
function composeRight(f, ...fs) {
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
const toSlug = composeRight(
    _ => _.split(" "),
    _ => _.map(str => str.toLowerCase()),
    _ => _.join("-"),
    encodeURIComponent
)
```

Or, using this proposal:

```js
const toSlug =
    _ => _.split(" ")
    :> _ => _.map(str => str.toLowerCase())
    :> _ => _.join("-")
    :> encodeURIComponent
```

Another scenario is when you just want to trivially transform a collection. `Array.prototype.map` exists already, but we can do that for maps and sets, too. This would let you turn code from this, to re-borrow a previous example:

```js
function toSlug(input) {
    return encodeURIComponent(
        input.split(" ")
            .map(str => str.toLowerCase())
            .join("-")
    )
}
```

to something that's a little less nested (in tandem with the [pipeline operator proposal](https://github.com/tc39/proposal-pipeline-operator)):

```js
function toSlug(string) {
    return string
    |> _ => _.split(" ")
    :> word => word.toLowerCase()
    |> _ => _.join("-")
    |> encodeURIComponent
}
```

It's also much more readable than the previous composed pipeline:

```js
const toSlug =
    _ => _.split(" ")
    :> _ => _.map(str => str.toLowerCase())
    :> _ => _.join("-")
    :> encodeURIComponent
```

These are, of course, very convenient functions to have, but it's very inefficient to implement at the language level. Instead, if it was implemented at the engine level, you could optimize it in ways not possible at the language level:

1. It's possible to create composed function pipelines which are as fast, if not faster, than standard function calls.

2. Engines can trivially optimize and merge pipelines as appropriate. In the example language implementation for function composition, which is the usual optimized function implementation, `result` would be quickly marked as megamorphic, because the engine only has one point to rule them all for type feedback, not the *n* - 1 required to reliably avoid the mess. (Of course, this could be addressed by a userland `Function.compose` or whatever, but it still fails to address the general case.)

3. The call sequence can be special-cased for many of these internal operations, knowing they require minimal stack manipulation and are relatively trivial to implement.

## Proposed syntax/semantics

Here's what I propose:

1. A new low-precedence `x :> f` left-associative infix operator for left-to-right lifted pipelines.
1. A new low-precedence `f <: x` right-associative infix operator for right-to-left lifted pipelines.
1. A new well-known symbol `@@lift` that is used by those pipeline operators to dispatch based on type.

The pipeline operators carry these semantics:

```js
function pipe(x, f) {
    if (typeof f !== "function") throw new TypeError()
    return x[Symbol.lift](f)
}
```

Here's how that `Symbol.lift` would be implemented for some of these types:

- `Function.prototype[Symbol.lift]`: binary function composition like this:

    ```js
    Function.prototype[Symbol.lift] = function (g) {
        const f = this
        // Note: this should only be callable.
        return {""(...args) { return g.call(this, f.call(this, ...args)) }}[""]
    }
    ```

- `Array.prototype[Symbol.lift]`: Equivalent to literally this, mod extra type checking and the method itself being only callable:

    ```js
    Array.prototype[Symbol.lift] = {["[Symbol.lift]"](func) {
        const array = Object(this)
        const length = array.length
        const result = new Array(length)

        for (let i = 0; i < length; i++) {
            result[i] = func(array[i], i)
        }

        return result
    }}["[Symbol.lift]"]
    ```

    The reason this is done is to avoid the existing issues with sparse arrays being harder to optimize and so the code gen is trivial.

- `Promise.prototype[Symbol.lift]`: Equivalent to `Promise.prototype.then`, if passed only one argument.

- `Generator.prototype[Symbol.lift]`: Returns an iterable that does this:

    ```js
    Generator.prototype[Symbol.lift] = function (func) {
        const remap = ({done, value}) => ({
            done, value: done ? value : func(value),
        })
        return {
            next: v => remap(this.next(v)),
            throw: v => remap(this.throw(v)),
            return: v => remap(this.return(v)),
        }
    }
    ```

- `AsyncGenerator.prototype[Symbol.lift]` and `Iterable.prototype[Symbol.lift]` do similar to `Generator.prototype[Symbol.lift]`. Note that `Symbol.iterator` is not a fallback for `Symbol.lift`.

- `Map.prototype[Symbol.lift]`: Map iteration/update like this:

    ```js
    Map.prototype[Symbol.lift] = function (func) {
        const result = new this.constructor()

        this.forEach((key, value) => {
            const [newKey, newValue] = func(key, value)
            result.set(newKey, newValue)
        })

        return result
    }
    ```

- `Set.prototype[Symbol.lift]`: Set iteration/update like this:

    ```js
    Set.prototype[Symbol.lift] = function (func) {
        const result = new this.constructor()

        this.forEach(value => {
            result.add(func(value))
        })

        return result
    }
    ```

## Why an operator, not a function?

**Pros:**

(Easier to optimize, and for some, read.)

1. Fewer parentheses. That is always a bonus.
1. Engines can optimize pipelines much more easily, since it's all binary operations.
1. Lighter polyfill + implementation.
1. Less verbose without sacrificing readability.

**Cons:**

(Impossible to polyfill alone, looks odd to some.)

1. It's syntax that must be transpiled, not just a function that can be polyfilled.
    - Note that the syntax is trivial to transpile - it's something you could almost do via a Recast script.
1. The operator looks a bit foreign and/or weird.
    - Yeah...I initially used `>=>` in the mailing list and `>:>`/`<:<` here, but I was mostly looking for an operator that a) didn't conflict with existing syntax (`f <<- g` conflicts with `f << -g`, for example), and b) indicated some sort of direction. If you have a better idea, [I'm all ears](https://github.com/isiahmeadows/function-composition-proposal/issues/1).
1. It adds to an already-complicated language, and can still be implemented in userland.
    - In theory, yes, and I do feel [there should be a high bar](https://esdiscuss.org/topic/the-tragedy-of-the-common-lisp-or-why-large-languages-explode-was-revive-let-blocks) for introducing new language features, but I feel this does reach that bar.
    - The numerous modifications to builtins make it a little harder to implement trivially in userland.

## Why a single shared symbol?

Let's draw from a few examples:

- `f.compose(x => g(x))`: This is function composition. Call this with any value, and it'll go through both `f` and `g`, and you'll get the result. `x` here is like a "nested" value - we don't need to have it ready yet, and it's only there when we call the composed function. (Normally, you see this as `f.compose(g)`, but I un-factored that out for clarity.)

- `list.map(x => func(x))`: This is your familiar `Array.prototype.map` and similar. The callback is called with each nested value, and it returns the result.

- `promise.then(x => func(x))`: This is your familiar `Promise.prototype.then`. The callback is called on resolution, and the result is a promise to the value returned from the function (or whatever value the returned promise eventually holds, if it returned one).

These clearly rhyme: they're all in the common form of `foo.method(x => func(x))`, and this is no accident. Matter of fact, this is the basis of [Haskell's](http://learnyouahaskell.com/making-our-own-types-and-typeclasses#the-functor-typeclass) (and [Fantasy Land's](https://github.com/fantasyland/fantasy-land#functor)) `Functor` type. Although my proposal deviates from that a little bit (it makes no attempt to validate the return type, just the input), that's why I chose to use a single unifying symbol.

## Possible expansions

These are just ideas; none of them really have to make it.

- An `Object.box(value)` to provide as an escape hatch which also facilitates optional propagation. Here's an example with help from the [optional chaining proposal](https://github.com/tc39/proposal-optional-chaining):

    ```js
    // Old
    function getUserBanner(banners, user) {
        if (user && user.accountDetails && user.accountDetails.address) {
            return banners[user.accountDetails.address.province];
        }
    }

    // New
    function getUserBanner(banners, user) {
        return Object.box(user?.accountDetails?.address?.province)
            :> _ => banners[_]
    }
    ```

    - This gets uncomfortably verbose...
    - It *is* a little more flexible.

- Corresponding `x ?> f` and `f <? x` for optional propagation
    - Extra syntax for such a simple case is not something I'm a huge fan of.
        - There's already seemingly precedent in the optional chaining operators, so does this have a chance?
    - Should this really be `?|>`/`<|?` to mirror the pipeline operator?
        - It's still kind of lifting, so... ¯\\_(ツ)_/¯
        - Maybe `?.>`/`<.?`? (Meh...little too obscure-looking)
    - It can make for nicer code, though:

    ```js
    function getUserBanner(banners, user) {
        return user?.accountDetails?.address?.province ?> _ => banners[_]
    }
    ```

- `await` in pipelines: `x :> await f` (this would desugar to `await (x :> f)`)
    - `yield` in pipelines: `x :> yield` (this would desugar to `yield x`)
    - This is subject to [this discussion here](https://github.com/tc39/proposal-pipeline-operator/wiki), as everything there is relevant here.

- A way to expand this further to lift across binary actions (instead of unary ones like here).
    - This is not simply `x :> (a, b) => ...`, but a ternary operation like `x.lift2(y, (a, b) => ...)`
    - This could allow something like summing the values of two promises without much effort: `Promise.resolve(1).lift2(Promise.resolve(2), (a, b) => a + b)`
    - This is similar to [Fantasy Land's `Apply` type](https://github.com/fantasyland/fantasy-land#apply), but their formulation should probably be avoided for pragmatic reasons.
        - It necessitates closures nested within values, which is not easy to optimize on the fly.
        - Note that the two variants are [mathematically specifiable in terms of each other](https://hackage.haskell.org/package/base-4.10.1.0/docs/Control-Applicative.html).
    - Ideally, the main method/function should make repeated nested application easy, like something to the effect of `lift(...xs, (...as) => ...)`.
        - Ramda provides this method (via a different prototype) for Fantasy Land applicatives, but we should make that the default, not something you have to request.

## Inspiration

- This is very similar to Fantasy Land's [`fantasy-land/map`](https://github.com/fantasyland/fantasy-land#functor) method, although it's a little more permissive.
- And, of course, the [pipeline operator proposal](https://github.com/tc39/proposal-pipeline-operator), in which this shares a *lot* of genes with.

## Related strawmen/proposals

This is most certainly *not* on its own little island. Here's a few other proposals that also deal with functions and/or functional programming in general:

- `this` binding/pipelining: https://github.com/tc39/proposal-bind-operator
- Pipeline operator (unlifted): https://github.com/tc39/proposal-pipeline-operator
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
    _.split(?, " ")
    :> _.map(?, _.toLower)
    :> _.join(?, "-")
    :> encodeURIComponent
```
