// The shared store that components subscribe to (ADR 0009). It holds no
// state of its own: it reads the runtime's state and derived data, and tells
// subscribers when they changed. main.js notifies "refresh" after every
// redraw; the timeline notifies "highlight" when beads light up.
export function createStore(runtime) {
  const subscribers = new Set();
  return {
    get state() {
      return runtime.state;
    },
    get derived() {
      return runtime.derived;
    },
    get today() {
      return runtime.today;
    },
    // fn(change), change being "refresh" or "highlight". Returns the
    // function that unsubscribes.
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    notify(change) {
      for (const fn of [...subscribers]) fn(change);
    },
  };
}
