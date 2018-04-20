// This is a full polyfill for `Object.then`, `Object.asyncThen`, `Symbol.then`,
// and `Symbol.asyncThen`. It's ES5-compatible assuming ES6 globals and supports
// some ES7+ globals if present. (Note: Babelified async generators won't be
// detected - I have no way of attaching myself to them globally.)
;(function (global) {
    "use strict"
    // Global imports
    var Object = global.Object
    var Array = global.Array
    var Function = global.Function
    var Symbol = global.Symbol
    var Promise = global.Promise
    var Map = global.Map
    var Set = global.Set
    var IteratorPrototype = Object.getPrototypeOf(
        Object.getPrototypeOf([].entries())
    )

    // Note: all methods that need called after the polyfill runs *must* be
    // pulled out like these.
    var tempMapIter = new Map().entries()
    var tempSetIter = new Set().entries()
    var call = Function.call.bind(Function.call)
    var apply = Function.call.bind(Function.apply)
    var mapForEach = Function.call.bind(Map.prototype.forEach)
    var setForEach = Function.call.bind(Set.prototype.forEach)
    var mapEntries = Function.call.bind(Map.prototype.entries)
    var setEntries = Function.call.bind(Set.prototype.entries)
    var mapEntriesNext = Function.call.bind(tempMapEntries.next)
    var setEntriesNext = Function.call.bind(tempSetEntries.next)
    var PromiseResolve = Promise.resolve.bind(Promise)
    var PromiseReject = Promise.reject.bind(Promise)
    var PromiseThen = Function.call.bind(Promise.prototype.then)
    var isArray = Array.isArray
    var from = Array.from
    var defineProperty = Object.defineProperty
    var objectCreate = Object.create
    var symbolSpecies = Symbol.species
    var defineTypedArrayMethod, AsyncIteratorPrototype

    var types = [
        global.Int8Array, global.Uint8Array, global.Uint8ClampedArray,
        global.Int16Array, global.Uint16Array, global.Int32Array,
        global.Uint32Array, global.Float32Array, global.Float64Array
    ]
    .filter(function (Type) {
        if (typeof Type !== "function") return false
        if (Type.prototype == null) return false
        var proto = Object.getPrototypeOf(Type.prototype)
        if (proto !== Object.prototype) return true
        var desc = Object.getOwnPropertyDescriptor(proto, "buffer")
        return desc != null && typeof desc.get === "function"
    })

    try {
        AsyncIteratorPrototype = (0, eval)(
            "Object.getPrototypeOf(async function*(){}())"
        )
    } catch (e) {
        // ignore - we can't reach it otherwise.
    }

    function methodName(method) {
        return typeof method === "symbol"
            ? "[" + String(method).slice(7, -1) + "]"
            : method
    }

    function checkMap(object, method) {
        try {
            mapEntries(object)
        } catch (e) {
            throw new TypeError(
                methodName(method) + " method called on incompatible receiver"
            )
        }
    }

    function checkSet(object, method) {
        try {
            setEntries(object)
        } catch (e) {
            throw new TypeError(
                methodName(method) + " method called on incompatible receiver"
            )
        }
    }

    function TypedArrayController(Type) {
        this.type = Type
        this.subarray = Function.call.bind(Type.prototype.subarray)
        this.buffer = Function.call.bind(
            Object.getOwnPropertyDescriptor(Type.prototype, "buffer").get
        )
        this.length = Function.call.bind(
            Object.getOwnPropertyDescriptor(Type.prototype, "length").get
        )
        this.get = Function.call.bind(Type.prototype.get)
        this.set = Function.call.bind(Type.prototype.set)
        this.set = Function.call.bind(Type.prototype.set)
    }

    TypedArrayController.prototype.validate = function (value, method, isResult) {
        try {
            this.subarray(value)
        } catch (e) {
            var message = methodName(method) + " method called on "
            try {
                this.buffer(value)
                message += "detached ArrayBuffer"
            } catch (e) {
                message += "incompatible receiver"
            }
            if (isResult) message += " as target"
            throw new TypeError(message)
        }
    }

    TypedArrayController.prototype.create = function (object, length, method) {
        var C = speciesConstructor(object, this.type)
        var result = new C(length)
        this.validate(result, method, true)
        if (this.length(result) < length) {
            throw new TypeError(
                methodName(method) +
                " method called on receiver too small as target"
            )
        }
        return result
    }

    if (types.length === 0) {
        defineTypedArrayMethod = function () {
            // ignore
        }
    } else if (Object.getPrototypeOf(types[0].prototype) === Object.prototype) {
        types = types.map(function (Type) {
            return new TypedArrayController(Type)
        })
        defineTypedArrayMethod = function (name, create) {
            for (var i = 0; i < types.length; i++) {
                polyfill(types[i].type.prototype, name, create(types[i]))
            }
        }
    } else {
        types = new TypedArrayController(Object.getPrototypeOf(types[0]))
        defineTypedArrayMethod = function (name, create) {
            polyfill(types.type.prototype, name, create(types))
        }
    }

    function methods(proto, keys) {
        for (var key in keys) {
            var desc = Object.getOwnPropertyDescriptor(keys, key)
            desc.enumerable = false
            defineProperty(proto, key, desc)
        }
    }

    function defineIterator(options) {
        var sym = Symbol.for(options.key)
        var ChildPrototype = objectCreate(IteratorPrototype)

        methods(ChildPrototype, {
            next: function (value) {
                var state = internalGet(sym, this, "next")
                return call(options.next, state, value)
            },

            throw: function (value) {
                var state = internalGet(sym, this, "throw")
                return call(options.throw, state, value)
            },

            return: function (value) {
                var state = internalGet(sym, this, "return")
                return call(options.return, state, value)
            },
        })

        return function () {
            var result = objectCreate(ChildPrototype)
            createDataPropertyOrThrow(result, sym,
                apply(options.create, void 0, arguments)
            )
            return result
        }
    }

    function defineAsyncIterator(options) {
        var sym = Symbol.for(options.key)
        var ChildPrototype = objectCreate(AsyncIteratorPrototype)

        methods(ChildPrototype, {
            next: function (value) {
                try {
                    var state = internalGet(sym, this, "next")
                    return call(options.next, state, value)
                } catch (e) {
                    return PromiseReject(e)
                }
            },

            throw: function (value) {
                try {
                    var state = internalGet(sym, this, "throw")
                    return call(options.throw, state, value)
                } catch (e) {
                    return PromiseReject(e)
                }
            },

            return: function (value) {
                try {
                    var state = internalGet(sym, this, "return")
                    return call(options.return, state, value)
                } catch (e) {
                    return PromiseReject(e)
                }
            },
        })

        return function () {
            var result = objectCreate(ChildPrototype)
            createDataPropertyOrThrow(result, sym,
                apply(options.create, void 0, arguments)
            )
            return result
        }
    }

    function internalGet(sym, object, method) {
        if (object != null && typeof object === "object") {
            var result = object[sym]
            if (result != null) return result
        }

        throw new TypeError(
            methodName(method) + " method called on incompatible receiver"
        )
    }

    // Symbols
    function defineSymbol(name) {
        var value = Symbol[name]
        if (typeof name !== "symbol") {
            value = Symbol.for("Symbol." + name)
            defineProperty(Symbol, name, {
                configurable: false,
                enumerable: false,
                writable: false,
                value: value
            })
        }
        return value
    }

    var symbolThen = defineSymbol('then')
    var symbolAsyncThen = defineSymbol('asyncThen')
    var symbolCombine = defineSymbol('combine')
    var symbolAsyncCombine = defineSymbol('asyncCombine')
    var symbolChain = defineSymbol('chain')
    var symbolAsyncChain = defineSymbol('asyncChain')

    // Common utilities
    function toLength(value) {
        value = +value
        var maxSafeInt = 9007199254740991 // 2^53 - 1
        if (value > 0) { // Note: this can't be inverted without missing NaNs.
            return value > maxSafeInt ? maxSafeInt : (value - value % 1)
        } else {
            return 0
        }
    }

    function arraySpeciesCreate(originalArray, length) {
        if (length === 0) length = +0 // 
        do {
            if (!isArray(originalArray)) break
            var C = originalArray.constructor
            if (C !== null && typeof C === "object") {
                C = C[symbolSpecies]
                if (C === null) break
            }
            if (C === void 0 || C === Array) break
            if (typeof C === "function" && "prototype" in C) {
                return new C(length)
            } else {
                throw new TypeError("constructor property is not a constructor")
            }
        } while (false)
        return new Array(length)
    }

    function speciesConstructor(O, defaultConstructor) {
        do {
            var C = O.constructor
            if (C === void 0) break
            if (C !== null && (
                typeof C === "function" || typeof C === "object"
            )) {
                C = C[symbolSpecies]
                if (C == null) break
                if (typeof C === "function" && "prototype" in C) return C
            }
            throw new TypeError("constructor property is not a constructor")
        } while (false)
        return defaultConstructor
    }

    var dataDescriptor = {
        configurable: true,
        enumerable: true,
        writable: true,
        value: void 0
    }

    function createDataPropertyOrThrow(object, property, value) {
        dataDescriptor.value = value
        defineProperty(object, property, dataDescriptor)
        dataDescriptor.value = void 0
    }

    function polyfill(proto, method, value, force) {
        if (!force && typeof proto[method] === "function") return
        defineProperty(proto, method, {
            configurable: true,
            enumerable: false,
            writable: true,
            value: value
        })
        try {
            defineProperty(value, "name", {value: methodName(method)})
        } catch (e) {
            // Swallow exceptions in case it's an ES5 environment
        }
    }

    // {Object,Symbol}.then + builtins
    function syncWrap(f) {
        return function (x) { return f(x) }
    }

    polyfill(Object, "then", function then(x) {
        for (var i = 1; i < arguments.length; i++) {
            x = x[symbolThen](syncWrap(arguments[i]))
        }
        return x
    })

    polyfill(Function.prototype, symbolThen, function then(g) {
        var f = this
        if (typeof f !== "function") {
            throw new TypeError("receiver must be callable!")
        }
        if (typeof g !== "function") {
            throw new TypeError("argument must be a function!")
        }
        return function () {
            return call(g, this, apply(f, this, arguments))
        }
    })

    polyfill(Array.prototype, symbolThen, function then(func) {
        var O = Object(this)
        if (typeof func !== "function") {
            throw new TypeError("callback must be a function!")
        }
        var len = toLength(O.length)
        var result = arraySpeciesCreate(O, len)

        for (var i = 0; i < len; i++) {
            if (i in O) {
                var mappedValue = func(O[i])
                createDataPropertyOrThrow(result, i, mappedValue)
            }
        }

        return result
    })

    polyfill(Promise.prototype, symbolThen, function then(func) {
        if (typeof func !== "function") {
            throw new TypeError("callback must be a function!")
        }
        return this.then(func, void 0)
    })

    function iteratorProxy(nextResult) {
        return {
            done: nextResult.done,
            value: nextResult.value
        }
    }

    var iteratorThenIterator = defineIterator({
        key: '%IteratorPrototype%[Symbol.then] iterator',

        init: function (source, func) {
            return {source: source, func: func}
        },

        next: function (value) {
            var nextResult = this.source.next(value)
            var nextDone = nextResult.done
            var nextValue = nextResult.value
            return {
                done: nextDone,
                value: nextDone ? nextValue : (0, this.func)(nextValue)
            }
        },

        throw: function (value) {
            return iteratorProxy(this.source.throw(value))
        },

        return: function (value) {
            return iteratorProxy(this.source.return(value))
        },
    })

    polyfill(IteratorPrototype, symbolThen, function then(func) {
        var O = Object(this)
        if (typeof func !== "function") {
            throw new TypeError("callback must be callable!")
        }
        return iteratorThenIterator(O, func)
    })

    if (AsyncIteratorPrototype != null) {
        var asyncIteratorThenIterator = defineAsyncIterator({
            key: '%AsyncIteratorPrototype%[Symbol.then] async iterator',

            init: function (source, func) {
                return {source: source, func: func}
            },

            next: function (value) {
                var self = this
                return PromiseThen(
                    PromiseResolve(this.source.next(value)),
                    function (nextResult) {
                        var nextDone = nextResult.done
                        var nextValue = nextResult.value
                        if (nextDone) return {done: nextDone, value: nextValue}
                        return PromiseThen(
                            (0, self.func)(nextValue),
                            function (nextValue) {
                                return {done: nextDone, value: nextValue}
                            }
                        )
                    }
                )
            },

            throw: function (value) {
                return PromiseThen(
                    PromiseResolve(this.source.throw(value)),
                    iteratorProxy
                )
            },

            return: function (value) {
                return PromiseThen(
                    PromiseResolve(this.source.return(value)),
                    iteratorProxy
                )
            }
        })

        polyfill(AsyncIteratorPrototype, symbolThen, function then(func) {
            var O = Object(this)
            if (typeof func !== "function") {
                throw new TypeError("callback must be callable!")
            }
            return asyncIteratorThenIterator(O, func)
        })
    }

    polyfill(Map.prototype, symbolThen, function then(func) {
        checkMap(this)
        if (typeof func !== "function") {
            throw new TypeError("callback must be callable!")
        }
        var C = speciesConstructor(this, Map)
        var map = new C()
        mapForEach(this, function (key, value) {
            var pair = func([key, value])
            map.set(pair[0], pair[1])
        })
        return map
    })

    polyfill(Set.prototype, symbolThen, function then(func) {
        checkSet(this)
        if (typeof func !== "function") {
            throw new TypeError("callback must be callable!")
        }
        var C = speciesConstructor(this, Set)
        var set = new C()
        setForEach(this, function (value) {
            set.add(func(value))
        })
        return set
    })

    defineTypedArrayMethod(symbolThen, function (ctrl) {
        return function then(func) {
            ctrl.validate(this)
            if (typeof func !== "function") {
                throw new TypeError("callback must be callable!")
            }
            var len = ctrl.length(this)
            var A = ctrl.create(this, len, symbolThen)
            for (var i = 0; i < len; i++) A[i] = func(this[i])
            return A
        }
    })

    function asyncWrap(f) {
        return function (x) {
            try {
                return PromiseResolve(f(x))
            } catch (e) {
                return PromiseReject(e)
            }
        }
    }

    polyfill(Object, "asyncThen", function asyncThen(x) {
        for (var i = 1; i < arguments.length; i++) {
            x = x[symbolAsyncThen](asyncWrap(arguments[i]))
        }
        return x
    })

    polyfill(Function.prototype, symbolAsyncThen, function asyncThen(g) {
        var f = this
        if (typeof f !== "function") {
            throw new TypeError("receiver must be callable!")
        }
        if (typeof g !== "function") {
            throw new TypeError("argument must be a function!")
        }
        return function () {
            try {
                var self = this
                return PromiseThen(
                    PromiseResolve(apply(f, self, arguments)),
                    function (value) { return call(g, this, value) }
                )
            } catch (e) {
                return PromiseReject(e)
            }
        }
    })

    // This is specifically written to 1. avoid memory leaks, and 2. avoid
    // parallelism (so it doesn't become a memory hog real quick).
    polyfill(Array.prototype, symbolAsyncThen, function asyncThen(func) {
        try {
            var O = Object(this)
            if (typeof func !== "function") {
                throw new TypeError("callback must be a function!")
            }
            
            var len = toLength(O.length)
            var result = arraySpeciesCreate(O, len)
            var target = 0

            while (target !== len) {
                if (target in O) {
                    return PromiseThen(
                        PromiseResolve(func(O[target])),
                        next
                    )
                } else {
                    target++
                }
            }

            return PromiseResolve(result)
        } catch (e) {
            return PromiseReject(e)
        }

        function next(value) {
            createDataPropertyOrThrow(result, target++, value)

            while (target !== len) {
                if (target in O) {
                    return PromiseThen(
                        PromiseResolve(func(O[target])),
                        next
                    )
                } else {
                    target++
                }
            }

            return result
        }
    })

    polyfill(
        Promise.prototype, symbolAsyncThen,
        Promise.prototype[symbolThen]
    )

    var iteratorAsyncThenIterator = defineAsyncIterator({
        key: '%IteratorPrototype%[Symbol.asyncThen] async iterator',

        init: function (source, func) {
            return {source: souce, func: func}
        },

        next: function next(value) {
            var nextResult = this.source.next(value)
            var nextDone = nextResult.done
            var nextValue = nextResult.value
            if (nextDone) {
                return PromiseResolve({done: nextDone, value: nextValue})
            } else {
                return PromiseThen(
                    PromiseResolve((0, this.func)(nextValue)),
                    function (nextValue) {
                        return {done: nextDone, value: nextValue}
                    }
                )
            }
        },

        throw: function (value) {
            return PromiseResolve(iteratorProxy(this.source.throw(value)))
        },

        return: function (value) {
            return PromiseResolve(iteratorProxy(this.source.return(value)))
        }
    })

    polyfill(IteratorPrototype, symbolAsyncThen, function then(func) {
        var O = Object(this)
        if (typeof func !== "function") {
            throw new TypeError("callback must be callable!")
        }
        return iteratorAsyncThenIterator(O, func)
    })

    if (AsyncIteratorPrototype != null) {
        polyfill(
            AsyncIteratorPrototype, symbolAsyncThen,
            AsyncIteratorPrototype[symbolThen]
        )
    }

    polyfill(Map.prototype, symbolAsyncThen, function (func) {
        try {
            checkMap(this)
            if (typeof func !== "function") {
                throw new TypeError("callback must be callable!")
            }
            var C = speciesConstructor(this, Map)
            var target = new C()
            var iter = mapEntries(this)
            var nextResult = mapEntriesNext(iter)
            if (nextResult.done) return PromiseResolve(target)
            return PromiseThen(
                PromiseResolve(func(nextResult.value)),
                iterate
            )
        } catch (e) {
            return PromiseReject(e)
        }
        function iterate(pair) {
            target.set(pair[0], pair[1])
            var nextResult = mapEntriesNext(iter)
            if (nextResult.done) return target
            return PromiseThen(
                PromiseResolve(func(nextResult.value)),
                iterate
            )
        }
    })

    polyfill(Set.prototype, symbolAsyncThen, function (func) {
        try {
            checkSet(this)
            if (typeof func !== "function") {
                throw new TypeError("callback must be callable!")
            }
            var C = speciesConstructor(this, Set)
            var target = new C()
            var iter = setEntries(this)
            var nextResult = setEntriesNext(iter)
            if (nextResult.done) return PromiseResolve(target)
            return PromiseThen(
                PromiseResolve(func(nextResult.value)),
                iterate
            )
        } catch (e) {
            return PromiseReject(e)
        }
        function iterate(value) {
            target.add(value)
            var nextResult = setEntriesNext(iter)
            if (nextResult.done) return target
            return PromiseThen(
                PromiseResolve(func(nextResult.value)),
                iterate
            )
        }
    })

    // This is specifically written to 1. avoid memory leaks, and 2. avoid
    // parallelism (so it doesn't become a memory hog real quick).
    defineTypedArrayMethod(symbolThen, function (ctrl) {
        return function (func) {
            try {
                ctrl.validate(this)
                if (typeof func !== "function") {
                    throw new TypeError("callback must be callable!")
                }
                
                var len = ctrl.length(this)
                var A = ctrl.create(this, len, symbolThen)
                var target = 0

                if (len === 0) return PromiseResolve(A)
                return PromiseThen(
                    PromiseResolve(func(O[0])),
                    next
                )
            } catch (e) {
                return PromiseReject(e)
            }

            function next(value) {
                A[target++] = value
                if (target === len) return A
                return PromiseThen(
                    PromiseResolve(func(O[target])),
                    next
                )
            }
        }
    })
})(
    typeof window !== "undefined" ? window :
    typeof self !== "undefined" ? self :
    typeof global !== "undefined" ? global :
    typeof this !== "undefined" ? this :
    (0, eval)("this")
);
