(function(global) {

	var modules = {};
	var initialized = {};

	global.define = define;
	global.require = require;

	define("require", [], function() {
		return require;
	});

	function define(name, dependencies, factory) {
		modules[name] = {
			name: name,
			dependencies: dependencies,
			factory: factory
		};
	}

	function require(dependencyNames, factory) {
		var dependencies = [];
		for (var i = 0; i < dependencyNames.length; i++) {
			var name = dependencyNames[i];
			if (name === "exports") {
				dependencies.push({});
				continue;
			} else if (!initialized[name]) {
				var module = modules[name];
				var exportsIndex = module.dependencies.indexOf("exports");
				require(module.dependencies, function() {
					var result = module.factory.apply(null, arguments);
					if (exportsIndex !== -1) {
						result = arguments[exportsIndex];
					}
					initialized[name] = result;
				});
			}
			dependencies.push(initialized[name]);
		}
		return factory.apply(null, dependencies);
	}

})(window);