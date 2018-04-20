# Pipeline chaining

*If you want the theory, this is roughly and loosely modeled on [monads](https://en.wikipedia.org/wiki/Monad_(functional_programming)) and [Fantasy Land filterables](https://github.com/fantasyland/fantasy-land#filterable), with a few pragmatic functional differences and additions.*

Sometimes, you want to manipulate the contents of a pipeline. There exist methods that help you do this already, like `Array.prototype.map` and `Array.prototype.filter`, but there currently is no generic way of just defining it for everyone. It'd be nice if we didn't have to filter or uniquify an array, an observable, and a Node.js stream in three different ways. It'd also be nice if we could just have one `scan` and one `uniq` to do it all, rather than one for each type (Lodash `_.transform` and `_.map(array, 'key')` for arrays, `.scan` and `obs.groupBy(x => x).mergeAll()` for RxJS observables). This is where this proposal comes in.

This requires a new primitive like `Symbol.chain` for invoking a callback and returning based on its result. The callback returns one of three types (a `TypeError` is thrown otherwise):

- A value with a `Symbol.chain` and/or `Symbol.asyncChain` method, to unwrap
- An array of zero or more values to wrap
- `null`/`undefined` as a cue to break and/or unsubscribe.

These desugar to a `Symbol.chain` or `Symbol.asyncChain` call, and exist to allow expressing complex logic without sacrificing conciseness or becoming too complex to use in of themselves. There are two variants:

- `Object.chain(coll, ...funcs)` - This does a simple sync chain via `Symbol.chain`, returning the chained value.
- `Object.chainAsync(coll, ...funcs)` - This does an async chain via `Symbol.asyncChain`, returning a promise to the chained result.
- Two new well-known symbols `@@chain` and `@@asyncChain` used by the above builtins to dispatch based on type.

They are pretty simple conceptually: invoke the callback, unwrap it as applicable, and return the result. The callback returns one of three types (a `TypeError` is thrown otherwise):

- A value with a `Symbol.chain` and/or `Symbol.asyncChain` method, to unwrap
- An array of zero or more values to wrap
- `null`/`undefined` as a cue to break and/or unsubscribe.

Here's how `Symbol.chain` would be implemented for some built-in types:

- `Array.prototype[Symbol.chain]`: Basically the proposed `Array.prototype.flatMap`, but aware of the rules above.

- `Iterable.prototype[Symbol.chain]`, etc.: Flattens iterables out, but aware of the rules above.

- `Promise.prototype[Symbol.chain]`: Similar to `Promise.prototype.then`, except it doesn't resolve at all if the callback returns `null`/`undefined`.

## Use cases

One easy way to use it is with defining custom stream operators, generically enough you don't usually need to concern yourself about what stream implementation they're using, or even if it's really a stream and not a generator. Here's some common stream operators, implemented using this idea:

```js
// Usage: coll |> distinct({by?, with?})
function distinct({by = (a, b) => a === b, with: get = x => x} = {}) {
    let hasPrev = false, prev
    return coll => Object.chain(coll, x => {
        const memo = hasPrev
        hasPrev = true
        return !memo || by(prev, prev = get(x)) ? [x] : []
    }
}

// Usage: coll |> then(func)
function then(func) {
    return coll => Object.then(coll, func)
}

// Usage: coll |> filter(func)
function filter(func) {
    return coll => Object.chain(coll, x => func(x) ? [x] : [])
}

// Usage: coll |> scan(func)
function scan(func) {
    let hasPrev = false, prev
    return coll => Object.chain(coll, x => {
        const memo = hasPrev
        hasPrev = true
        return memo ? [prev, func(prev, prev = x)] : [prev = x]
    })
}

// Usage: coll |> each(func)
// Return truthy to break
function each(func) {
    return coll => Object.chain(coll, item => func(item) ? undefined : [])
}

// Usage: coll |> eachAsync(func)
// Return truthy to break
function eachAsync(func) {
    return coll => Object.chainAsync(coll, async item => await func(item) ? undefined : [])
}

// Usage: coll |> tap(func)
function tap(func) {
    return coll => Object.then(coll, item => { func(item); return item })
}

// Usage: coll |> tapAsync(func)
function tapAsync(func) {
    return coll => Object.thenAsync(coll, async item => { await func(item); return item })
}

// Usage: coll |> uniq({by?, with?})
function uniq({by, with: get = x => x} = {}) {
    const set = by == null ? new Set() : (items => ({
        has: item => items.some(memo => by(memo, item)),
        add: item => items.push(item),
    })([])
    return coll => Object.chain(coll, item => {
        const memo = get(item)
        if (set.has(memo)) return []
        set.add(memo)
        return [item]
    })
}
```

## Implementation

The helpers themselves are not too complicated, but they do have things they have to account for, leading to what looks like redundant code, and some borderline non-trivial work:

- One callback in the async variant might resolve and break while others are still being awaited (hence the need to check `func === void 0` after calling it).
- One callback (or even testing the result for `Symbol.chain`/`Symbol.iterator`/`.then`) might call something on the argument, which triggers a recursive call (hence the need to guard `func` in recursive calls).
- Callbacks in the async variant may be called in sequence before they all have a chance to resolve (hence the need to unlock *before* awaiting).
- If cancellation support is added, we'd also have to manage that.

```js
Object.chain = function (coll) {
    function wrapChain(func) {
        var state = "open"
        return function (x) {
            if (state === "locked") throw new ReferenceError("Recursive calls not allowed!")
            if (state === "closed") throw new ReferenceError("Chain already closed!")
            try { var result = func(x) } catch (e) { state = "open"; throw e }
            if (result == null) { state = "closed"; func = void 0; return void 0 }
            state = "open"
            if (Array.isArray(result)) return result

            try {
                state = "locked"
                if (typeof result[Symbol.chain] === "function") return result
                throw new TypeError("Invalid type for result")
            } finally {
                state = "open"
            }
        }
    }
    for (var i = 1; i < arguments.length; i++) {
        coll = coll[Symbol.chain](wrapChain(arguments[i]))
    }
    return coll
}

Object.chainAsync = function (coll) {
    function wrapChain(func) {
        var state = "open"
        function asyncNext(result) {
            if (state === "closed") return void 0
            if (result == null) { state = "closed"; func = void 0; return void 0 }
            if (Array.isArray(result)) return result
            try {
                state = "locked"
                if (typeof result[Symbol.chain] === "function") return result
                throw new TypeError("Invalid type for result")
            } finally {
                state = "open"
            }
        }
        return function (x) {
            if (state === "locked") throw new ReferenceError("Recursive calls not allowed!")
            if (state === "closed") throw new ReferenceError("Chain already closed!")
            try { var result = func(x) } catch (e) { state = "open"; throw e }
            if (result == null) { state = "closed"; func = void 0; return void 0 }
            state = "open"
            if (Array.isArray(result)) return result

            try {
                state = "locked"
                if (typeof result[Symbol.chain] === "function") return result
                throw new TypeError("Invalid type for result")
            } finally {
                state = "open"
            }
        }
    }
    for (var i = 1; i < arguments.length; i++) {
        coll = coll[Symbol.asyncChain](wrapChain(arguments[i]))
    }
    return coll
}
```
