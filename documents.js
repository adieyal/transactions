// The single definition of every saved document: its storage key, the state
// field it holds, the wrapper it is stored in, and its field in a backup
// (null: not backed up). Statements are saved separately as batch_<id>_<n>
// chunks (see backup.js). tests/architecture.test.js checks that boot,
// persistence and backups agree with this list; docs/architecture.md section 3
// and ADR 0003 describe how loading and saving will be derived from it (R2).
export const DOCUMENTS = [
  { key: "workspace", field: "isDemo", wrap: "demo", backup: "demo" },
  { key: "rules", field: "rules", wrap: "text", backup: "rules" },
  { key: "notes", field: "notes", wrap: "map", backup: "notes" },
  { key: "names", field: "names", wrap: "map", backup: "names" },
  { key: "transfers", field: "transferOv", wrap: "map", backup: "transfers" },
  { key: "dismissed", field: "dismissed", wrap: "map", backup: "dismissed" },
  { key: "adapters", field: "adapters", wrap: "items", backup: "adapters" },
  { key: "lenses", field: "lenses", wrap: "items", backup: "lenses" },
  { key: "periods", field: "periods", wrap: "items", backup: "periods" },
  { key: "reports", field: "reports", wrap: "items", backup: "reports" },
  { key: "answers", field: "answers", wrap: "map", backup: "answers" },
  {
    key: "merchantAnswers",
    field: "merchantAnswers",
    wrap: "map",
    backup: "merchantAnswers",
  },
  { key: "view", field: "view", wrap: "self", backup: "view" },
  { key: "chat", field: "turns", wrap: "turns", backup: null },
];

export const BATCH_PREFIX = "batch_";
