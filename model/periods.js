// Commands on periods: create, edit and delete. Each returns a change record
// (model/change.js) without touching state.
import { PALETTE } from "../transactions/constants.js";
import { isDay, need, record } from "./change.js";

const replace = (state, periods, command, extra) =>
  record(
    command,
    [{ field: "periods", value: [state.periods, periods] }],
    extra,
  );

// A new period. id: chosen by the caller, since the model reads no clock.
// Without a colour it takes the next one in the palette.
export function addPeriod(
  state,
  { id, name = "", start, end, story = "", color },
) {
  need(typeof id === "string" && id, "A new period needs an id.");
  need(!state.periods.some((p) => p.id === id), "That period already exists.");
  need(isDay(start) && isDay(end), "A period needs dates, as YYYY-MM-DD.");
  if (end < start) [start, end] = [end, start];
  const p = {
    id,
    name: String(name).trim() || "New period",
    start,
    end,
    story: String(story),
    color: color || PALETTE[(state.periods.length + 3) % PALETTE.length],
  };
  return replace(state, [...state.periods, p], "addPeriod", { id });
}

// Changes a period's name, dates, story or colour.
export function editPeriod(state, { id, ...fields }) {
  const i = state.periods.findIndex((p) => p.id === id);
  need(i >= 0, "There's no such period.");
  const p = { ...state.periods[i] };
  if (fields.name !== undefined) {
    const n = String(fields.name).trim();
    need(n, "A period needs a name.");
    p.name = n;
  }
  for (const k of ["start", "end"])
    if (fields[k] !== undefined) {
      need(isDay(fields[k]), "A period needs dates, as YYYY-MM-DD.");
      p[k] = fields[k];
    }
  if (p.end < p.start) [p.start, p.end] = [p.end, p.start];
  if (fields.story !== undefined) p.story = String(fields.story);
  if (fields.color !== undefined) p.color = fields.color;
  const periods = state.periods.slice();
  periods[i] = p;
  return replace(state, periods, "editPeriod", { id });
}

export function removePeriod(state, { id }) {
  const p = state.periods.find((q) => q.id === id);
  need(p, "There's no such period.");
  return replace(
    state,
    state.periods.filter((q) => q !== p),
    "removePeriod",
    { id, summary: `Removed “${p.name}”.` },
  );
}
