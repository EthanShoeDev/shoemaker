// Rows written by each operation on the store, as D1 bills them: one for the
// row and one for each index it changes. An assumption until the real schema
// exists: its test compares them with what local D1 counts (task 2.3), and the
// benchmark already does for its own. Deletes are charged like the inserts they
// undo, because D1's documentation does not say that index rows are free there.
export const rowCosts = {
  // Its row, its key, and the indexes by fingerprint, by time and by trace.
  event: 5,
  // Its row, its key and the index by issue.
  fingerprint: 3,
  // Its row, its key and the index by state.
  issue: 3,
  // Its row, its key and the index of what waits to be sent.
  alert: 3,
  // A regression: its row and the index by state.
  issueReopened: 2,
  issueFirstSeen: 1,
  // Its row and its key when it is new, its row afterwards.
  counted: 2,
  // Its row, and its key on the first write of a day.
  usage: 2,
} as const;

// One occurrence kept in detail, of a known issue. What it may change of the
// issue is charged whether it does or not, since it is decided inside the unit
// that also writes the usage.
export const detailRows =
  rowCosts.event +
  rowCosts.issueReopened +
  rowCosts.issueFirstSeen +
  rowCosts.usage;

// What a new issue adds to it.
export const newIssueRows =
  rowCosts.fingerprint + rowCosts.issue + rowCosts.alert;
