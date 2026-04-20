export function uniqueSorted(values = []) {
  return [...new Set(values)].sort();
}

export function formatList(values) {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}
