# Pipeline lifting

*If you want the theory, this is roughly modeled on [functors](https://en.wikipedia.org/wiki/Functor), with a few pragmatic concessions.*

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
const toSlug = Object.then(
    _ => _.split(" "),
    _ => _.map(word => word.toLowerCase()),
    _ => _.join("-"),
    encodeURIComponent
)
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
    |> _ => Object.then(_, word => word.toLowerCase())
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

1. A new `Object.then(x, ...fs)` function for lifted calls
1. A new `Object.asyncThen(x, ...fs)` function for lifted async calls
1. Two new well-known symbols `@@then` and `@@asyncThen` that are used by those builtins to dispatch based on type.

The pipeline operators simply call `Symbol.then`/`Symbol.asyncThen`:

```js
function syncWrap(f) {
    return function (x) { return f(x) }
}

Object.then = function then(x) {
    for (var i = 1; i < arguments.length; i++) {
        x = x[Symbol.then](syncWrap(arguments[i]))
    }
    return x
}

function asyncWrap(f) {
    return function (x) {
        try {
            return Promise.resolve(f(x))
        } catch (e) {
            return Promise.reject(e)
        }
    }
}

Object.asyncThen = function asyncThen(x) {
    for (var i = 1; i < arguments.length; i++) {
        x = x[Symbol.asyncThen](asyncWrap(arguments[i]))
    }
    return x
}
```

Here's how that `Symbol.then` would be implemented for some of these types (`Symbol.asyncThen` would be nearly identical for each of these):

- `Function.prototype[Symbol.then]`: binary function composition like this:

    ```js
    Function.prototype[Symbol.then] = function (g) {
        var f = this
        return function () {
            return g.call(this, f.apply(this, arguments))
        }
    }
    ```

- `Array.prototype[Symbol.then]`: Equivalent to `Array.prototype.map`, but only calling the callback with one argument. (This enables optimizations not generally possible with `Array.prototype.map`, like eliding intermediate array allocations.)

- `Promise.prototype[Symbol.then]`: Equivalent to `Promise.prototype.then`, if passed only one argument.

- `Iterable.prototype[Symbol.then]`: Returns an iterable that does this:

    ```js
    Iterable.prototype[Symbol.then] = function (func) {
        var iter = this
        return {
            next: function (v) {
                var result = iter.next(v)
                var done = result.done
                return {
                    done: done,
                    value: done ? result.value : func(result.value)
                }
            },
            throw: function (v) { return iter.throw(v) },
            return: function (v) { return iter.return(v) },
        }
    }
    ```

- `Map.prototype[Symbol.then]`: Map iteration/update like this:

    ```js
    Map.prototype[Symbol.then] = function (func) {
        return new this.constructor(Array.from(this, function (pair) {
            return func(pair)
        }))
    }
    ```

- `Set.prototype[Symbol.then]`: Set iteration/update like this:

    ```js
    Set.prototype[Symbol.then] = function (func) {
        return new this.constructor(Array.from(this, function (value) {
            return func(value)
        }))
    }
    ```
