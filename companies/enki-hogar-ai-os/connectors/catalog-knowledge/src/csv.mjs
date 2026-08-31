export function parseCsv(text, expectedHeaders = null) {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows.at(-1).every((value) => value.trim() === "")) rows.pop();
  if (rows.length < 1) throw new Error("CSV must contain a header row");
  const headers = rows[0].map((value) => value.trim());
  if (headers.some((value) => !value)) throw new Error("CSV headers cannot be empty");
  if (new Set(headers.map((value) => value.toLocaleLowerCase("es"))).size !== headers.length) throw new Error("CSV headers must be unique");
  if (expectedHeaders && headers.join("\u0000") !== expectedHeaders.join("\u0000")) {
    throw new Error(`CSV must use exactly these ordered headers: ${expectedHeaders.join(",")}`);
  }
  return rows.slice(1).filter((values) => values.some((value) => value.trim() !== "")).map((values, rowIndex) => {
    if (values.length > headers.length || (values.length < headers.length && values.some((value) => value.includes("\n")))) {
      throw new Error(`CSV row ${rowIndex + 2} has an unexpected column count`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()]));
  });
}
