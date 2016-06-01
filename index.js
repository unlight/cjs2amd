var fs = require("fs");
var path = require("path");
var resolve = require("resolve-module");
var mkdirp = require("mkdirp");
var ansicolors = require("ansicolors");
var unixify = require("unixify");
var readPkgUp = require('read-pkg-up');

function unique(array) {
	return array.filter(function (value, index, array) {
		return array.indexOf(value) === index;
	});
}

function merge(/* objs... */) {
	var res = {};
	for (var i = 0; i < arguments.length; i++) {
		var o = arguments[i];
		for (var key in o) {
			res[key] = o[key];
		}
	}
	return res;
}

function matchAllCapture(regexp, str) {
	var matches = [];
	var match = regexp.exec(str);
	while (match) {
		matches.push(match[1]);
		match = regexp.exec(str);
	}
	return matches;
}

function extractRequires(inputData) {
	return unique(matchAllCapture(/require\(['"]([^'"]+)['"]\)/g, inputData));
}

function pathToLowerCamelCase(p) {
	return p.split(/[^A-Za-z0-9]/).reduce(function (name, token, index) {
		if (index == 0) {
			name += token;
		} else {
			name += token[0].toUpperCase() + token.slice(1);
		}
		return name;
	}, "");
}

function getDependencies(options) {
	var inputData = options.inputData;
	if (!inputData) {
		inputData = fs.readFileSync(options.input, "utf8");
	}
	var modulePaths = extractRequires(inputData);

	var resolvedModulePaths = modulePaths.map(function (m) {
		try {
			var resolvedModule = resolve(path.resolve(options.input), m);
		} catch (err) {
			throw "Error: Can't resolve module \"" + m + "\" from \"" + options.input + '"';
		}
		var result = path.relative(options.root, resolvedModule);
		result = unixify(result);
		return result;
	});
	
	var requireModuleNames = resolvedModulePaths.map(function (r) {
		return r
			.replace(/\.js$/, "") // remove .js extention
			.replace(/^(\..\/)+/, ""); // remove ../ before node_modules
	});
	

	var moduleNames = requireModuleNames.reduce(function (acc, r) {
		// decide name for module variable, from short to long ones
		var shortNameWithPostfix = pathToLowerCamelCase(path.basename(r)) + "Module";
		if (acc.indexOf(shortNameWithPostfix) === -1 && inputData.indexOf(shortNameWithPostfix) === -1) {
			acc.push(shortNameWithPostfix);
			return acc;
		}
		var fullName = pathToLowerCamelCase(r);
		if (acc.indexOf(fullName) === -1 && inputData.indexOf(fullName) === -1) {
			acc.push(fullName);
			return acc;
		}
		var count = 1;
		while (++count) {
			var fullNameWithPostfix = fullName + count;
			if (acc.indexOf(fullNameWithPostfix) === -1 && inputData.indexOf(fullNameWithPostfix) === -1) {
				acc.push(fullNameWithPostfix);
				return acc;
			}
		}
	}, []);

	return modulePaths.map(function (originalPath, index) {
		return {
			originalPath: originalPath,
			requireName: requireModuleNames[index],
			jsName: moduleNames[index],
			resolvedPath: resolvedModulePaths[index]
		};
	});
}

function inputPathToRequireName(input, root) {
	var resolvedInputPath = path.relative(root, input);
	var result = resolvedInputPath
		.replace(/\.js$/, "")
		.replace(/^(\..\/)+/, "");
	return unixify(result);
}

function convert(options) {
	var inputData = options.inputData;
	if (!inputData) {
		try {
			inputData = fs.readFileSync(options.input, "utf8");
		} catch (err) {
			throw "Error: Can't read input file \"" + options.input + "\". " + err.code;
		}
	}

	var requireInputName = inputPathToRequireName(options.input, options.root);

	if (options.cutNodePath) {
		var realPath = null;
		try {
			realPath = require.resolve(requireInputName);	
		} catch (e) {
		}
		if (realPath) {
			var p = readPkgUp.sync({cwd: realPath});
			var name = p.pkg.name;
			var main = p.pkg.main;
			var lib = unixify(path.join(name, main));
			if (requireInputName === lib || (requireInputName + ".js") === lib) {
				requireInputName = name;
			}
		}
	}

	var dependencies = getDependencies({
		inputData: inputData,
		input: options.input,
		root: options.root
	});

	var modulesListInDefine = "[" + dependencies.map(function (d) { return '"' + d.requireName + '"'; }).join(", ") + "]";

	var modulesListInFunction = dependencies.map(function (d) { return d.jsName; }).join(", ");

	var body = inputData.replace(/require\(['"]([^'"]+)['"]\)/g, function(_, modulePath) {
		var dependency = dependencies.find(function(d) {
			return d.originalPath == modulePath;
		});
		return dependency.jsName;
	});

	var converted = (options.require ? "require(" : 'define("' + (options.name || requireInputName) + '", ')
		+ (dependencies.length ? modulesListInDefine  : "[]") + ", "
		+ "function (" + (dependencies.length ? modulesListInFunction : "") + ") {\n"
		+ "var module = { exports: {} };\n\n"
		+ body + "\n"
		+ ((options.global && options.name) ? 'window["' + options.name + '"] = module.exports;\n' : "")
		+ "return module.exports;\n"
		+ "});";

	if (options.recursive) {
		var res = options._deps || {};
		res[requireInputName] = converted;
		dependencies.forEach(function (d) {
			if (res[d.requireName]) {
				return;
			}
			var dependencyRes = convert({
				input: path.join(options.root, d.resolvedPath),
				root: options.root,
				recursive: true,
				_deps: res,
				cutNodePath: options.cutNodePath,
				_recursiveReally: true
			});
			res = merge(res, dependencyRes);
		});
		if (options._recursiveReally === undefined) {
			if (options.bundle) {
				if (options.noDefineSelf) {
					var key = Object.keys(res)[0];
					res[key] = "";
				}
				res = createBundle(res, options);
			}
		}
		return res;
	} else {
		return converted;
	}
}

function cmd(options) {
	if (!options.input) {
		throw "Error: No input file(first argument, or -i/--input). Abort";
	}

	// Be silent by default if called as function
	if (options.silent === undefined) {
		options.silent = true;
	}

	if (!options.silent) {
		// List dependencies
		if (options.dependencies) {
			if (options.output !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .output(-o/--output) option is ignored with .dependencies(-d/--dependencies)")
			}
			if (options.bundle !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .bundle(-b/--bundle) option is ignored with .dependencies(-d/--dependencies)")
			}
			if (options.stdout !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .stdout(-s/--stdout) option is ignored with .dependencies(-d/--dependencies)")
			}
			if (options.name !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .name(-n/--name) option is ignored with .dependencies(-d/--dependencies)")
			}
			if (options.require !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .require(--require) option is ignored with .dependencies(-d/--dependencies)")
			}
			if (options.recursive !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .recursive(-R/--recursive) option is ignored with .dependencies(-d/--dependencies)")
			}
		// Bundle into single
		} else if (options.bundle) {
			if (options.name !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .name(-n/--name) option is ignored with .bundle(-b/--bundle)")
			}
			if (options.require !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .require(--require) option is ignored with .bundle(-b/--bundle)")
			}
			if (options.recursive !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .recursive(-R/--recursive) option is ignored with .bundle(-b/--bundle)")
			}
		// Convert multiple recursively
		} else if (options.recursive) {
			if (options.stdout !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .stdout(-s/--stdout) option is ignored with .recursive(-R/--recursive)");
			}

		// Convert single
		} else {
			if (options.require && options.name !== undefined) {
				console.error(ansicolors.brightRed("Warning:") + " .name(-n/--name) option is ignored with .require(--require)");
			}
		}

		if (options.output && options.stdout !== undefined) {
			console.error(ansicolors.brightRed("Warning:") + " .stdout(-s/--stdout) option is ignored with .output(-o/--output)");
		}
	}

	if(options.input != null && typeof(options.input) != "string") {
		throw "Error: .input(first argument, or -i/--input) must be a string. Abort";
	}

	if(options.root != null && typeof(options.root) != "string") {
		throw "Error: .root(-r/--root) must be a string. Abort";
	}

	if(options.name != null && typeof(options.name) != "string") {
		throw "Error: .name(-n/--name) must be a string. Abort";
	}

	if(options.global && !options.name) {
		throw "Error: .name(-n/--name) is required with .global(-g/--global). Abort";
	}

	if (!options.root) {
		options.root = process.cwd()
	}

	if (options.bundle) {
		options.recursive = true;
	}

	if (options.dependencies) {
		var dependencies = getDependencies({
			input: options.input,
			root: options.root
		}).forEach(function (d) {
			console.log(d.originalPath + " -> " + d.resolvedPath);
		});;

		return;
	}

	if ((!options.recursive || options.bundle) && !(options.output || options.stdout)) {
		throw "Error: No output file path(-o/--output). Abort";
	}

	if ((options.recursive && !options.bundle) && !options.output) {
		throw "Error: No output dir(-o/--output). Abort";
	}

	var res = convert({
		name: options.name,
		input: options.input,
		root: options.root,
		require: options.require || options.bundle,
		recursive: options.recursive,
		global: options.global,
		cutNodePath: options.cutNodePath
	});

	if (options.recursive) {
		if (options.bundle) {
			var bundle = createBundle(res, options);
			if (options.output) {
				try {
					var dir = path.dirname(options.output);
					mkdirp.sync(dir);
				} catch (err) {
					throw "Error: Can't create dir \"" + dir + "\". " + (err.code || "");
				}

				try {
					fs.writeFileSync(options.output, bundle, "utf8");
				} catch (err) {
					throw "Error: Can't write file \"" + options.output + "\". " + (err.code || "");
				}

				if (!options.silent) {
					console.error("Bundle " + ansicolors.yellow(requireInputName) + " -> " + ansicolors.yellow(options.output));
				}
			} else {
				console.log(bundle);
			}
		} else {
			for (var requireName in res) {
				var outputPath = path.join(options.output, requireName + ".js");
				try {
					var dir = path.dirname(outputPath);
					mkdirp.sync(dir);
				} catch (err) {
					throw "Error: Can't create dir \"" + dir + "\". " + (err.code || "");
				}

				try {
					fs.writeFileSync(outputPath, res[requireName], "utf8");
				} catch (err) {
					throw "Error: Can't write file \"" + outputPath + "\". " + err.code;
				}

				if (!options.silent) {
					console.error("Convert " + ansicolors.yellow(requireName) + " -> " + ansicolors.yellow(outputPath));
				}
			}
		}
	} else {
		if (options.output) {
			try {
				var dir = path.dirname(options.output);
				mkdirp.sync(dir);
			} catch (err) {
				throw "Error: Can't create dir (" + dir + "). " + (err.code || "");
			}

			try {
				fs.writeFileSync(options.output, res, "utf8");
			} catch (err) {
				throw "Error: Can't write file (" + options.output + "). " + (err.code || "");
			}
		} else {
			console.log(res);
		}
	}
}

function createBundle(res, options) {
	var bundle = "";
	if (!options.noRequireShim) {
		try {
			var shimPath = path.resolve(__dirname, "require-shim.js");
			var shim = fs.readFileSync(shimPath, "utf8");
		} catch (err) {
			throw "Error: Can't read reqire shim for bundle \"" + shimPath + "\". " + (err.code || "");
		}
		bundle = shim + "\n";
	}
	var requireInputName = inputPathToRequireName(options.input, options.root);
	for (var requireName in res) {
		if (requireName != requireInputName) {
			bundle += res[requireName] + "\n";
		}
	}
	bundle += res[requireInputName];
	return bundle;
}

module.exports = {
	getDependencies: getDependencies,
	convert: convert,
	cmd: cmd
};
