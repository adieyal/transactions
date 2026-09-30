function localBackend(storage, onError) {
  const P = "transactions-demo:";
  return {
    kind: "local",
    async all() {
      const out = {};
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k.startsWith(P))
            out[k.slice(P.length)] = JSON.parse(storage.getItem(k));
        }
      } catch {}
      return out;
    },
    async put(k, v, { retry = true } = {}) {
      try {
        storage.setItem(P + k, JSON.stringify(v));
      } catch (error) {
        if (!retry) throw error;
        onError("This browser wouldn't save that. Download a copy from More.");
      }
    },
    async del(k, { retry = true } = {}) {
      try {
        storage.removeItem(P + k);
      } catch (error) {
        if (!retry) throw error;
      }
    },
  };
}

function dbBackend(db, uid, onError) {
  const col = db.collection(
    "data/users/" + uid + "/transactions-demo/documents",
  );
  const chains = {};
  const run = (k, f, { retry = true } = {}) =>
    (chains[k] = (chains[k] ? chains[k].catch(() => {}) : Promise.resolve())
      .then(f)
      .catch((e) => {
        if (!retry) throw e;
        if (e?.code === "quota_exceeded")
          onError(
            "Your storage is full. Remove an old statement to make room.",
          );
        else if (e?.code === "unavailable")
          setTimeout(
            () =>
              f().catch(() =>
                onError(
                  "Couldn't save just now. Your last change may not be kept.",
                ),
              ),
            800 + Math.random() * 800,
          );
        else onError("Couldn't save: " + (e?.message || "unknown problem"));
      }));
  return {
    kind: "account",
    async all() {
      const snap = await col.limit(1000).get();
      const out = {};
      for (const d of snap.docs)
        out[d.id] = JSON.parse(JSON.stringify(d.data()));
      return out;
    },
    put: (k, v, options) => run(k, () => col.doc(k).set(v), options),
    del: (k, options) => run(k, () => col.doc(k).delete(), options),
  };
}
export { dbBackend, localBackend };
