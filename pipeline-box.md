# `Object.box(value)`

There already exist [optional chaining](https://github.com/tc39/proposal-optional-chaining) and [nullish coalescing](https://github.com/tc39/proposal-nullish-coalescing), which cover a lot of ground in of themselves. They're very useful for the common cases of nested property accesses (that might not be there) and "default" expressions, but this breaks down when you need to do more complex stuff:

```js
// What you'd do now
function getUserBanner(banners, user) {
    if (user && user.accountDetails && user.accountDetails.address) {
        return banners[user.accountDetails.address.province]
    } else {
        return undefined
    }
}

// With optional chaining
function getUserBanner(banners, user) {
    const province = user?.accountDetails?.address?.province
    return province != null ? banners[province] : undefined
        :> p => banners[p]
}
```

With this builtin, you can now do this:

```js
function getUserBanner(banners, user) {
    return Object.then(
        Object.box(user?.accountDetails?.address?.province)
        p => banners[p],
    )
}
```

Unlike those, you can do even longer pipelines with this, and this is where it becomes a bit more magical:

```js
// Original
let postCode
if (person != null) {
    if (person.hasMedicalRecord() && person.address != null) {
        checkAddress(person.address)
        if (person.address.postCode != null) {
            postCode = `${person.address.postCode}`
        } else {
            postCode = "UNKNOWN"
        }
    }
}

// With this + a destructuring default
let postCode = Object.then(
    Object.box(person),
    person => person.hasMedicalRecord() ? person : undefined,
    person => person.address,
    address => { checkAddress(address); return address },
    address => address.postCode,
    postCode => `${postCode}`
).value ?? "UNKNOWN"
```

It very cleanly unnested the entire pipeline. Now, let's add some more sugar: let's use the [pipeline operator](https://github.com/tc39/proposal-pipeline-operator/) and [some useful pipeline operators](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/isiahmeadows-syntax-free/pipeline-chain.md#use-cases).

```js
let postCode = Object.box(person)
    |> filter(person => person.hasMedicalRecord())
    |> then(person => person.address)
    |> tap(address => checkAddress(address))
    |> then(address => address.postCode)
    |> then(postCode => `${postCode}`)
    |> postCode => postCode.value ?? "UNKNOWN"

// Helpers used from there:
function then(func) {
    return coll => Object.then(coll, func)
}

function filter(func) {
    return coll => Object.chain(coll, x => func(x) ? [x] : [])
}

function tap(func) {
    return coll => Object.then(coll, item => { func(item); return item })
}
```

If you noticed, there's *nothing* specific to optionals there. I used helpers built for streams, and just used them here for a boxed object pipeline. That's part of the magic of this: you can use the same stuff across pipelines without issue.

Oh, and there's a few other goodies:

1. `null`s get censored to `undefined`, just like with null coalescing and optional chaining. It's merely convenient with those, but it helps this more.

1. You can `Object.combine` them and get a new box. It works mostly like this:
    - If all boxes have values, the function gets called with all their contents.
    - Otherwise, an empty box is returned.

1. You can `Object.merge` them. It goes left to right and chooses the first box with a value. Easy!

1. The `Object.async{Then,Combine,Chain}` variants work. You don't need to worry if you have an async function or promise pipeline - you can still work with it, and this still works with it.

1. You can iterate them as if they were a single-item array/generator/whatever. In fact, the above pipeline could've been specified as this:

    ```js
    let [postCode = "UNKNOWN"] = Object.box(person)
        |> filter(person => person.hasMedicalRecord())
        |> then(person => person.address)
        |> tap(address => checkAddress(address))
        |> then(address => address.postCode)
        |> then(postCode => `${postCode}`)
    ```

    This also means you can break early by just looping over it. If you need to return early from an async function, but you still want to handle the value safely and easily, here's how you do it:

    ```js
    for (const value of box) {
        const result = await fetchSomethingWithValue(value)
        if (result.success) return "OMG IT WORKED!!!!1!1!!1!1one!!oneoneone!"
    }
    console.log("-_-")
    ```

## Implementation

Engines should most certainly implement this as a pseudo-primitive like arrays. Every method should be trivially inlinable, and for the most part, engines *should* be able to elide the allocations in the above pipeline. Once engines can optimize simple curried functions like `filter` above, they could continue further and reduce it down to *fully* optimal code after the JIT kicks in. (Zero-cost abstractions for the win!)

The basic polyfill works roughly like this:

```js
Object.box = function box(value) {
    return new Box(value)
}

class Box {
    constructor(value) {
        if (value == null) value = undefined
        this._value = value
    }

    get value() {
        return this._value
    }

    *[Symbol.iterator]() {
        if (this._value !== void 0) yield this._value
    }

    [Symbol.then](func) {
        return this._value != null ? new Box(func(this._value)) : this
    }

    [Symbol.combine](other, func) {
        if (this._value != null && other._value != null) {
            return new Box(func(this._value, other._value))
        } else {
            return this
        }
    }

    [Symbol.chain](func) {
        if (this._value == null) return this
        const result = func(this._value)
        if (result instanceof Box) return result
        const [first] = result
        return new Box(first)
    }

    async [Symbol.asyncThen](func) {
        return this._value != null ? new Box(await func(this._value)) : this
    }

    async [Symbol.asyncCombine](func) {
        if (this._value != null && other._value != null) {
            return new Box(await func(this._value, other._value))
        } else {
            return this
        }
    }

    async [Symbol.asyncChain](func) {
        if (this._value == null) return this
        const result = await func(this._value)
        if (result instanceof Box) return result
        const [first] = result
        return new Box(first)
    }
}
```
