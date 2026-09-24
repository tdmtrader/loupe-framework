import { z } from 'zod';

/** Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const zJson: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(zJson), z.record(z.string(), zJson)]),
);

/** A JSON object (string-keyed map of JSON values). */
export const zJsonObject = z.record(z.string(), zJson);
export type JsonObject = { [key: string]: Json };

/**
 * A wire JSON Schema document (draft 2020-12). Verb params are published as
 * plain JSON Schema — not serialized Zod — so a Python or Rust app can
 * implement the port. Validated loosely here; ajv-level validation is the
 * consumer's choice.
 */
export const zJsonSchema = z.union([z.boolean(), z.record(z.string(), zJson)]);
export type JsonSchema = z.infer<typeof zJsonSchema>;
