# Pipeline combining

*If you want the theory, this is roughly modeled on [applicative functors](https://en.wikipedia.org/wiki/Applicative_functor), with a few changes for usability.*

Sometimes, you want to lift across multiple values at once, combining them as you go. This might take the form of combining [streams](https://github.com/paldepind/flyd#flydcombinebody-dependencies)/[observables](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-combineLatest), [joining promises](http://bluebirdjs.com/docs/api/promise.join.html), [combining lists](https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions), or many others. That's where this proposal comes in.

Unlike the other two, this one involves only new built-in functions, with no new syntax, and so it can be purely polyfilled. It's pretty simple:

- `Object.combine(...values, func?)` - Lift a function over one or more iterables, calling `func` with each item in each of `values`.
    - A `RangeError` is thrown if you don't have at least two items to combine. (You can't "combine" anything with nothing.)
    - If you don't pass `func`, it defaults to just returning the arguments as an array, effectively generating a sequence of combinations.
    - This is in fact variadic, but the last parameter is type-checked as a potential function.

- `Object.asyncCombine(...values, func?)` - Like `Object.combine`, but works with async functions + async iterators.

- `Object.merge(...values)` - Like `Object.combine`, but instead of iterating combinations, it just interleaves everything.
    - By default, it tries `value[Symbol.merge](other)` first.
    - If that is missing, it tries `value[Symbol.combine](other, (a, b) => [a, b])[Symbol.chain](pair => pair)` instead.

- `value[Symbol.combine](other, func)` - You declare this to tell `Object.combine` how to combine two items.
    - If you can support combining with other types, it only cares about the first.

- `value[Symbol.asyncCombine](other, func)` - Equivalent of `Symbol.combine` for `Object.asyncCombine`

- `value[Symbol.merge](other)` - You declare this to tell `Object.merge` how to merge two collections, if the default is wrong. (Generally, the default is right for most collections, but it's not for anything varying over time.)

Here's how it'd be implemented for some builtins:

- `Array.prototype[Symbol.combine]`: Zip the two arrays, optionally with a callback.
    - This is basically [Lodash's `_.zip_with`](https://lodash.com/docs#zipWith).
    - Yes, this could instead iterate combinations like in Python's `[func(x, y) for x in self for y in other]`, but it's not as broadly useful (especially in JS), and you can't do that with generic iterables. (You could already emulate that via `as.map(a => bs.map(b => f(a, b)))`.)
    - Note: this does *not* skip indices, unlike with `Object.then`/`Symbol.then`. (Tracking this would be counterintuitive.)
    - Note: this limits the length to that of the smaller array.

- `Promise.prototype[Symbol.combine]`: Joins two promises and calls the function when both promises resolve, returning a new promise with the function's result.
    - Both operands are type-checked to be promises, so they can remain on the same tick.
    - This is *slightly* duplicative of `Promise.all`, but the engine could better statically allocate promise resolution.
    - `Promise.all` will still remain better for awaiting dynamically-sized lists of promises.

- `Promise.prototype[Symbol.merge]`: Basically a binary `Promise.race`. Prefer this for smaller static lists, `Promise.race` for anything dynamically sized.

- `Iterable.prototype[Symbol.combine]`: Works similarly to `Array.prototype[Symbol.combine]`, but returns an iterable instead.
    - This is surprisingly harder than you'd expect to implement in userland while retaining `for ... of`-like semantics.

- `Map.prototype[Symbol.merge]`, `Set.prototype[Symbol.merge]`: Maps and sets are mergeable, but not meaningfully combined like arrays or promises.
    - Maps and sets can implement this *very* efficiently.
    - Maps merge based on keys.

- You *could* implement `Function.prototype[Symbol.combine]` to return `(a, b) => func(this(a), other(b))`, but it's not generally very useful (even in the world of Haskell), and it'd interfere with the overload resolution.

## Implementation

An implementation most *certainly* should try to avoid taking the slow path for arrays and iterables, especially when merging, since there's *large* opportunities for optimization:

- Promises don't need to allocate a full array to destructure for `Symbol.combine` - it just needs a simple array

- Arrays could have their `Object.merge` lowered to copying into a new array, then an in-place matrix transpose. (That second step is the hard part.)

- Iterators could have their `Object.merge` lowered into a simple round robin iterator.

The polyfill implementation would look something like this:

```js
// These are also optimized.
Object.combine = function (value1, value2, func) {
    switch (arguments.length) {
    case 0: case 1:
        throw new RangeError("must have at least 2 entries to combine")

    case 2:
        return value1[Symbol.combine](value2, (a, b) => [a, b])
    
    case 3:
        return typeof func === "function"
            ? value1[Symbol.combine](value2, (a, b) => func(a, b))
            : value1
                [Symbol.combine](value2, (a, b) => [a, b])
                [Symbol.combine](func, ([a, b], c) => [a, b, c])

    default:
        var acc = value1[Symbol.combine](value2, (as, b) => [...as, b])
        var last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            var end = arguments.length - 2

            for (var i = 2; i < end; i++) {
                acc = acc[Symbol.combine](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.combine](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (var i = 2; i < arguments.length; i++) {
                acc = acc[Symbol.combine](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}

Object.asyncCombine = function (value1, value2, func) {
    switch (arguments.length) {
    case 0: case 1:
        throw new RangeError("must have at least 2 entries to combine")

    case 2:
        return value1[Symbol.asyncCombine](value2, (a, b) => [a, b])

    case 3:
        return typeof func === "function"
            ? value1[Symbol.asyncCombine](value2, (a, b) => func(a, b))
            : value1
                [Symbol.asyncCombine](value2, (a, b) => [a, b])
                [Symbol.asyncCombine](func, ([a, b], c) => [a, b, c])

    default:
        var acc = value1[Symbol.asyncCombine](value2, (a, b) => [a, b])
        var last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            var end = arguments.length - 2

            for (var i = 2; i < end; i++) {
                acc = acc[Symbol.asyncCombine](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.asyncCombine](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (var i = 2; i < arguments.length; i++) {
                acc = acc[Symbol.asyncCombine](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}

Object.merge = function (value1, value2) {
    switch (arguments.length) {
    case 0:
        throw new RangeError("must have at least one argument to merge")

    case 1:
        return value1

    case 2:
        return typeof value1[Symbol.merge] === "function"
            ? value1[Symbol.merge](value2)
            : value1[Symbol.combine](value2, (a, b) => [a, b])[Symbol.chain](pair => pair)

    default:
        var acc = value1

        for (let i = 1; i < arguments.length; i++) {
            acc = typeof acc[Symbol.merge] === "function"
                ? acc[Symbol.merge](arguments[i])
                : acc[Symbol.combine](arguments[i], (a, b) => [a, b])[Symbol.chain](pair => pair)
        }

        return acc
    }
}
```
