// Hand-authored wire JSON Schemas (draft 2020-12) for the shapes the schema/
// directory promises. Hand-written deliberately: the wire contract is JSON
// Schema, not serialized Zod. @loupe/spec's emitJsonSchemas re-exports these
// into schema/*.schema.json alongside fabrial.schema.json.
import type { JsonObject } from './json.ts';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export const appDescriptorJsonSchema: JsonObject = {
  $schema: DIALECT,
  $id: 'loupe:app-descriptor',
  title: 'loupe app descriptor (GET /loupe/app)',
  type: 'object',
  required: ['protocol', 'app', 'projections', 'verbs', 'capabilities'],
  additionalProperties: false,
  properties: {
    protocol: { type: 'integer', minimum: 1 },
    app: {
      type: 'object',
      required: ['name', 'version'],
      additionalProperties: false,
      properties: { name: { type: 'string' }, version: { type: 'string' } },
    },
    projections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          params: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    verbs: { type: 'array', items: { $ref: 'loupe:verb-decl' } },
    capabilities: {
      type: 'object',
      required: ['ws'],
      properties: { ws: { type: 'boolean' } },
    },
  },
};

export const verbDeclJsonSchema: JsonObject = {
  $schema: DIALECT,
  $id: 'loupe:verb-decl',
  title: 'loupe verb declaration',
  type: 'object',
  required: ['name', 'params'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    params: {
      $comment: 'A JSON Schema (draft 2020-12) for the verb params object.',
      type: ['object', 'boolean'],
    },
    optimistic: {
      type: 'array',
      items: {
        type: 'object',
        required: ['op', 'path'],
        additionalProperties: false,
        properties: {
          op: { enum: ['add', 'remove', 'replace', 'move', 'copy', 'test'] },
          path: { type: 'string' },
          value: {},
          from: { type: 'string' },
        },
      },
    },
    records: {
      type: 'array',
      items: {
        type: 'object',
        required: ['stream'],
        additionalProperties: false,
        properties: { stream: { type: 'string' } },
      },
    },
  },
};

/** Filename → schema document, for emitJsonSchemas(outDir) to write. */
export function protocolJsonSchemas(): Record<string, JsonObject> {
  return {
    'app-descriptor.schema.json': appDescriptorJsonSchema,
    'verb-decl.schema.json': verbDeclJsonSchema,
  };
}
