# From one release a month to shipping every day

This is a proposal. First what today looks like, then what changes, then why the change earns its cost.

## What today looks like

We ship on the last Thursday evening of the month. Code freezes two days ahead of it, and the whole team is awake until two in the morning.

When something does go wrong, nobody can say which change caused it — ==one release carries well over a hundred changes== — so working it out is mostly guesswork.

## Three things change

- Frequency: once a month → several times a day
- Changes per release: a hundred-odd → one or two
- Rollback: pull the whole build → pull that one change

They are really one change, not three: smaller batches are what make the higher frequency possible, and they are what makes a rollback cheap. **The order cannot be reversed** — raising the frequency without shrinking the batch only moves the two-in-the-morning vigil from monthly to nightly.

There is one pipeline, four stages long:

```graph Pipeline
commit → automated tests → 10% canary → everyone
10% canary: one tenth of users first
```

The canary stage is the new part. It turns "something broke" from an outage for everyone into an outage for ((one tenth)).

## Does it work? Watch one number

We ran it with a single team for half a year, measuring the stretch from noticing a problem to being recovered from it:

```chart Recovery time
x: Jan Feb Mar Apr May Jun  (month)
y: 0 .. 240  ( min)
```

The monthly cadence barely moved across those six months, sitting at a little over three hours:

```chart Recovery time
+ Monthly release: 205 198 212 190 201 196
```

After the switch to daily, with the same team on the same system, the curve falls the whole way down:

```chart Recovery time
+ Daily release: 180 120 74 45 31 24
+ mark Daily release @ Jun : "24 min"
```

Half a year took us from over three hours to twenty-four minutes, and those six months added no incidents at all.

## So what is this proposal asking for

Back to those three lines at the top — only the middle one really changes:

@focus "Changes per release"

Frequency and rollback both fall out of it. So this proposal is not asking for the words "ship more often"; it asks for releases small enough to ship without a meeting.

@circle "without a meeting"

---

> Next week I will take the canary stage on its own and walk through how it is built.
