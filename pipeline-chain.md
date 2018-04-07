# Pipeline manipulation

This requires a new primitive like `Symbol.chain` for invoking a callback and returning based on its result. The callback returns one of three types (a `TypeError` is thrown otherwise):

- A value with a `Symbol.chain` and/or `Symbol.asyncChain` method, to unwrap
- An iterable of zero or more values to wrap (most commonly an array)
- `null`/`undefined` as a cue to break and/or unsubscribe.

These desugar to a `Symbol.chain` call, and exist to allow expressing complex logic without sacrificing conciseness or becoming too complex to use in of themselves. There are three variants:

- `coll >:> func` - This does a simple sync chain via `Symbol.chain`, returning the chained value. It may be used anywhere.
- `coll >:> async func` - This does an async chain via `Symbol.asyncChain`, returning a promise to the chained result. It may be used anywhere.
    - The promise is resolved after not only the `Symbol.chain` call is resolved, but also all the calls within the `Symbol.chain`.
- `coll >:> await func` - This does an async chain, awaiting for and returning the chained result. It may be used only in `async` functions, and is sugar for `await (coll >:> async func)`.

The desugaring is pretty straightforward, but they require some runtime helpers:

```js
coll >:> func
// Compiles to:
invokeChainSync(coll, func)

coll >:> async func
// Compiles to:
invokeChainAsync(coll, func)

coll >:> await func
// Compiles to:
await invokeChainAsync(coll, func)
```

Here's how `Symbol.chain` would be implemented for some built-in types:

- `Array.prototype[Symbol.chain]`: Basically the proposed `Array.prototype.flatMap`, but aware of the rules above.

- `Iterable.prototype[Symbol.chain]`, etc.: Flattens iterables out.

- `Promise.prototype[Symbol.chain]`, etc.: Alias for `Promise.prototype[Symbol.lift]`.

## Use cases

One easy way to use it is with defining custom stream operators, generically enough you don't usually need to concern yourself about what stream implementation they're using, or even if it's really a stream and not a generator. Here's some common stream operators, implemented using this idea:

```js
// Usage: x >:> distinct(by?)
function distinct(by = Object.is) {
    let hasPrev = false, prev
    return x => {
        const memo = hasPrev
        hasPrev = true
        return memo || by(prev, prev = x) ? [x] : []
    }
}

// Usage: x >:> filter(func)
function filter(func) {
    let hasPrev = false, prev
    return x => func(x) ? [x] : []
}

// Usage: x >:> scan(func)
function scan(func) {
    let hasPrev = false, prev
    return x => {
        const memo = hasPrev
        hasPrev = true
        return memo ? [prev, func(prev, prev = x)] : [prev = x]
    }
}

// Usage: x |> each(func)
function each(func) {
    return coll => coll >:> (func :> test => test ? undefined : [])
}

// Usage: x |> eachAwait(func)
function eachAwait(func) {
    return coll => coll >:> async (func :> test => test ? undefined : [])
}
```

TODO: more

## Helpers

The helpers themselves are probably the most complex part of this. The sync chain helper is pretty straightforward, only needing to guard against subsequent calls after breaking, but the async chain helper has a few additional edge cases to deal with:

- The `Symbol.asyncChain` call might resolve before all the callback calls do.
- There might be multiple callback calls needing awaited in parallel.
- One callback might resolve and break while others are still being awaited.
    - Once cancellation exists, we'd also have to cancel the remaining callbacks.
- The callback might be called after the `Symbol.asyncChain` call resolves, but before all the existing callback calls resolve.

```js
function invokeChainSync(coll, func) {
    if (typeof func !== "function") throw new TypeError()
    return coll[Symbol.chain](x => {
        const f = func
        if (f === void 0) throw new ReferenceError()
        const result = f(x)
        if (result == null) { func = void 0; return }
        if (Array.isArray(result)) return result
        if (typeof result[Symbol.chain] === "function") return result
        if (typeof result[Symbol.iterator] === "function") return Array.from(result)
        throw new TypeError()
    })
}

function invokeChainAsync(coll, func) {
    function awaitNext(result) {
        if (count === 0 || --count === 0) { resolve(); resolve = void 0 }
        // Unlikely, but we still need to account for it.
        if (func === void 0) return
        if (result == null) { func = void 0; count = 0; return }
        if (Array.isArray(result)) return result
        if (typeof result[Symbol.chain] === "function") return result
        if (typeof result[Symbol.iterator] === "function") return Array.from(result)
        throw new TypeError()
    }

    function awaitError(error) {
        if (count === 0 || --count === 0) { resolve(); resolve = void 0 }
        throw error
    }

    function awaitEnd(result, type) {
        if (type !== 2) func = void 0
        if (count !== 0 && --count !== 0) {
            return p.then(() => {
                resolve = void 0; count = 0
                if (type === 0) return result
                throw result
            })
        } else {
            resolve = void 0
            if (type === 1) throw result
            return type ? Promise.reject(result) : result
        }
    }

    if (typeof func !== "function") return Promise.reject(new TypeError())
    let count = 1
    let resolve
    const p = new Promise(r => resolve = r)

    try {
        const chained = Promise.resolve(coll[Symbol.asyncChain](x => {
            try {
                if (func === void 0) throw new ReferenceError()
                const result = func(x)
                count++
                return Promise.resolve(result).then(awaitNext, awaitError)
            } catch (e) {
                return Promise.reject(e)
            }
        }))
        .then(
            result => awaitEnd(result, 0),
            e => awaitEnd(e, 1)
        )
        if (count === 0 || --count === 0) { resolve(); resolve = void 0 }
        return chained
    } catch (e) {
        return awaitEnd(e, 2)
    }
}
```
