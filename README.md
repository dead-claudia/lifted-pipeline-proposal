# Lifted Pipeline Proposal

1. [TL;DR: Just cut to the chase - I don't have time for a long explanation](#tldr-just-cut-to-the-chase-)
    - [If you have a little more time...](#if-you-have-a-little-more-time-)
1. [Introduction](#introduction-)
1. [Pipeline lifting](#pipeline-lifting---)
1. [Pipeline combining](#pipeline-combining---)
1. [Pipeline chaining](#pipeline-chaining---)
1. [Why operators, not functions?](#why-operators-not-functions-)
1. [Why this? We already have `.map`/`.filter`/etc...](#why-this-we-already-have-mapfilteretc-)
1. [Possible expansions](#possible-expansions-)
    - [`Object.box(value)`](#objectboxvalue-)
    - [Cancellation proxying](#cancellation-proxying-)
1. [Inspiration](#inspiration-)
1. [Related strawmen/proposals](#related-strawmenproposals-)

-----

## TL;DR: Just cut to the chase ([▲](#lifted-pipeline-proposal))

1. [Pipeline lifting](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-lift.md) for simple `.map`/`.then`-like stuff, using `coll :> func` + `@@lift`.
1. [Pipeline combining](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-combine.md) for simple `.merge`/`.combine`-like stuff, using `Object.combine(...colls, func)` + `@@combine`.
1. [Pipeline chaining](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-chain.md) for things like `.filter`/`.takeWhile`/`.flatten`, using `coll >:> func` + `@@chain`.
1. Async variants exist for each, via `coll :> async func`/`Object.asyncCombine`/`coll >:> async func`, with matching `@@async{Lift,Combine,Chain}` symbols for each.
1. `coll :> await func` &harr; `await (coll :> async func)`, `coll >:> await func` &harr; `await (coll >:> async func)`.

### If you have a little more time... ([▲](#tldr-just-cut-to-the-chase---i-dont-have-time-for-a-long-explanation-))

The proposal is in three parts:

1. [Pipeline lifting:](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-lift.md)

    - New operator `coll :> func`, which calls `coll[Symbol.lift](func)`.
    - New symbol `@@lift` to control the above.
    - For arrays, this is like `.map`.
    - For promises, this is like `.then`.
    - For functions, this is like composition.

1. [Pipeline combining:](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-combine.md)

    - New builtin `Object.combine(...colls, func)` which delegates to `coll[Symbol.combine](other, func)`
    - New symbol `@@combine` to control the above.
    - For arrays, this is like [Lodash's `_.zip`](https://lodash.com/docs#zip).
    - For promises, this is like [Bluebird's `Promise.join`](http://bluebirdjs.com/docs/api/promise.join.html).
    - For [observables](https://github.com/tc39/proposal-observable), this is like [RxJS's `Observable.combineLatest`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#static-method-combineLatest)
    - Although the builtin is variadic, the symbol hook is not.

1. [Pipeline chaining:](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-chain.md)

    - New operator `coll >:> func`, which calls `coll[Symbol.chain](func)`
    - New symbol `@@chain` to control the above.
    - For arrays, this is like [`.flatMap`](https://github.com/tc39/proposal-flatMap) crossed with `.filter` and [Lodash's `_.takeWhile`](https://lodash.com/docs#takeWhile).
    - For promises, this is like `.then`.
    - For [observables](https://github.com/tc39/proposal-observable), this is like [RxJS's `.mergeAll()`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-mergeAll) crossed with [`.filter`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-filter) and [`.takeWhile`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-takeWhile).

Async variants exist for each:

- `coll :> async func` calls `Symbol.asyncLift` instead of `Symbol.lift`.
- `Object.asyncCombine` calls `Symbol.asyncCombine` instead of `Symbol.combine`.
- `coll >:> async func` calls `Symbol.asyncChain` instead of `Symbol.chain`.
- Each of these wrap their callback to return a promise unconditionally, and they all themselves return a promise to the result.

The two operator variants can use `await` instead of `async` in `async` functions as sugar:

- `coll :> await func` &harr; `await (coll :> async func)`.
- `coll >:> await func` &harr; `await (coll >:> async func)`.

## Introduction ([▲](#lifted-pipeline-proposal))

*[Original es-discuss thread](https://esdiscuss.org/topic/function-composition-syntax) (previously, this was specific to function composition, but I've since generalized it.)*

*Before I continue, if you came here wondering what the heck this is, or what the point of it is, I invite you to read [this blog post about composition](http://blog.ricardofilipe.com/post/javascript-composition-for-dummies) and [this one on monads](https://jameswestby.net/weblog/tech/why-monads-are-useful.html), and I encourage you to google both concepts. Long story short, yes, it's a thing, and yes, it's pretty useful for a variety of reasons.*

*Also, note that this is meant to work as a complementary extension of the existing [pipeline operator proposal](https://github.com/tc39/proposal-pipeline-operator/). I use the F# variant here for simplicity, but there are still [multiple competing syntaxes](https://github.com/tc39/proposal-pipeline-operator/wiki).*

Function composition has been used for years, even in JS applications. It's one thing people have been continually reinventing as well. Many utility belts I've found have this function – in particular, most common ones have it:

- Underscore: [`_.compose`](http://underscorejs.org/#compose)
- Lodash: [`_.flow`](https://lodash.com/docs/4.15.0#flow) and [`_.flowRight`](https://lodash.com/docs/4.15.0#flowRight)
- Ramda: [`R.compose`](http://ramdajs.com/docs/#compose) and [`R.pipe`](http://ramdajs.com/docs/#pipe)

There's also the [numerous npm modules](https://www.npmjs.com/search?q=function+composition) and manual implementations (it's trivial to write a basic implementation). Conceptually, it's pretty basic:

```js
function pipe(f, g) {
    return (...xs) => g(f(...xs))
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
const toSlug = [
    _ => _.split(" "),
    _ => _.map(str => str.toLowerCase()),
    _ => _.join("-"),
    encodeURIComponent,
].reduce(pipe)
```

Or, using this proposal:

```js
const toSlug =
    (_ => _.split(" "))
    :> ^.map(str => str.toLowerCase())
    :> ^.join("-")
    :> encodeURIComponent(^)
```

Another scenario is when you just want to define a long stream:

```js
// RxJS Observables
import {Observable} from "rxjs"

function randInt(range) {
    return Math.random() * range | 0
}

function getSuggestions(selector) {
    const refreshElem = document.querySelector(".refresh")
    const baseElem = document.querySelector(selector)

    const refreshClickStream = Observable.fromEvent(refreshElem, "click")

    const responseStream = refreshClickStream.startWith()
        .map(() => `https://api.github.com/users?since=${randInt(500)}`)
        .flatMap(url => Observable.fromPromise(
            window.fetch(url).then(response => response.json())
        ))
        .map(() => listUsers[randInt(listUsers.length)])

    return Observable.fromEvent(baseElem, "click")
    .startWith(undefined)
    .combineLatest(responseStream, (_, listUsers) => listUsers)
    .merge(refreshClickStream.map(() => undefined).startWith(undefined))
    .map(suggestion => ({selector, suggestion}))
}

Observable.of(".close1", ".close2", ".close3")
.flatMap(selector => getSuggestions(selector))
.forEach(({selector, suggestion}) => {
    if (suggestion == null) {
        // hide the selector's suggestion DOM element
    } else {
        // show the selector's suggestion DOM element and render the data
    }
})
```

Problem is, there's this massive boilerplate, complexity, and jQuery-like tendencies inherent with [nearly](http://reactivex.io/rxjs/manual/overview.html) [every](https://baconjs.github.io/api2.html) [reactive](http://highlandjs.org/) [library](https://github.com/cujojs/most) [out](https://github.com/pozadi/kefir) [there](http://staltz.github.io/xstream/). RxJS has attempted to compromise with a `.do(func)`/`.let(func)` that's the moral equivalent of a [`|>` operator](https://github.com/tc39/proposal-pipeline-operator/), but even then, using custom operators doesn't feel as natural as built-in ones. (jQuery and Underscore/Lodash have similar issues here, especially jQuery.) Using this proposal (all three parts) + the pipeline operator proposal + the [observable proposal](https://github.com/tc39/proposal-observable), this could turn out a bit easier and lighter:

```js
// This proposal (35 SLoC)
function randInt(range) {
    return Math.random() * range | 0
}

function eachEvent(elem, event) {
    return new Observable(observer => {
        const listener = e => observer.next(e)
        elem.addEventListener(event, listener, false)
        observer.next()
        return () => elem.removeEventListener(event, listener, false)
    })
}

const refreshElem = document.querySelector(".refresh")
const refreshClickStream = fromEvent(refreshElem, "click")
const randomItem = list => list[randInt(list.length)]
const listUsers = (async () => refreshClickStream
    :> `https://api.github.com/users?since=${randInt(500)}`
    :> await window.fetch(^)
    :> await ^.json()
    :> randomItem(^)
)()

Observable.of([".close1", ".close2", ".close3"])
:> selector => document.querySelector(selector)
>:> (async elem => Object.combine(
    refreshClickStream :> {elem}
    Object.combine(
        fromEvent(baseElem, "click"), await listUsers,
        (_, suggestion) => ({elem, suggestion})
    )
}))
|> ^.subscribe({elem, suggestion}) => {
    if (suggestion != null) {
        // show the selector's suggestion DOM element and render the data
    } else {
        // hide the selector's suggestion DOM element
    }
})
```

For comparison, here's the RxJS and callback equivalents:

```js
// RxJS (29 SLoC + dependency)
import {Observable} from "rxjs"

function randInt(range) {
    return Math.random() * range | 0
}

function getSuggestions(selector) {
    const refreshElem = document.querySelector(".refresh")
    const baseElem = document.querySelector(selector)

    const refreshClickStream = Rx.Observable.fromEvent(refreshElem, "click")

    const responseStream = refreshClickStream.startWith()
        .map(() => `https://api.github.com/users?since=${randInt(500)}`)
        .flatMap(url => Rx.Observable.fromPromise(
            window.fetch(url).then(response => response.json())
        ))
        .map(listUsers => listUsers[randInt(listUsers.length)])

    return Rx.Observable.fromEvent(baseElem, "click")
    .startWith(undefined)
    .combineLatest(responseStream, (_, listUsers) => listUsers)
    .merge(refreshClickStream.map(() => undefined).startWith(undefined))
    .map(suggestion => ({selector, suggestion}))
}

Rx.Observable.of(".close1", ".close2", ".close3")
.flatMap(selector => getSuggestions(selector))
.subscribe(({selector, suggestion}) => {
    if (suggestion == null) {
        // hide the selector's suggestion DOM element
    } else {
        // show the selector's suggestion DOM element and render the data
    }
})

// Callbacks (31 SLoC)
function randInt(range) {
    return Math.random() * range | 0
}

const refresh = document.querySelector(".refresh")

function getSuggestions(selector, send) {
    const elem = document.querySelector(selector)
    send(elem, undefined)

    async function getUsers() {
        const url = `https://api.github.com/users?since=${randInt(500)}`
        const response = await window.fetch(url)
        const listUsers = await response.json()
        return listUsers[randInt(listUsers.length)]
    }

    let current = await getUsers()
    send(elem, current)

    refresh.addEventListener("click", () {
        current = undefined
        send(elem, undefined)
        send(elem, current = await getUsers())
    }, false)

    elem.addEventListener("click", () => send(elem, current), false)
}

for (const selector of [".close1", ".close2", ".close3"]) {
    getSuggestions(selector, (elem, suggestion) => {
        if (suggestion != null) {
            // show the first suggestion DOM element and render the data
        } else {
            // hide the first suggestion DOM element
        }
    })
}
```

It's not much longer than the RxJS variant, but critically, it has zero dependencies beyond polyfills

## Pipeline lifting ([▲](#lifted-pipeline-proposal) | [▶](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-lift.md))

So, we've got several ways of transforming values within things:

- `list.map(x => f(x))` - Transform the entries of an array.
- `promise.then(x => f(x))` - Transform the value of a promise.
- `observable.map(x => f(x))` - Transform the values emitted from an observable.
- `stream.pipe(map(x => f(x)))` - Transform the values in a Node stream (where `map` is [`through2-map`](https://www.npmjs.com/package/through2-map)).
- `func.compose(x => f(x))` - Transform the return value of a function (where `.compose` is a theoretical `Function.prototype.compose`).

If you squint hard enough, they are all variations of this same theme: `object.transform(x => f(x))`. What does that bring us?

- A way to generically map over something without having to care so much about what's in it.

My proposal for this is to add a new syntax with an associated symbol:

```js
// What you write:
x :> f

// What it does:
function pipe(x, f) {
    if (typeof func !== "function") throw new TypeError()
    return x[Symbol.lift](x => f(x))
}
```

It doesn't look like much, but it's incredibly useful and freeing with the right method implementations.

- Want to get all the `name`s out of an array of records? Use `array :> ^.name`.
- Want to get a stream of input values from an event stream? Use `stream :> ^.target.value`.
- Is the function returning an object you only want the `contents` of? Use `func :> ^.contents`.
- Want to shoehorn a function that takes a `value` and make it take events instead? Use `(e => e.target.value) :> setValue(^)`.
- Have a `Set` of numbers and strings, and you only want numbers? Use `set :> Number(^)`

If you want to dig deeper into what this really does and what all it entails, [this contains more details on the proposal itself](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-lift.md).

## Pipeline combining ([▲](#lifted-pipeline-proposal) | [▶](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-combine.md))

Sometimes, you might have a couple collections, promises, or whatever things you have that hold data, and you want to combine them. You want to join them. [This `.combineLatest` looks like your sweet spot](http://reactivex.io/rxjs/class/es6/Observable.js%7EObservable.html#instance-method-combineLatest). Or maybe [Bluebird's `Promise.join`](http://bluebirdjs.com/docs/api/promise.join.html) is that missing piece you were looking for. Or maybe, [you just wanted to run through a couple lists without pulling your hair out](https://lodash.com/docs#zip). That's what this is for. It takes all those nice and helpful things, and lifts them up to where the language understands it itself. Fewer nested loops, easier awaiting, and easier zipping iterables (which is harder than it looks to do correctly).

When you squint hard enough, these start to run together, and it's why I have this:

- `_.zipWith(array, other, (a, b) => ...)` - [Lodash's `_.zipWith`](https://lodash.com/docs#zipWith)
- `observable.zip(other, (a, b) => ...)` - [RxJS's `_.zip`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#static-method-zip)
- `Observable.combineLatest(observable, other, (a, b) => ...)` - [RxJS's `Observable.combineLatest`](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#static-method-combineLatest)
- `Promise.join(a, b, (a, b) => ...)` - [Bluebird's `Promise.join`](http://bluebirdjs.com/docs/api/promise.join.html)

My proposal is to add a couple new builtins with related symbols:

```js
// Combines each of `...args` using their related `Symbol.combine` method
Object.combine(...args, (...values) => ...)

// Combines each of `...args` using their related `Symbol.asyncCombine` method,
// returning a promise resolved with the return value
Object.asyncCombine(...args, (...values) => ...)
```

These are pretty straightforward, and their comments explain the gist of what they do. If you want more details about this proposal, or just want to read a little deeper into what the implementation might look like, [take a look here](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-combine.md).

## Pipeline chaining ([▲](#lifted-pipeline-proposal) | [▶](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-chain.md))

Of course, mapping and combining things is nice, but they're weak sauce. They do nothing to go "no more", and they offer no facility to go "nope, not passing that along". They also don't let you go "hey, add this into the mix, too". `.map` isn't enough; you want *more*. You want to not simply *combine*, but also *flatten*, but also *filter*. That's where this comes in.

After doing a bit of research to see what they really build off of, I managed to narrow it down to a single operation. Here's how I formulated that into a proposal:

```js
// What you write:
x >:> f(^)

// What this does (roughly):
function chain(x, f) {
    if (typeof func !== "function") throw new TypeError()
    return x[Symbol.chain](value => {
        const result = f(value)
        // break
        if (result == null) return undefined
        // emit values (optimization)
        if (Array.isArray(result)) return result
        // flatten value
        if (typeof result[Symbol.chain] === "function") return result
        throw new TypeError("invalid value")
    })
}
```

It's not as simple and foolproof to implement as the first two, but here's how you use it:

- If you want to break, you return `null`/`undefined`.
- If you want to emit raw values, you return an array of them.
- If you want to emit values from a chained object (usually same type as the collection), you return it.

This helper makes it possible to filter, flatten, and truncate things generically. For example, the common `.takeWhile` you find for [collections](https://lodash.com/docs#takeWhile) and [observables](http://reactivex.io/rxjs/class/es6/Observable.js~Observable.html#instance-method-takeWhile) could be generically translated into a *very* simple helper:

```js
// Use like so: `coll >:> takeWhile(^, cond)`
function takeWhile(cond) {
    return x => cond(x) ? [x] : undefined
}
```

This isn't the only one, [there's several other helpers that become trivial to write](https://github.com/isiahmeadows/lifted-pipeline-strawman/blob/master/pipeline-chain.md#use-cases), which may change how you find yourself manipulating collections in some cases.

Also, there is an async variant that awaits both the result and its callbacks before resolving, coming in two flavors: `x >:> async func` (returns promise) and `x >:> await func` (for `async`/`await`, awaits result). This variant is itself non-trivial, not because the basic common functionality is complex, but due to various edge cases, and it's the only non-trivial facet of this entire proposal.

## Why this? We already have `.map`/`.filter`/etc... ([▲](#lifted-pipeline-proposal))

It's much more general and open. I wanted to seek the lowest denominator for working with collections, one that keeps the user's cognitive overhead at a minimum and one that didn't make the implementation of various operators difficult. Yeah, it's nice to have high-level operators as methods, but I wanted to provide the means for people to define *what looping is like* for their types, so they can be looped over similarly to iterables and friends, with all the same set of control flow possibilities. Specifically:

- I wanted to keep it flexible and meaningful semantically.
    - Some things are easily mapped over, but not everything is meaningfully combined. A good example of this is with functions. (You *could* implement such a method for them, but it's not really useful in practice, just in theory.)
    - Some things are easily combined, but not everything is meaningfully chained or even manipulated. A good example of this is with a validation object, where you either have a single value or a list of errors. (In fact, you *can't* chain this one like you can with promises - chained values can depend on previously chained results, while failed validations [don't have a result you can chain](https://stackoverflow.com/a/40540290).)
    - Some things can be not only combined, but even filtered and finitely extended, but not flattened. One example of this is a [named, managed, observable slot](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement). If you don't control it, you can't chain it without loss of information. (In this case, it'd be appropriate to just throw if you receive a non-array, non-`undefined` value.)

- I wanted to decouple the object from the action, and more so, the type from the action.
    - The reason why the iterable interface is *so* attractive to implement is because people can then just use it natively in `for` loops and the like. You don't need to make assumptions about the object you have apart from that one clear interface. (If they have a weird `.forEach` or a [non-traditional `.filter`](http://api.jquery.com/filter/), you don't need to care about that.)
    - Picking an interface for people to implement makes it much easier to avoid the long monstrosity of overly-specific methods that plague jQuery, Lodash, Underscore, RxJS, BaconJS, Bluebird, and nearly every other utility belt out there.
    - Having the type decoupled from the action helps make it easier to write such utility methods yourself and share them elsewhere.

- I wanted to pick the minimal pragmatic solution that solved the problem *as a whole*.
    - There's a key difference between [bolting on interface after interface](http://openjdk.java.net/jeps/0) to add missing features and [actually thinking through your programming model before implementing it](https://github.com/rust-lang/rfcs/blob/master/text/2033-experimental-coroutines.md).
    - The minimal solution does *not* keep people from implementing utility functions themselves. In fact, the ability to *recreate* those methods is an explicit goal of this entire proposal. (If you can reimplement `Array.prototype.filter`'s basic functionality with this proposal, that's a good thing.)
    - The "minimal" part shouldn't be considered relative to each part, but to the sum of them. Adding 15 relatively simple interfaces is worse than 3 slightly more complicated interfaces that can cover the same ground.
    - The minimal solution should consider ease of use and implementation, not just ease of modeling - if a marginal increase in a feature's complexity makes the user's code complexity *substantially* lesser, I would consider that a reduction towards a minimal solution.
    - The minimal solution should consider ease of use and implementation over elegance of the surrounding model. Even if something looks like a hack, if it makes 99% of cases simple, it doesn't need to be the perfect work of art just to cover that 1% of remaining cases. Lambda calculus and its "elegant"-yet-counterintuitive model isn't the ideal here, and it doesn't make much sense in a dynamically typed programming language to try to emulate [System F<sub>&lt;:</sub>](https://en.wikipedia.org/wiki/System_F-sub) or [CoC](https://en.wikipedia.org/wiki/Calculus_of_constructions) just because they mathematically look cool. (Sorry, Fantasy Land fans.)

Of course, partial userland solutions have existed for a while for several of these issues with compatibility and extensibility (for [observables](https://github.com/jhusain/observable-spec) + [variant](https://github.com/staltz/fantasy-observable), [many basic data structures](https://github.com/fantasyland/fantasy-land), [thenables](https://github.com/promises-aplus/promises-spec), [iterables](https://tc39.github.io/ecma262/#sec-iterable-interface) + [async variant](https://tc39.github.io/ecma262/#sec-asynciterable-interface)), but this is an attempt to unify most of these under a single umbrella in a way that *feels* like JS, something that just fits right in without being *too* out there and unusual (especially in light of other recent proposals). Furthermore, even though it *is* possible to implement this in userland, it's not ideal, hence the need for a new standard:

1. Most in-language implementations of function composition involve a `.reduce` or equivalent out of necessity since they are almost always variadic. In this scenario, engines commonly end up seeing the value as megamorphic, whether in `for` or the native `.reduce`, because there's only two independent IC feedback points, and because of this, it ends up hitting the slow path *every single time*. A native assist would be invaluable for this.

2. Engines have had *so* much trouble with optimizing Array builtins in the past, and userland implementations are even slower than that. With this proposal, the intermediate values are inaccessible unless the symbols are overridden, making optimization opportunities easier.
    - V8 only just recently managed to crack the nut of inlining array methods like `.map` and `.filter` while eliding the intermediate function allocation *and* has-property check, because they can't just naïvely do a for loop - they *also* have to skip missing properties. And given the fact loop bodies can delete elements mid-loop, they had to first provide the ability to bail out from *within* existing optimized code into a slow path *corresponding that same segment of optimized code*, which is easier said than done. (No other engine does this IIUC.)
    - No engine AFAIK currently reuses existing intermediate arrays, although I've mentioned in an aside in [this V8 bug](https://bugs.chromium.org/p/v8/issues/detail?id=7436) that it's *possible* given the right set of ICs and static analysis checks.
    - In fact, for builtins (like arrays and iterables), it can frequently just merge two pipeline chains into a single callback internally. This is part of why I designed the proposal the way I did - engines don't need massive amounts of static analysis for massive gains.

3. Userland standards tend to be much better at working us into [this ugly problem](https://xkcd.com/927/). We need fewer of those.
    - For one, as a library writer, figuring out what the heck to implement for things that are kind of iterable-ish, but not in a way I can just implement `Symbol.iterator`, leads me to write the same exact methods about 5 times over for repeated variants.
    - Most existing "standards" for streams are so special-cased to a single *type* of library (monadic streams) that it occludes creating another form entirely (arrow-like streams).
    - The only real "standard" for non-stream collection-like constructs that aren't necessarily iterable is with Fantasy Land, and it doesn't always pick the most efficient way of specifying the various constructs. ([Church-encoding the results over just using `{done, value}`, really?](https://github.com/fantasyland/fantasy-land#chainrec))
    - If the system is broken and impossible to fix, it's best to just throw it all away and start over.

## Why operators, not functions? ([▲](#lifted-pipeline-proposal))

I know it's a common criticism that function composition, and even this proposal as a whole, doesn't *need* new syntax. There are in fact tradeoffs involved. But here's why I elected to go with syntax:

- This is meant to mirror the pipeline operator in appearance. It's not an exact one-to-one correspondence, but I specifically want to encourage people to view it as not dissimilar to a pipeline.

- There's fewer parentheses and tokens in general involved, especially if the operator is lower-precedence. Instead of a pair of parentheses for each chain + commas for each call, it's a single infix token. Also, there's fewer cases of nested parentheses, something that tends to plague functional JS.
    - I know this is subjective, but I'm not alone in viewing this as a benefit for proposals. It's also no accident that a lot of functional JS fans end up making larger use of functional composition than even Haskell users - it reduces the sheer number of nested parentheses they frequently run into.

- There's less to polyfill, since you only need a statically analyzable runtime helper. The binary nature of the operators make it possible to not also have to account for a variadic application. (The `Object.combine` and `Object.asyncCombine` implementations are good examples of why this is the case.)

- Operators are in their nature less verbose than functions, and in general, this proposal aims to keep things simple without getting too verbose. It also tries to keep from becoming unreadable, and line noise is something I wish to avoid. (In fact, the proposal tries to avoid being *too* tacit, requiring you to be explicit what you do at each step.)

And of course, there are downfalls to using syntax to express this:

- It's not possible to use with polyfills alone. This alone will draw people away from this proposal, because they either strongly resent transpiling in general, or they just don't want to have to add *yet another Babel plugin* just to use it. Trust me, I get the pain, too. I've written entire 50K+ SLoC projects solo targeting ES5, and I've have historically had very little need for the ES6+ syntax additions. (About the only things I've really found myself wanting are generators, arrow functions, and `async`/`await`.) And yes, transpilers are usually a pain to set up, especially Babel and TypeScript and especially with existing projects with complex build systems.

- The operator looks a bit foreign and/or weird. I'm fully aware the operator looks pretty arcane if you're just looking at it without added context, and doesn't obviously imply any sort of substantially modified pipeline. I'm not wanting to design a Haskell or Perl extension, so if you have better ideas, [please tell me](https://github.com/isiahmeadows/lifted-pipeline-strawman/issues/1). I really want to hear it.
    - My base requirements for the operator are that a) it doesn't conflict with existing syntax, b) it implies some sort of piping, and c) it implies some sort of obvious, clear direction.
    - Keep in mind, I've already gone through a few ideas:
        - `>=>` is too close to Haskell's Kleisli composition operator visually, which is equivalent to composing `Symbol.chain` callbacks to make a new such callback. (I initially proposed this in the mailing list, and it confused functional people.)
        - `>:>` was initially used for the base pipeline operator here, but it started to look a little too Perl-like, and was a little too verbose to merit being "better" than a simple utility function.
        - `->>` was once proposed, but the reverse conflicts with unary negation (think: `f <<- g` vs `f << -g`). It also doesn't visually imply piping, even though it does imply a direction.
        - `>>` and `>>>` may seem incredibly obvious, but you can't use them without potentially breaking a *lot* of existing code (they are the bit-wise arithmetic and logical right shifts, respectively). `|` also falls in a similar wheelhouse as the bitwise exclusive or operator (it also happens to be a major asm.js dependency).
    - I previously had reverse equivalents for each, but I decided against it since it's not that hard to just flip the application, and it doesn't seem to fit well with the existing base pipeline operator proposal.

- It adds to an already-complicated language, and can be fully implemented in userland without the assistance of operators. Most things that are userland-implementable don't really need to become language constructs, and very few things would actually benefit from being a core extension.
    - If you've been active or watching es-discuss for a while, you may also have had me bring up [this particular email](https://esdiscuss.org/topic/the-tragedy-of-the-common-lisp-or-why-large-languages-explode-was-revive-let-blocks) more than once. I really don't like the idea of adding substantial syntax or even new major builtins unless there are equal or greater amounts of opportunity to be gained from it. In fact, this is why I have been very cautious in how I formulated this proposal.
    - If you come from an object-oriented or procedural background and don't find yourself doing a lot of transforming on lists and/or working on data in the abstract, I can understand how this wouldn't affect you as much. This is especially true if you do mostly computationally-intensive stuff like numerical computation, games, and front-end view libraries/frameworks, where every allocation is very costly, or highly inherently stateful stuff like CRUD apps, where object-oriented programming fits your class-based domain model like a glove. (Sometimes, Rails + Backbone *is* the perfect combo for your app, since it's pretty much a giant interactive multi-user database with little else short extra little features.)

## Possible expansions ([▲](#lifted-pipeline-proposal))

These are just ideas; none of them really have to make it.

### `Object.box(value)` ([▲](#possible-expansions-))

An `Object.box(value)` to provide as an escape hatch which also facilitates optional propagation through the various operators. Here's an example with help from the [optional chaining proposal](https://github.com/tc39/proposal-optional-chaining):

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
        :> banners[^]
}
```

- This gets uncomfortably verbose...
    - It *is* a little more flexible and not *quite* as common, which helps offset this some.

- `null` values are censored to `undefined` for consistency.
    - The DOM already just censors `undefined` to `null`, so there's nothing to account for there.

- The returned object's prototype would implement the following:
    - `.value`: get the underlying value
    - `Symbol.iterator`: yield the underlying value if not `undefined`, then return
    - `Symbol.lift`:
        - If this' underlying value is `undefined`, return `this`.
        - Else, call the callback with the value, box the result, and return it.
    - `Symbol.asyncLift`:
        - If this' underlying value is `undefined`, return `this`.
        - Else, call the callback with the value, await and box the result, and return the promise to it.
    - `Symbol.combine`:
        - If this' or other's underlying value is `undefined`, return `this`.
        - Else, call the callback with both values, box the result, and return it.
    - `Symbol.asyncCombine`:
        - If this' or other's underlying value is `undefined`, return `Promise.resolve(this)`.
        - Else, call the callback with both values, await and box the result, and return the promise to it.
    - `Symbol.chain`:
        - If this' underlying value is `undefined`, return `this`.
        - Else, call the callback with the value, then:
            - If the result is a boxed value, return it directly.
            - Else, box the result and then return it.
    - `Symbol.asyncChain`:
        - If this' underlying value is `undefined`, return `Promise.resolve(this)`.
        - Else, call the callback with the value, await the result, then:
            - If the result is a boxed value, return a promise to it directly.
            - Else, box the result and then return a promise to it.

- Engines could with type feedback elide the entire pipeline and generate optimal assembly (think: zero-cost abstraction in optimized code) with little effort provided ICs assert `Object.box` and the relevant symbols aren't touched.
    - JS could use a few more zero-cost abstractions...

### Cancellation proxying ([▲](#possible-expansions-))

Depending on whether [cancellation](https://github.com/tc39/proposal-cancellation) turns out to include sugar syntax, this could hook into and integrate with that, adding an extra optional argument to all symbol hooks (like `Symbol.lift`, etc.) to allow handling cancellation (if they support it). This could allow much better cleanup in the face of cancellation, like closing sockets or aborting long polling loops.

## Inspiration ([▲](#lifted-pipeline-proposal))

- This is very similar to Fantasy Land's [`fantasy-land/map`](https://github.com/fantasyland/fantasy-land#functor) method, although it's a little more permissive.
- And, of course, the [pipeline operator proposal](https://github.com/tc39/proposal-pipeline-operator), in which this shares a *lot* of genes with.
- This isn't even my first iteration into the foray of iterative, async, parallel, and otherise non-von Neumann stuff.
    - Emulated `async`/`await` in LiveScript: https://gist.github.com/isiahmeadows/0ea14936a1680065a3a3
    - Module-based parallel JS strawperson: https://gist.github.com/isiahmeadows/a01799b4dc9019c55dfcd809450afd24
        - Some parts evolved into a library for worker pools: https://github.com/isiahmeadows/invoke-parallel
        - Since found a similar (smaller-scoped) equivalent for browsers: https://github.com/developit/workerize-loader
    - Generator-inspired async proposal: https://github.com/isiahmeadows/non-linear-proposal
        - Original gist: https://gist.github.com/isiahmeadows/ba298c7de6bbf1c36448f718be6a762b
    - Better promise abstraction: https://gist.github.com/isiahmeadows/2563c9dcf8b19bc2875e5cfb3d7709ad
        - TL;DR: you can still make things easy for consumers without making it so difficult for producers.

## Related strawpeople/proposals ([▲](#lifted-pipeline-proposal))

This is most certainly *not* on its own little island - [even the introduction shows this](#introduction). Here's several other existing proposals that could potentially benefit, or in some cases, be truly amplified, from this proposal, whether via being able to integrate with this well to its benefit, enhancing and complementing this proposal itself, or just being generally useful alongside it:

- Function pipelining:
    - `this` binding/pipelining: https://github.com/tc39/proposal-bind-operator
    - Pipeline operator (unlifted): https://github.com/tc39/proposal-pipeline-operator
    - This is supposed to be an extension of whichever proposal is selected.
    - If we go with `this`-based pipelines, I'll likely transition to built-in method helpers instead of operators to fit it better visually. (I'd go with `x::lift(f)`/`x::chain(f)`/`x::asyncChain(f)` where `const {lift, chain, asyncChain} = Object` - they're easy enough to destructure out.)

- Pattern matching: https://github.com/tc39/proposal-pattern-matching
    - Branching within callbacks would become much cleaner to do.

- Observables: https://github.com/tc39/proposal-observable
    - This would give that superpowers without having to explicitly code the usual monstrosity of methods.

- Cancellation: https://github.com/tc39/proposal-cancellation
    - This could enable proxying such requests through the operator to the implementations.

- Extra collection methods: https://github.com/tc39/proposal-collection-methods
    - This could be coded generically to cover not only sets/maps, but also observables and generators, without explicit support.
