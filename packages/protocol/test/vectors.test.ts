// Vector conformance: every vectors/*.json fixture must parse through its wire
// schema and round-trip losslessly. The grill app's live output is parsed
// through the same schemas (apps/grill/test), which keeps the vectors
// and a real server from drifting apart.
import { describe, expect, it } from 'vitest';
import {
  zAppDescriptor,
  zClientFrame,
  zRecordFloor,
  zRecordFrame,
  zProjectionEnvelope,
  zRecordsEnvelope,
  zServerFrame,
  zVerbError,
  zVerbOk,
  zVerbRequest,
  zVerbResult,
  zWrittenRecord,
} from '../src/schemas.ts';
import appDescriptor from '../vectors/app-descriptor.json';
import projectionEnvelope from '../vectors/projection-envelope.json';
import recordsEnvelope from '../vectors/records-envelope.json';
import verbDispatch from '../vectors/verb-dispatch.json';
import wsFrames from '../vectors/ws-frames.json';

describe('vector round-trips', () => {
  it('app-descriptor.json', () => {
    expect(zAppDescriptor.parse(appDescriptor)).toEqual(appDescriptor);
  });

  it('projection-envelope.json', () => {
    expect(zProjectionEnvelope.parse(projectionEnvelope)).toEqual(projectionEnvelope);
  });

  it('verb-dispatch.json: request, ok, error', () => {
    expect(zVerbRequest.parse(verbDispatch.request)).toEqual(verbDispatch.request);
    expect(zVerbOk.parse(verbDispatch.ok)).toEqual(verbDispatch.ok);
    expect(zVerbError.parse(verbDispatch.error)).toEqual(verbDispatch.error);
    expect(zVerbResult.parse(verbDispatch.ok)).toEqual(verbDispatch.ok);
    expect(zVerbResult.parse(verbDispatch.error)).toEqual(verbDispatch.error);
  });

  it('verb-dispatch.json ok record meets the append-record floor', () => {
    const written = verbDispatch.ok.records[0]!;
    expect(typeof written.stream).toBe('string');
    // The floor is a lower bound: at + actor pass through, app payload rides
    // along untouched. Record shapes themselves are the app's business.
    expect(zRecordFloor.parse(written.record)).toEqual(written.record);
  });

  it('ws-frames.json: client and server frame sequences', () => {
    for (const frame of wsFrames.client) {
      expect(zClientFrame.parse(frame)).toEqual(frame);
    }
    for (const frame of wsFrames.server) {
      expect(zServerFrame.parse(frame)).toEqual(frame);
    }
  });

  it('ws-frames.json grew with the stream subscription: a sub by stream and a record frame are in it', () => {
    // A vector file that grew by zero entries passes the round-trip above and
    // proves nothing about the new frames (AC2), so the counts are pinned
    // below the size the file has now, and the two new kinds are named.
    expect(wsFrames.client.length).toBeGreaterThanOrEqual(4);
    expect(wsFrames.server.length).toBeGreaterThanOrEqual(4);
    const streamSubs = wsFrames.client.filter((f) => f.t === 'sub' && 'stream' in f);
    expect(streamSubs.length).toBeGreaterThanOrEqual(1);
    const records = wsFrames.server.filter((f) => f.t === 'record');
    expect(records.length).toBeGreaterThanOrEqual(1);
    for (const frame of records) {
      // What rides in a record frame is a record: the floor applies to it.
      expect(zRecordFloor.parse(frame.record)).toEqual(frame.record);
    }
  });

  it('ws-frames.json: a sub or unsub naming both a projection and a stream is refused', () => {
    // The union of two strict shapes is the whole of the either/or rule; the
    // rejected vectors are the positive control that it refuses something.
    expect(wsFrames.rejected.length).toBeGreaterThanOrEqual(2);
    for (const frame of wsFrames.rejected) {
      expect(zClientFrame.safeParse(frame).success, JSON.stringify(frame)).toBe(false);
    }
  });

  it('the frame inventory is what it is: three server frames, two client frames', () => {
    // The vectors above prove each frame the files carry round-trips; they
    // say nothing about a frame QUIETLY ADDED to a union and never written
    // down. Under PROTOCOL_VERSION 1 the inventory is closed, so it is
    // pinned here: state / patch / record, and sub / unsub.
    expect(zServerFrame.options).toHaveLength(3);
    expect(zServerFrame.options.map((o) => o.shape.t.value)).toEqual(['state', 'patch', 'record']);
    expect(zClientFrame.options).toHaveLength(2);
  });

  it('a record on the wire is an object: `null` belongs to the client, as its re-snapshot signal', () => {
    // zRecordFrame / zRecordsEnvelope must refuse a null record, or an app
    // appending one would be indistinguishable from the ring having
    // overflowed — LoupeClient.records reads `null` as exactly that.
    const frame = wsFrames.server.find((f) => f.t === 'record')!;
    expect(zRecordFrame.safeParse({ ...frame, record: null }).success).toBe(false);
    expect(zRecordFrame.safeParse({ ...frame, record: 'a line' }).success).toBe(false);
    // POSITIVE CONTROL: the object it actually carries is accepted.
    expect(zRecordFrame.safeParse(frame).success).toBe(true);
    const envelope = recordsEnvelope.ok;
    expect(
      zRecordsEnvelope.safeParse({ ...envelope, records: [{ seq: envelope.seq, record: null }] }).success,
    ).toBe(false);
    expect(zWrittenRecord.safeParse({ stream: 'triage.jsonl', record: null }).success).toBe(false);
    expect(zWrittenRecord.safeParse({ stream: 'triage.jsonl', record: { decision: 'kept' } }).success).toBe(true);
  });

  it('records-envelope.json: the poll twin, answering and refusing', () => {
    expect(zRecordsEnvelope.parse(recordsEnvelope.ok)).toEqual(recordsEnvelope.ok);
    expect(zRecordsEnvelope.parse(recordsEnvelope.gone)).toEqual(recordsEnvelope.gone);
    // Every record answered meets the floor, and the head seq is at or past
    // the last record's — the caller's next `after` misses nothing.
    expect(recordsEnvelope.ok.records.length).toBeGreaterThanOrEqual(1);
    for (const { seq, record } of recordsEnvelope.ok.records) {
      expect(zRecordFloor.parse(record)).toEqual(record);
      expect(seq).toBeLessThanOrEqual(recordsEnvelope.ok.seq);
    }
    // The refusal is an empty array that is not silent.
    expect(recordsEnvelope.gone.records).toEqual([]);
    expect(recordsEnvelope.gone.note).toMatch(/oldest is seq \d+/);
  });
});
