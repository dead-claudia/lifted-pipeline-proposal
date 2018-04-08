# Pipeline combining

*If you want the theory, this is roughly modeled on applicative functors, with a few pragmatic functional differences.*

Sometimes, you want to lift across multiple values at once. This might take the form of combining [streams](https://github.com/paldepind/flyd#flydcombinebody-dependencies)/[observables](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-combineLatest), [joining promises](http://bluebirdjs.com/docs/api/promise.join.html), [combining lists](https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions), or many others. That's where this proposal comes in.

Unlike the other two, this one involves only new built-in functions, with no new syntax, and so it can be purely polyfilled. It's pretty simple:

- `Function.lift(...colls, func?)` - Lift a function over one or more iterables, calling `func` with each item in each of `colls`.
    - A `RangeError` is thrown if you don't have at least two items to combine. (You can't "combine" anything with nothing.)
    - If you don't pass `func`, it defaults to just returning the arguments as an array, effectively generating a sequence of combinations.
    - This is in fact variadic, but the last parameter is type-checked as a potential function.
- `Function.asyncLift(...colls, func?)` - Like `Function.lift`, but works with async functions + async iterators.
- `coll[Symbol.lift2](other, func)` - You declare this to tell `Function.lift` how to combine two items.
    - If you can support combining with other types, it only cares about the first.
- `coll[Symbol.asyncLift2](other, func)` - Equivalent of `Symbol.lift2` for `Function.asyncLift`

Here's how it'd be implemented for some builtins:

- `Array.prototype[Symbol.lift2]`: Iterates over every combination of the two arrays, like the JS equivalent of Python's `[func(x, y) for x in self for y in other]`

- `Promise.prototype[Symbol.lift2]`: Joins two promises and calls the function when both promises resolve, returning a new promise with the function's result.
    - This is *slightly* duplicative of `Promise.all`, but it can avoid a heavy array allocation when provided a callback. Also, `Promise.all` is better memory-wise for truly variadic allocations

- `Iterable.prototype[Symbol.lift2]`: Works similarly to `Array.prototype[Symbol.lift2]`, but returns an iterable instead.

- You could implement `Function.prototype[Symbol.lift2]` to return `(a, b) => func(this(a), other(b))`, but it's not generally very useful (even in the world of Haskell).

## Implementation

The general implementation would look like this:

```js
// These are also optimized.
Function.lift = function (iter1, iter2, func) {
    switch (arguments.length) {
    case 0: case 1:
        throw new RangeError("must have at least 2 entries to combine")

    case 2:
        return iter1[Symbol.lift2](iter2, (a, b) => [a, b])
    
    case 3:
        return typeof func === "function"
            ? iter1[Symbol.lift2](iter2, (a, b) => func(a, b))
            : iter1
                [Symbol.lift2](iter2, (a, b) => [a, b])
                [Symbol.lift2](func, ([a, b], c) => [a, b, c])

    default:
        let acc = iter1[Symbol.lift2](iter2, (as, b) => [...as, b])
        const last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            const end = arguments.length - 2

            for (let i = 2; i < end; i++) {
                acc = acc[Symbol.lift2](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.lift2](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (let i = 2; i < arguments.length; i++) {
                acc = acc[Symbol.lift2](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}

Function.asyncLift = async function (iter1, iter2, func) {
    switch (arguments.length) {
    case 0: case 1:
        throw new RangeError("must have at least 2 entries to combine")

    case 2:
        return iter1[Symbol.asyncLift2](iter2, (a, b) => [a, b])
    
    case 3:
        return typeof func === "function"
            ? iter1[Symbol.asyncLift2](iter2, (a, b) => func(a, b))
            : (await iter1[Symbol.asyncLift2](iter2, (a, b) => [a, b]))
                [Symbol.asyncLift2](func, ([a, b], c) => [a, b, c])

    default:
        let acc = await iter1[Symbol.asyncLift2](iter2, (a, b) => [a, b])
        const last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            const end = arguments.length - 2

            for (let i = 2; i < end; i++) {
                acc = await acc[Symbol.asyncLift2](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.asyncLift2](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (let i = 2; i < arguments.length; i++) {
                acc = await acc[Symbol.asyncLift2](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}
```
