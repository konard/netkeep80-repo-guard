export function parseDiff(diffText) {
  const files = [];
  let current = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      current = { path: match ? match[1] : "", addedLines: [], deletedLines: [], status: "modified" };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file")) {
      current.status = "added";
    } else if (line.startsWith("deleted file")) {
      current.status = "deleted";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletedLines.push(line.slice(1));
    }
  }

  if (current) files.push(current);
  return files;
}
