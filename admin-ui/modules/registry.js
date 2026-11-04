// Late binding for cross-module calls. Modules destructure the functions they
// need from the shared context when they are created, before every module
// exists, so each module lists the names its create() returns in `provides`.
// One forwarder per name is installed up front and pointed at the real
// function once all modules are created; a module whose create() result and
// `provides` disagree fails at startup instead of at the first call.
export function wireModules(context, modules) {
  const implementations = new Map();
  for (const [moduleName, module] of Object.entries(modules))
    for (const name of module.provides) {
      if (name in context)
        throw new Error(`管理模块 ${moduleName} 的 ${name} 与已有名称冲突`);
      context[name] = (...args) => implementations.get(name)(...args);
    }
  const services = {};
  for (const [moduleName, module] of Object.entries(modules)) {
    const created = module.create(context);
    const names = Object.keys(created).sort();
    if (
      names.join() !== [...module.provides].sort().join() ||
      names.some((name) => typeof created[name] !== "function")
    )
      throw new Error(`管理模块 ${moduleName} 的 provides 与实现不一致`);
    for (const name of names) implementations.set(name, created[name]);
    services[moduleName] = created;
  }
  return services;
}
