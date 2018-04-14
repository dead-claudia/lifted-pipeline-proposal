# Pipeline chaining

*If you want the theory, this is roughly and loosely modeled on [monads](https://en.wikipedia.org/wiki/Monad_(functional_programming)) and [Fantasy Land filterables](https://github.com/fantasyland/fantasy-land#filterable), with a few pragmatic functional differences and additions.*

Sometimes, you want to manipulate the contents of a pipeline. There exist methods that help you do this already, like `Array.prototype.map` and `Array.prototype.filter`, but there currently is no generic way of just defining it for everyone. It'd be nice if we didn't have to filter or uniquify an array, an observable, and a Node.js stream in three different ways. It'd also be nice if we could just have one `scan` and one `uniq` to do it all, rather than one for each type (Lodash `_.transform` and `_.map(array, 'key')` for arrays, `.scan` and `obs.groupBy(x => x).mergeAll()` for RxJS observables). This is where this proposal comes in.

This requires a new primitive like `Symbol.chain` for invoking a callback and returning based on its result. The callback returns one of three types (a `TypeError` is thrown otherwise):

- A value with a `Symbol.chain` and/or `Symbol.asyncChain` method, to unwrap
- An array of zero or more values to wrap
- `null`/`undefined` as a cue to break and/or unsubscribe.

These desugar to a `Symbol.chain` call, and exist to allow expressing complex logic without sacrificing conciseness or becoming too complex to use in of themselves. There are three variants:

- `coll >:> func` - This does a simple sync chain via `Symbol.chain`, returning the chained value. It may be used anywhere.
- `coll >:> async func` - This does an async chain via `Symbol.asyncChain`, returning a promise to the chained result. It may be used anywhere.
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
// Usage: x >:> distinct({by?, with?})
function distinct({by = (a, b) => a === b, with: get = x => x} = {}) {
    let hasPrev = false, prev
    return x => {
        const memo = hasPrev
        hasPrev = true
        return !memo || by(prev, prev = get(x)) ? [x] : []
    }
}

// Usage: x >:> filter(func)
function filter(func) {
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

// Usage: x >:> each(func)
// Return truthy to break
function each(func) {
    return item => func(item) ? undefined : []
}

// Usage: x >:> async eachAsync(func)
// Return truthy to break
function eachAsync(func) {
    return async item => await func(item) ? undefined : []
}

// Usage: x >:> uniq({by?, with?})
function uniq({by, with: get = x => x} = {}) {
    const set = by == null ? new Set() : (items => ({
        has: item => items.some(memo => by(memo, item)),
        add: item => items.push(item),
    })([])
    return item => {
        const memo = get(item)
        if (set.has(memo)) return []
        set.add(memo)
        return [item]
    }
}
```

You can also generically define common collection predicates like `includes` or `every`, which work for observables, arrays, and streams equally (provided they're eagerly iterated), and still short-circuit.

```js
// Usage: includes(coll, item)
function includes(coll, item) {
    let result = false
    coll >:> x => {
        if (x !== item) return []
        result = true
        return undefined
    }
    return result
}

// Usage: includesAsync(coll, item)
async function includesAsync(coll, item) {
    let result = false
    coll >:> await x => {
        if (x !== item) return []
        result = true
        return undefined
    }
    return result
}

// Usage: every(coll, func)
function every(coll, func) {
    let result = true
    coll >:> x => {
        if (func(x)) return []
        result = false
        return undefined
    }
    return result
}

// Usage: everyAsync(coll, func)
async function everyAsync(coll, func) {
    let result = true
    coll >:> await async x => {
        if (await func(x)) return []
        result = false
        return undefined
    }
    return result
}
```

## Helpers

The helpers themselves are not too complicated, but they do have things they have to account for, leading to what looks like redundant code, and some borderline non-trivial work:

- One callback in the async variant might resolve and break while others are still being awaited (hence the need to check `func === void 0` after calling it).
- One callback (or even testing the result for `Symbol.chain`/`Symbol.iterator`/`.then`) might call something on the argument, which triggers a recursive call (hence the need to guard `func` in recursive calls).
- Callbacks in the async variant may be called in sequence before they all have a chance to resolve (hence the need to unlock *before* awaiting).
- If cancellation support is added, we'd also have to manage that.

```js
function invokeChainSync(coll, func) {
    if (typeof func !== "function") throw new TypeError("callback must be a function")
    var state = "open"
    return coll[Symbol.chain](function (x) {
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
    })
}

function invokeChainAsync(coll, func) {
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
    if (typeof func !== "function") return Promise.reject(new TypeError("callback must be a function"))
    try {
        var state = "open"
        return Promise.resolve(coll[Symbol.asyncChain](function (x) {
            if (state === "locked") return Promise.reject(new ReferenceError("Recursive calls not allowed!"))
            if (state === "closed") return Promise.reject(new ReferenceError("Chain already closed!"))
            try {
                state = "locked"
                return Promise.resolve(func(x)).then(asyncNext)
            } catch (e) {
                return Promise.reject(e)
            } finally {
                state = "open"
            }
        }))
    } catch (e) {
        return Promise.reject(e)
    }
}
```

In case you're concerned about the size, the two helpers bundled by themselves racks up a whopping 0.4K min+gzip, but that cost will come down when bundled with your app (and [this is worst case - I've seen the addition of code *reduce* gzip'd size](https://github.com/MithrilJS/mithril.js/issues/2095#issuecomment-373222642)). This might seem like a lot for a language feature, but it's not as much as you might think:

- My own personal contact form [has more JS than this](https://github.com/isiahmeadows/website/blob/master/src/contact.js), having about 2.0K bytes minified, 1.5K min+gzip with headers and everything. And that literally only does custom validation messaging and AJAX form submission.

- If you have ever used `for ... of` with Babel, this is absolute child's play - Regenerator is about 6.2K minified, 2.3 K min+gzip for its runtime alone, and a simple Babelified `flatMap` (defined below) with the `es2015` preset compiles to almost that much code (about 0.8K minified pre-gzip, 0.4K min+gzip).

    ```js
    function *flatMap(iter, func) {
        for (const item of iter) {
            const result = func(item)
            if (result != null && typeof result[Symbol.iterator] === "function") {
                yield* result
            } else {
                yield result
            }
        }
    }
    ```
