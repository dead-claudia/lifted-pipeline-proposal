# Unary pipeline lifting

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

Another scenario is when you just want to trivially transform a collection. `Array.prototype.map` exists already for this purpose, but we can do that for maps and sets, too. This would let you turn code from this, to re-borrow a previous example:

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

These are, of course, very convenient functions to have, but it's very inefficient to implement at the language level. Instead, if it was implemented at the engine level, you could optimize it in ways not possible at the language level:

1. It's possible to create composed function pipelines which are as fast, if not faster, than standard function calls.

2. Engines can trivially optimize and merge pipelines as appropriate. In the example language implementation for function composition, which is the usual optimized function implementation, `result` would be quickly marked as megamorphic, because the engine only has one point to rule them all for type feedback, not the *n* - 1 required to reliably avoid the mess. (Of course, this could be addressed by a userland `Function.compose` or whatever, but it still fails to address the general case.)

3. The call sequence can be special-cased for many of these internal operations, knowing they require minimal stack manipulation and are relatively trivial to implement.

## Proposed syntax/semantics

Here's what I propose:

1. A new low-precedence `x :> f` left-associative infix operator for left-to-right lifted pipelines.
1. A new low-precedence `f <: x` right-associative infix operator for right-to-left lifted pipelines.
1. A new well-known symbol `@@lift` that is used by those pipeline operators to dispatch based on type.

The pipeline operators simply call `Symbol.lift`:

```js
function pipe(x, f) {
    if (typeof func !== "function") throw new TypeError()
    return x[Symbol.lift](x => f(x))
}
```

Here's how that `Symbol.lift` would be implemented for some of these types:

- `Function.prototype[Symbol.lift]`: binary function composition like this:

    ```js
    Function.prototype[Symbol.lift] = function (g) {
        const f = this
        // Note: this should only be callable.
        return function (...args) {
            return g.call(this, f.call(this, ...args))
        }
    }
    ```

- `Array.prototype[Symbol.lift]`: Equivalent to `Array.prototype.map`, but only calling the callback with one argument. (This enables optimizations not generally possible with `Array.prototype.map`, like eliding intermediate array allocations.)

- `Promise.prototype[Symbol.lift]`: Equivalent to `Promise.prototype.then`, if passed only one argument.

- `Iterable.prototype[Symbol.lift]`: Returns an iterable that does this:

    ```js
    Iterable.prototype[Symbol.lift] = function (func) {
        return {
            next: v => {
                const {done, value} = this.next(v)
                return {done, value: done ? value : func(value)}
            },
            throw: v => this.throw(v),
            return: v => this.return(v),
        }
    }
    ```

- `AsyncGenerator.prototype[Symbol.lift]` and `Generator.prototype[Symbol.lift]` do similar to `Iterable.prototype[Symbol.lift]`. Note that `Symbol.iterator` is not a fallback for `Symbol.lift`.

- `Map.prototype[Symbol.lift]`: Map iteration/update like this:

    ```js
    Map.prototype[Symbol.lift] = function (func) {
        const result = new this.constructor()
        
        for (const pair of this) {
            const [newKey, newValue] = func(pair)
            result.set(newKey, newValue)
        }

        return result
    }
    ```

- `Set.prototype[Symbol.lift]`: Set iteration/update like this:

    ```js
    Set.prototype[Symbol.lift] = function (func) {
        const result = new this.constructor()

        for (const value of this) {
            result.add(func(value))
        }

        return result
    }
    ```
