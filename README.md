# cjs2amd - Simple CommonJS to AMD converter and bundler

[![Greenkeeper badge](https://badges.greenkeeper.io/unlight/cjs2amd.svg)](https://greenkeeper.io/)

Converts CommonJS modules:

```js
module.exports = {
	c: require("./b/c"),
	f: require("d")
};
```

into AMD modules:

```js
require(["b/c", "node_modules/d/f"], function(cModule, fModule) {
	var module = {
		exports: {}
	};

	module.exports = {
		c: cModule,
		f: fModule
	};

	return module.exports;
})
```

## Install

```
npm install cjs2amd
```

## Command usage

Convert single file:

```
cjs2amd --output <output file> [--require] [--name <module name>] [--stdout] [--root <dir>] <input file>
```

Convert file and all it's dependencies:

```
cjs2amd --recursive --output <output dir> [--root <dir>] <input file>
```

Bundle file and all it's dependencies:

```
cjs2amd --bundle --output <output dir> [--root <dir>] <input file>
```

Print dependencies:

```
cjs2amd --dependencies <input file>
```

Options:

```
-h, --help              output usage information
-d, --dependencies      Print dependencies
-i, --input [path]      Input file path
-o, --output [path]     Output file path, dir if used with -R/--recursive
-r, --root [path]       Root path in resolving, default to current working dir
-n, --name [name]       Module name in define(), or global export variable
-R, --recursive [path]  Convert file and all it's dependencies
-s, --stdout            Output to STDOUT
-b, --bundle            Bundle all dependencies into single file
--require               Use require() fun in module declaration
-g, --global            Export module.exports as global variable
--silent                Don't log warnings and errors
```

## Examples

Source tree:

```
src/
  a.js
  b/
    c.js
node_modules/
  d/
    f.js // main file of "d" module
```

Files content:

```js
// src/a.js

module.exports = {
	c: require("./b/c"),
	f: require("d")
};
```

```js
// src/b/c.js

module.exports = "c";
```

```js
// node_modules/d/f.js

module.exports = "f";
```

Convert all

```
cjs2amd --recursive --output lib --root src src/a.js

```

Resulting `lib/` dir:

```
lib/
  a.js
  b/
    c.js
  node_modules/
    d/
      f.js
```

Note! `node_modules` is placed inside `lib`. All dirs under `root` will be placed inside, for example `../../a` become `a`.

Bundle into single file:


```
cjs2amd --bundle --output lib/bundle.js --root src src/a.js

```

Contents of `lib/bundle.js`:

```js
(function () {
	var modules = {};

	var initialized = {};
	window.define = function (name, dependencies, factory) {
		modules[name] = {
			dependencies: dependencies,
			factory: factory
		};
	};

	window.require = function (dependencyNames, factory) {
		var dependencies = [];
		for (var i = 0; i < dependencyNames.length; i++) {
			var name = dependencyNames[i];
			if (!initialized[name]) {
				var module = modules[name];
				require(module.dependencies, function () {
					initialized[name] = module.factory.apply(null, arguments);
				});
			}
			dependencies.push(initialized[name]);
		}
		return factory.apply(null, dependencies);
	};
})();

define("b/c", [], function () {
	var module = { exports: {} };

	module.exports = "c";

	return module.exports;
});

define("node_modules/d/f", [], function () {
	var module = { exports: {} };

	module.exports = "f";

	return module.exports;
});

require(["b/c", "node_modules/d/f"], function (cModule, fModule) {
	var module = { exports: {} };

	module.exports = {
		c: cModule,
		f: fModule
	};

	return module.exports;
});
```

## API

##### .convert({ input, root, name, recursive, require, global })

Convert file or files(when .recursive == true) to AMD.

Single file:

```js
var result = cjs2amd.convert({
	input: "./src/module.js",
	name: "MyModule", // optional, by default "src/module"
	root: "./", // optional, by default current working dir
});

// result will be converted module source

```

File and dependencies:

```js
var result = cjs2amd.convert({
	input: "./src/module.js",
	root: "./", // optional, by default current working dir
	recursive: true
});

// result will be hash { "module name in define": "converted source" }

```

##### .cmd({ input, dependencies, output, root, name, recursive, stdout, bundle, require, global })

The same as command-line tool, but as a function.
