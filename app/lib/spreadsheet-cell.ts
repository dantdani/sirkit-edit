/**
 * [B19-D I5c rows 09, 33] Text for a spreadsheet cell, never a formula — browser-safe.
 *
 * A cell whose text begins (after optional whitespace) with `=`, `+`, `-`, `@`, a tab or a carriage return is evaluated by
 * spreadsheet applications. Such TEXT is prefixed with a single quote. Apply it to text columns only: a numeric column such
 * as a coordinate (`-90.0000`) or a quantity must stay a number.
 */
export function spreadsheetText(value: string): string {
  return /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
