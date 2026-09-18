import { z } from "zod";

export type PdfRecord = Record<string, unknown>;
const record = z.record(z.string(), z.unknown());

export function extractedRecord(value: unknown): PdfRecord {
  return record.parse(value);
}

/** Never treat a malformed extracted section as an empty replacement. */
export function extractedRows(value: unknown): PdfRecord[] {
  return value == null ? [] : z.array(record).parse(value);
}
