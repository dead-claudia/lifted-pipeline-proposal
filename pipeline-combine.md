# Pipeline combining

*If you want the theory, this is roughly modeled on [applicative functors](https://en.wikipedia.org/wiki/Applicative_functor), with a few changes for usability.*

Sometimes, you want to lift across multiple values at once, combining them as you go. This might take the form of combining [streams](https://github.com/paldepind/flyd#flydcombinebody-dependencies)/[observables](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-combineLatest), [joining promises](http://bluebirdjs.com/docs/api/promise.join.html), [combining lists](https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions), or many others. That's where this proposal comes in.

Unlike the other two, this one involves only new built-in functions, with no new syntax, and so it can be purely polyfilled. It's pretty simple:

- `Object.combine(...values, func?)` - Lift a function over one or more iterables, calling `func` with each item in each of `colls`.
    - A `RangeError` is thrown if you don't have at least two items to combine. (You can't "combine" anything with nothing.)
    - If you don't pass `func`, it defaults to just returning the arguments as an array, effectively generating a sequence of combinations.
    - This is in fact variadic, but the last parameter is type-checked as a potential function.
- `Object.asyncCombine(...values, func?)` - Like `Object.combine`, but works with async functions + async iterators.
- `value[Symbol.combine](other, func)` - You declare this to tell `Object.combine` how to combine two items.
    - If you can support combining with other types, it only cares about the first.
- `value[Symbol.asyncCombine](other, func)` - Equivalent of `Symbol.combine` for `Object.asyncCombine`

Here's how it'd be implemented for some builtins:

- `Array.prototype[Symbol.combine]`: Iterates over every combination of the two arrays, like the JS equivalent of Python's `def combine(self, other, func): [func(x, y) for x in self for y in other]`.
    - Note: this returns a flattened array (like the Python example), not a nested array.

- `Promise.prototype[Symbol.combine]`: Joins two promises and calls the function when both promises resolve, returning a new promise with the function's result.
    - This is *slightly* duplicative of `Promise.all`, but the engine could better statically allocate promise resolution.
    - `Promise.all` will remain more predictable performance-wise for truly variadic allocations.

- `Iterable.prototype[Symbol.combine]`: Works similarly to `Array.prototype[Symbol.combine]`, but returns an iterable instead.
    - Note: this has to first convert the second iterable to a list before iterating `this`, since iterators are usually *not* restartable.

- You could implement `Function.prototype[Symbol.combine]` to return `(a, b) => func(this(a), other(b))`, but it's not generally very useful (even in the world of Haskell).

## Implementation

The general implementation would look like this:

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
        let acc = value1[Symbol.combine](value2, (as, b) => [...as, b])
        const last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            const end = arguments.length - 2

            for (let i = 2; i < end; i++) {
                acc = acc[Symbol.combine](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.lift2](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (let i = 2; i < arguments.length; i++) {
                acc = acc[Symbol.combine](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}

Object.asyncCombine = async function (iter1, value2, func) {
    switch (arguments.length) {
    case 0: case 1:
        throw new RangeError("must have at least 2 entries to combine")

    case 2:
        return value1[Symbol.asyncCombine](value2, (a, b) => [a, b])
    
    case 3:
        return typeof func === "function"
            ? value1[Symbol.asyncCombine](value2, (a, b) => func(a, b))
            : (await value1[Symbol.asyncCombine](iter2, (a, b) => [a, b]))
                [Symbol.asyncCombine](func, ([a, b], c) => [a, b, c])

    default:
        let acc = await value1[Symbol.asyncCombine](value2, (a, b) => [a, b])
        const last = arguments[arguments.length - 1]
        if (typeof last === "function") {
            const end = arguments.length - 2

            for (let i = 2; i < end; i++) {
                acc = await acc[Symbol.asyncCombine](arguments[i], (as, b) => [...as, b])
            }

            return acc[Symbol.asyncCombine](arguments[arguments.length - 2], (as, b) => last(...as, b))
        } else {
            for (let i = 2; i < arguments.length; i++) {
                acc = await acc[Symbol.asyncCombine](arguments[i], (as, b) => [...as, b])
            }

            return acc
        }
    }
}
```
