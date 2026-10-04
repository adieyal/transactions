// The checked table of module functions (docs/architecture.md section 2,
// ADR 0002). Each module exports a contract naming what it provides and what
// it requires. createRegistry builds every module, gives each one an
// `actions` that refuses names it didn't declare, and refuses to start when
// a provider is missing or doubled, or a module provides other than it says.
//
// contract = { name, create, provides, requires, renders, wires }
// - renders: provided functions every refresh calls, in registration order.
// - wires: provided functions called once at boot, in registration order.

function scoped(table, contract) {
  const allowed = new Set(contract.requires);
  return new Proxy(table, {
    get(target, key) {
      if (typeof key !== "string") return target[key];
      if (!allowed.has(key))
        throw new Error(
          `${contract.name} uses actions.${key} without requiring it`,
        );
      return target[key];
    },
    set(_, key) {
      throw new Error(`${contract.name} can't set actions.${String(key)}`);
    },
  });
}

// own: what main.js provides itself (derive, refresh and the like).
export function createRegistry(runtime, contracts, own = {}) {
  const table = {};
  const owner = {};
  function add(name, provided) {
    for (const [key, value] of Object.entries(provided)) {
      if (owner[key])
        throw new Error(
          `actions.${key} is provided by ${owner[key]} and ${name}`,
        );
      owner[key] = name;
      table[key] = value;
    }
  }
  add("main", own);
  for (const contract of contracts) {
    const made = contract.create(runtime, scoped(table, contract));
    const got = Object.keys(made).sort().join(", ");
    const declared = [...contract.provides].sort().join(", ");
    if (got !== declared)
      throw new Error(
        `${contract.name} provides ${got}, but its contract says ${declared}`,
      );
    add(contract.name, made);
  }
  for (const contract of contracts) {
    for (const key of contract.requires)
      if (!(key in table))
        throw new Error(
          `${contract.name} needs ${key}, which nothing provides`,
        );
    for (const key of [...contract.renders, ...contract.wires])
      if (!contract.provides.includes(key))
        throw new Error(
          `${contract.name} lists ${key}, which it doesn't provide`,
        );
  }
  Object.freeze(table);
  const pick = (field) =>
    contracts.flatMap((c) => c[field].map((key) => table[key]));
  return { actions: table, renders: pick("renders"), wires: pick("wires") };
}
