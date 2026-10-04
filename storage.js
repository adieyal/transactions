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
// Kept only in this browser, outside the saved documents and backups: the
// assistant settings (which can hold an API key) and one-off flags. The keys
// are the ones the app has always used, so existing settings carry over.
// storage is looked up when used, so this module loads in Node too.
const AI_SETTINGS_KEY = "transactions-demo-ai-settings";
const FLAG_KEYS = { tourSeen: "transactions-tour-seen" };

function browserSettings(storage = () => globalThis.localStorage) {
  return {
    // The assistant settings, or {} when there are none or they can't be read.
    readAI() {
      try {
        return JSON.parse(storage().getItem(AI_SETTINGS_KEY)) || {};
      } catch {
        return {};
      }
    },
    // Throws when the browser won't keep them, so the caller can say so.
    writeAI(value) {
      storage().setItem(AI_SETTINGS_KEY, JSON.stringify(value));
    },
  };
}

function browserFlags(storage = () => globalThis.localStorage) {
  return {
    has(name) {
      try {
        return !!storage().getItem(FLAG_KEYS[name]);
      } catch {
        return false;
      }
    },
    set(name) {
      try {
        storage().setItem(FLAG_KEYS[name], "1");
      } catch {}
    },
  };
}

const settings = browserSettings();
const flags = browserFlags();

export {
  AI_SETTINGS_KEY,
  browserFlags,
  browserSettings,
  dbBackend,
  flags,
  localBackend,
  settings,
};
