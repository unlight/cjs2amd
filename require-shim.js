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
