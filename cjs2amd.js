var fs = require("fs");
var path = require("path");
var resolve = require("resolve-module");
var mkdirp = require("mkdirp");
var ansicolors = require("ansicolors");

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
		return path.relative(options.root, resolvedModule)
	});

	var requireModuleNames = resolvedModulePaths.map(function (r) {
		return r
			.replace(/\.js$/, "") // remove .js extention
			.replace(/^(\..\/)+/, ""); // remove ../ before node_modules
	});

	var moduleNames = requireModuleNames.map(function (r) {
		// decide name for module variable, from short to long ones
		var shortNameWithPostfix = pathToLowerCamelCase(path.basename(r)) + "Module";

		if (inputData.indexOf(shortNameWithPostfix) == -1) {
			return shortNameWithPostfix;
		}

		var fullName = pathToLowerCamelCase(r);

		if (inputData.indexOf(fullName) == -1) {
			return fullName;
		}

		while (true) {
			var fullNameWithPostfix = fullName + Math.round(Math.random() * 1000);
			if (inputData.indexOf(fullNameWithPostfix) == -1) {
				return fullNameWithPostfix;
			}
		}
	});

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
	return resolvedInputPath
		.replace(/\.js$/, "")
		.replace(/^(\..\/)+/, "");
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
		var res = {};
		res[requireInputName] = converted;
		dependencies.forEach(function (d) {
			var dependencyRes = convert({
				input: path.join(options.root, d.resolvedPath),
				root: options.root,
				recursive: true
			});
			res = merge(res, dependencyRes);
		});
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
		global: options.global
	});

	if (options.recursive) {
		if (options.bundle) {
			try {
				var shimPath = path.resolve(__dirname, "require-shim.js");
				var shim = fs.readFileSync(shimPath, "utf8");
			} catch (err) {
				throw "Error: Can't read reqire shim for bundle \"" + shimPath + "\". " + (err.code || "");
			}

			var requireInputName = inputPathToRequireName(options.input, options.root);
			var bundle = shim + "\n";
			for (var requireName in res) {
				if (requireName != requireInputName) {
					bundle += res[requireName] + "\n";
				}
			}
			bundle += res[requireInputName];

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

if (require.main === module) {
	var commander = require("commander");

	commander
		.option("-d, --dependencies", "Print dependencies")
		.option("-i, --input [path]", "Input file path")
		.option("-o, --output [path]", "Output file path, dir if used with -R/--recursive")
		.option("-r, --root [path]", "Root path in resolving, default to current working dir")
		.option("-n, --name [name]", "Module name in define(), or global export variable")
		.option("-R, --recursive [path]", "Convert file and all it's dependencies")
		.option("-s, --stdout", "Output to STDOUT")
		.option("-b, --bundle", "Bundle all dependencies into single file")
		.option("--require", "Use require() fun in module declaration")
		.option("-g, --global", "Export module.exports as global variable")
		.option("--silent", "Don't log warnings and errors")
		.parse(process.argv);

	// HACK: commander already sets .name
	if (typeof(commander.name) != "string") {
		commander.name = undefined;
	}

	commander.input = commander.input || commander.args[0];

	if (commander.silent === undefined) {
		commander.silent = false;
	}

	try {
		cmd(commander);
	} catch (err) {
		if (!commander.silent) {
			if (typeof(err) == "string") {
				console.error(err.toString().replace(/^.*:/, ansicolors.red));
			} else {
				throw err;
			}
		}
		process.exit(1);
	}
} else {
	module.exports = {
		getDependencies: getDependencies,
		convert: convert,
		cmd: cmd
	};
}
