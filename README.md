# Audit report — Jing v6-3 deploy set (`muqchqnaa54e769598a4`)

**Pinned tree:** `jing-contracts-v3` @ `df091b8` · `juicestx` @ `60ac298` · `fastpool-pox-5` @ `3e9262d` · `citycoins-protocol` @ `1688dec`

**Headline: no contract defect found in this pass.** Everything below is either a
verified negative (reproduce it and you get the same numbers) or one correction to
`contracts/README-deploy-set-test-status.md`, with the test that pins it.

The brief says a no-findings report is not paid, so treat this as a verification
record, not a claim on the reward.

---

## 1. What was run

| Check | Command | Result |
|---|---|---|
| Router suite at the pin | `npx vitest run --config vitest.router-v5-3.config.ts` | **185/185 pass, 4 files** |
| Real-core refund regressions | `node tests/rv/v6-3/runtime.test.mjs` | **`# pass 2`, `# fail 0`** |
| RV invariant campaign (200 runs) | `node tests/rv/v6-3/run-seeded.mjs invariant 200 230927` | **200 PASS / 0 FAIL / 0 WARN** |
| Rung epoch-close tests (clean tree) | `npx vitest run --config vitest.integration-v6-3.config.ts tests/unit/integration-v6-3/withdraw-dust.test.ts tests/unit/integration-v6-3/sell-epoch-close.test.ts` | **10/10 pass** (7 buy + 3 sell) |
| Negative control: `d8b01e4` reverted on the buy side | same command, patch applied | **1 failed \| 6 passed** — see §4.2 |

RV monitor tail from the invariant run:

```
RV-MONITOR {"publicCalls":1871,"invariantChecks":1872,"getterCrossChecks":1,
"pendingRefunds":{"cancel":3},"refundEvents":{"x":2,"y":3}}
```

The long historical RV campaigns (`npm run rv:v6-3`: 1000 + 5000 + 3000 runs) were
**not** rerun here — each run is minutes of simnet and the budget for one pass was
spent on targeted reading. Your status page already flags them as not rerun for this
market hash; that claim is unchanged by this report.

---

## 2. Verified negative: the buy/sell rung mirror is exact

`jing-buy-stx-core-spread-v1.clar` and `jing-sell-stx-core-spread-v1.clar` are the two
copies of the in-scope rung (item 2). If any of the four in-scope fixes had landed on
one side only, this is where it would show.

Method: strip `;;` comments, blank lines and leading whitespace from both files, then
`diff`. Every remaining hunk is one of:

* `buy`↔`sell` / `SBTC`↔`WSTX` / `sats`↔`ustx` identifier and unit renaming,
* `floor`↔`cap` (the side-appropriate clamp),
* event markers `x`↔`y`,
* `SOLD_OUT_DUST u10` (buy) vs `u10000` (sell) and `MIN_DEPOSIT u100` vs `u100000`.

The two constants are the documented conversions (10,000 µSTX covers STX up to 100
sats). **No structural asymmetry, no fix present on one side only.** Re-run:

```sh
python3 - <<'PY'
import re,difflib
def clean(p):
    out=[]
    for line in open(p):
        s=line.split(';;')[0].rstrip()
        if s.strip(): out.append(' '.join(s.split()))
    return out
a=clean('contracts/jing-buy-stx-core-spread-v1.clar')
b=clean('contracts/jing-sell-stx-core-spread-v1.clar')
print('\n'.join(difflib.unified_diff(a,b,lineterm='',n=0)))
PY
```

---

## 3. Verified negative: the vault allowance is sized per path (item 5)

The brief asserts `amount + min-x + u51` "holds on the router path". I swept **every**
`sBTC` allowance site in the two vaults that have them (`juice-sbtc-autoswap.clar`,
`fastpool-swap-vault.clar` — byte-identical pattern) against what each path can
actually pull:

| Entry point | Allowance | What the path pulls | Verdict |
|---|---|---|---|
| `router-swap` | `amount + min-token-x + u51` | smart-swap re-routes the book's leftover (`token-*-rolled` + `rebate-refunded`) to the next venue, so it pulls that back out of the wallet | **u51 required — present** |
| `router-swap-split` | `amount + min-token-x` | calls `swap-sbtc-for-stx … fallback none`, and `with-fallback(x, v, none, r)` returns `x`, leaving the residual in the wallet; `amount = jing + dlmm + xyk + velar`, so total pull = `amount` | u51 not required; the extra `min-x` is slack |
| `router-swap-split-dia` | `amount` | `jing-amount u0` → `jing-swap` never runs (`none`), market never called, no residual | exact |
| `jing-take` | `amount` | direct `JING_MARKET swap`, no re-sell leg | exact |
| `jing-place` | `amount` | `deposit-token-x` for `amount` | exact |

So the 51-sat constant sits only on the one path that needs it, and the two split
entry points cannot pull more than they allow (the `fallback` argument is hardcoded
`none` by the vault, not caller-supplied — that is the load-bearing detail).

Same sweep, same result, in `fastpool-swap-vault.clar` (allowance lines 401-402 and
457 mirror juice lines 395-396 and 451).

Not covered: the **stxer mainnet-fork** allowance proof (`simulations/vault-allowance-proof-stxer.mjs`)
needs `PYTH_API_KEY` + a Stacks node and was not rerun here. The code-level bound above
is the substitute, and it is an argument from the contracts rather than from a fork run.

---

## 4. Correction + shipped test: the sell-side epoch-close case *is* reachable

`contracts/README-deploy-set-test-status.md` (negative-controls paragraph) says:

> Negative controls (each fix reverted on a local copy): … the buy-side inlined epoch
> close `d8b01e4` all make their tests fail. **The sell-side epoch-close case cannot be
> reached through public calls.**

### 4.1 The close itself is reachable on the sell side

`tests/unit/integration-v6-3/sell-epoch-close.test.ts` (added by this report) drives
the sell rung through three public sequences and asserts the full post-close state:

```
sell withdraw: reachability of close-epoch proceeds > held / live / admitted:
  public final withdrawal pays existing proceeds once, then closes the epoch
 Test Files  1 passed (1)      Tests  3 passed (3)
```

Each case: `set-push-paused`/`addOppositeMaker` → `deposit(1000000 µSTX)` → mint
1001 sats of proceeds to the rung principal → `withdraw(1000000, update)` →
`{stx: 1000000, sbtc: 1001}`, member STX balance `+1000000`, exactly one
`rung-payout`, `rung-epoch-closed` emitted, and afterwards

```
members 0, epoch 1, current-proceeds 0, sats-accounted 0, proceeds-carry 0,
rung STX balance 0, rung sBTC balance 0
```

So "cannot be reached through public calls" is not true of the close event as written.

### 4.2 But the *discriminating* case really is unreachable on sell — and here is why

The negative control for `d8b01e4` is not reachability, it is **stray proceeds sitting
in the rung at the moment the epoch closes**:

* Reverting `d8b01e4` on the **buy** side makes exactly one test fail —

```
FAIL  tests/unit/integration-v6-3/withdraw-dust.test.ts
      > production oracle fee sent to rung: retained for the next epoch
AssertionError: expected { sbtc: 10000n, stx: 1008n } to deeply equal { sbtc: 10000n, stx: 1001n }
1 failed | 6 passed (7)
```

  i.e. the old `close-epoch` paid the extra 7 sats to the departing member, the new
  code retains them (`current-proceeds = 7`, `stx-accounted = 7`) for the next epoch.

* The same revert applied to the **sell** side leaves `sell-epoch-close.test.ts`
  green (3/3) — old and new are observationally identical there.

The mechanism: the only source of *proceeds-token* balance that arrives **after**
`settle-proceeds` and **before** the close is the oracle fee paid to the rung during
the withdrawal's own `escrow-for` → `settle-escrow` round. That fee is denominated in
**STX**. On the buy rung STX *is* the proceeds token, so it lands in
`current-proceeds` and the two versions diverge. On the sell rung STX is the
**resting** asset: it lands in `held-ustx`, is folded into `take = market-size +
held-ustx`, and both versions hand it to the departing member identically. Nothing in
a sell-side `withdraw` can deliver sBTC mid-transaction (`settle-token-y-deposit`
either admits or refunds in STX; the market's rebate goes to takers, not to the
settling maker), so `current-proceeds` is always `0` at close and the old/new code
cannot differ.

**So the sentence should read:** the sell-side epoch close is reachable (test shipped
above); what is unreachable is the *stray-proceeds-at-close* condition that makes the
negative control bite. That also means the sell-side copy of `d8b01e4` has no
regression guard — the shipped test pins reachability and post-close state, which is
the coverage your status page says is missing.

---

## 5. Read but not filed (with reasons)

So this is not mistaken for an incomplete sweep — these are the leads I followed to a
dead end, each with the reason:

* **`d8b01e4` inline close, `epoch-final-unfilled` not written for the closed epoch.**
  Dead end: `final-unfilled`/`final-proceeds` are only read for a *non-current*
  position (`settle-proceeds`, `get-position`), and the inline close only fires when
  `members` hits `0`, which means every position of that epoch was deleted in that
  same call. No reader exists for the missing entry.
* **Carried `current-proceeds` across the close (the retained oracle fee).** Dead end:
  `stx-accounted` is carried with it, so the next epoch's first `sync` computes
  `gained = balance − stx-accounted = 0` (no double count), and the balance is paid in
  full to whichever member is `members == 1` at settle time (or, if the next epoch
  dies to `roll-tail`, to the last `epoch-reserve` claimant). It is never stranded.
* **Band-seat replacement via `register` at a taken spread** (item 4). Dead end:
  every entry point (`initialize` → `register`/`register-unseated`, `seat-band`,
  `retire-band`, `set-canonical`, `set-max-band-per-side`) asserts
  `tx-sender == LADDER.get-owner` first, so seat takeover is owner-gated, not
  permissionless. `claim-seat` correctly does not change `band-count` on replacement.
* **Admission / `protected-seats` bound coupling** (market `refresh-seat-count` clamps
  at `MAX_DEPOSITORS` while `set-seats-per-side` asserts `n ≤ 10`). Dead end: both
  setters are owner-gated and `set-max-band-per-side` documents its own `< 50`
  ceiling; the hard `(len depositors) ≥ MAX_DEPOSITORS` check still caps the book at
  50 either way.
* **`dlmm-pick` / pool selection** (item 1, `df091b8`). Not filed: already covered by
  two existing submissions on this bounty, and your `origin/master` has since landed
  `1063add`, `280c81c`, `c2b046a`, `2373cec` on top of it. Filing it again would be
  duplicate noise.

---

## 6. Reproducing this report

```sh
git clone https://github.com/Rapha-btc/jing-contracts-v3 && cd jing-contracts-v3
git checkout df091b8
npm ci --no-audit --no-fund
npx vitest run --config vitest.router-v5-3.config.ts          # 185/185
node tests/rv/v6-3/runtime.test.mjs                           # pass 2 / fail 0
python3 tests/rv/v6-3/build.py && \
node tests/rv/v6-3/run-seeded.mjs invariant 200 230927         # 200 PASS, 0 FAIL
git apply -R <(git diff d8b01e4^ d8b01e4 -- contracts/jing-buy-stx-core-spread-v1.clar)
npx vitest run --config vitest.integration-v6-3.config.ts \
  tests/unit/integration-v6-3/withdraw-dust.test.ts            # 1 failed (the negative control)
```

The added test is `tests/unit/integration-v6-3/sell-epoch-close.test.ts`, included by
`vitest.integration-v6-3.config.ts`'s existing `tests/unit/integration-v6-3/**/*.test.ts`
pattern; it uses only the exported `helpers.ts` API (`setup(specs[1])`, `call`, `ok`,
`balance`) and adds no dependency.
