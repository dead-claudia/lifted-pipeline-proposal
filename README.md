[*Original es-discuss thread*](https://esdiscuss.org/topic/function-composition-syntax)

# Function Composition Strawman

Function composition has been used for years, even in JS applications. It's one thing people have been continually reinventing as well. Many utility belts I've found have this function &ndash; in particular, most common ones have it:

- Underscore: [`_.compose`](http://underscorejs.org/#compose)
- Lodash: [`_.flow`](https://lodash.com/docs/4.15.0#flow) and [`_.flowRight`](https://lodash.com/docs/4.15.0#flowRight)
- Ramda: [`R.compose`](http://ramdajs.com/docs/#compose) and [`R.pipe`](http://ramdajs.com/docs/#pipe)

There's also the [numerous npm modules](https://www.npmjs.com/search?q=function+composition) and manual implementations (it's trivial to write a basic implementation). Conceptually, it's pretty basic:

```js
function compose(f, ...fs) {
    return function (...xs) {
        return fs.reduceRight((x, f) => f.call(this, x), f.apply(this, xs))
    }
}
```

These are, of course, very convenient functions to have, but it's very inefficient to implement at the language level. Instead, if it was implemented at the engine level, you could optimize it in ways not possible at the language level:

1. It's possible to create pipelines which are as fast, if not faster, than standard function calls.

2. Engines can better optimize the types. In the below, which is the usual optimized function implementation, `x` would be quickly marked as megamorphic, and the return value is generally not optimized during execution:

    ```js
    function compose(f, ...fs) {
        return function () {
            var result = f.apply(this, arguments)

            for (var i = 0; i < fs.length; i++) {
                result = fs[i].call(this, result)
            }

            return result
        }
    }
    ```

3. [[Call]] and [[Construct]] can be special-cased for these, knowing they require minimal stack manipulation and are relatively trivial to implement. Also, after you verify the types, you don't need to type-check the functions when calling them.
4. Anonymous functions can be inlined into the pipeline, and don't actually require separate allocation.

## Proposed syntax/semantics

Here's what I propose: a new `f :> g` infix operator for left-to-right composition, and `g <: f` for right-to-left composition, with the following semantics:

1. Verify the first operand in `f :> g` (or second in `g :< f`) is callable and/or constructible. If not, throw a **TypeError**.
2. Verify the other operand is callable. If not, throw a **TypeError**.
3. Let *composed* be a new strict mode function that does the following:
    - [[Call]]:
        1. Let *this* be the current context.
        2. Let *args* be the list of arguments passed.
        3. Let *inner* be ? *f*.[[Call]]\(*this*, *args*) (in JS, this would be `f.apply(this, args)`).
        4. Let *result* be ? *g*.[[Call]]\(*this*, <<*inner*>>) (in JS, this would be `g.call(this, result)`.
        5. Return *result*.
    - [[Construct]] (if *f* has a [[Construct]] internal method):
        1. Let *args* be the list of arguments passed.
        2. Let *newTarget* be **new.target**.
        2. Let *inner* be ? *f*.[[Construct]]\(*newTarget*, *args*) (in JS, this would be `new f(...args)`).
        3. Let *result* be ? *g*.[[Call]]\(**undefined**, <<*inner*>>) (in JS, this would be `g(result)`.
        4. Return *result*.
4. Set the length of *composed* to the length of *f*.
5. Return *composed*.

## Why an operator, not a function? Why does this even exist?

**Pros:**

(Easier to implement, optimize, and for some, read.)

1. Fewer parentheses. That is always a bonus.
2. Engines can easily statically optimize anonymous functions in the middle:
    - They won't need to be type-checked, since syntactically, they are known to be correct at parse time.
    - If they don't refer to their outer closure, only their code needs allocated.
    - The functions can share a single closure, and don't need independently allocated, since their reference won't be used.
    - This pipelining can be done through code generation on creation as well, but the generated code would be far quicker to create and could be done on creation instead of inlining.
    - The result can be cached fairly easily in case it needs recreated again..
3. Engines can special-case composed function invocation to be lighter than even a normal function call.
    - Function calls don't need their types verified twice.
    - This will also make calling into other composed functions even cheaper.
    - Calls to composed functions are easier to inline than normal functions.
4. Even transpilers like Babel can do some of their own optimizations similarly to above (e.g. with anonymous function literals and pipelining).

**Cons:**

(Harder to polyfill/etc., unusual operator.)

1. It's syntax that must be transpiled, not polyfilled.
    - I know, but the reason I chose syntax is to enable more efficient handling of it and to reduce parentheses.
2. The operator looks a bit foreign and/or weird.
    - Yeah...I initially used `>=>` in the mailing list and `>:>`/`<:<` here, but I was mostly looking for an operator that a) didn't conflict with existing syntax (`f <<- g` conflicts with `f << -g`, for example), and b) indicated some sort of direction. If you have a better idea, [I'm all ears](https://github.com/isiahmeadows/function-composition-proposal/issues/1).
    - I did adjust my original proposal to go both ways, since they each have their merits.
3. Why syntax? Why shouldn't this be a normal function?
    - You can bake the optimizations into the bytecode rather than just the compiler, making it literally zero-cost.
    - Transpilers can compile it to a single function after type checks.
4. It adds to an already-complicated language, and can still be implemented in userland.
    - I'm aware many people will be skeptical about adding new syntax. I'm also very well aware of [this very influential mailing list post](https://esdiscuss.org/topic/the-tragedy-of-the-common-lisp-or-why-large-languages-explode-was-revive-let-blocks), and I myself have used it to explain why some things like [an extended dot notation for picking out properties into a new object](https://esdiscuss.org/topic/extended-dot-notation-pick-notation-proposal) (1 vs 2 lines) is a bad idea to add. But I feel this could actually provide enough benefit to pay itself off, due to numerous optimizations largely not tractible otherwise.
    - Async functions are a good example of a [user-land abstraction](https://www.npmjs.com/package/co) that turned out far better as syntax.
    - We already have several methods that can be (and often are) self-hosted, like `Array.prototype.filter` and `Array.prototype.forEach`.
5. Why would I ever need this? Or better yet, what's function composition in the first place? I've never heard of it.
    - I invite you to read [this blog post](http://blog.ricardofilipe.com/post/javascript-composition-for-dummies) or [this one (slightly academic)](https://medium.com/@chetcorcos/functional-programming-for-javascript-people-1915d8775504#.fkkayimp4). Long story short, it's useful.
