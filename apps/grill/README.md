# loupe-grill

The app behind the `grill/board` fabrial: a node server on `127.0.0.1:6182`
over one directory (`LOUPE_GRILL_DIR`, default `.grill` under the working
directory, created on start) holding two loupe-owned
streams. An agent grilling a plan asks through `question.ask`; a human answers
on the screen through `question.answer`; the agent polls
`GET /loupe/records/answers.jsonl?after=<seq>` or subscribes to the stream.
Stateless — the files are the state.

```
LOUPE_GRILL_DIR=… pnpm --filter loupe-grill dev
```

| File | Written by | Notes |
|---|---|---|
| `questions.jsonl` | `question.ask`, `question.withdraw` | A withdrawal is a second line under the same id |
| `answers.jsonl` | `question.answer`, `question.retract` | Latest per `question_id` wins (`foldLatest`); a retraction is the undo |

`actors: 'header'`: a loopback dispatch may sign as itself with
`X-Loupe-Actor`, so the agent's questions carry its own name.

```
curl -s -X POST http://127.0.0.1:6182/loupe/verbs/question.ask \
  -H 'content-type: application/json' -H 'X-Loupe-Actor: Fable' \
  -d '{"params":{"id":"q1","round":1,"title":"keep the cache?","body":"The cache …","recommendation":"Keep it.","options":[{"id":"a","label":"drop it"}]}}'
curl -s 'http://127.0.0.1:6182/loupe/records/answers.jsonl?after=0'
```
