# Test Plan: Leave System E2E using nexauser (cloned from Vishnu Pravin)

## Setup

1. Run [`leave_balances_2026_import.sql`](leave_balances_2026_import.sql) to seed real-employee balances (optional — only needed if you want to also click around as the real Vishnu account).
2. Run [`nexauser_vishnu_test_data.sql`](nexauser_vishnu_test_data.sql) — this wipes nexauser's 2026 leave artifacts and seeds a clean copy of Vishnu's data.
3. Confirm seed: log in as admin → Leave → Balances tab → find nexauser → expect:
   - **AL: 0.5 days** (BF 1 + earned 4 − taken 4.5)
   - **MC: 13 days** (eligible 14 − taken 1)
4. Confirm history: Leave page (as nexauser) → expect 5 approved AL applications (Jan 22, Feb 14–16, Mar 6, Mar 9, Apr 17) and 1 approved MC (Apr 28, post-event).

---

## Test Scenarios

### A. Annual Leave — strict cap behavior

| # | Action | Expected |
|---|---|---|
| A1 | Login as nexauser → Apply Leave → AL → 1 day for next week | ✅ Submission accepted (0.5 + 1 May earn − 0 = 1.5 available, 1 day fits) |
| A2 | Apply Leave → AL → 5 days (mirror of Vishnu's May 4–8) | ❌ **Blocked at submit** with toast `Insufficient leave balance. You have 0.5 days remaining` |
| A3 | Admin opens A1's pending app → Review modal → Approved Days input prefilled with **1.0** | ✅ Full / Half (0.5) / None (0) buttons work; manual edit works |
| A4 | Admin approves A1 with `approvedDays = 0.5` (half) | ✅ Balance drops by 0.5 only (not 1); application shows `approved` with `approvedDays=0.5` |

### B. Medical Leave — pre-event flow

| # | Action | Expected |
|---|---|---|
| B1 | Login as nexauser → Apply Leave → MC → toggle **Planned (before the date)** | ✅ MC certificate uploader appears (was previously hidden when leaveType=ML — bug fixed) |
| B2 | Pick start date 22 May 2026 (future), reason `"Specialist follow-up at SGH"`, no MC cert (optional) | ✅ Submission accepted |
| B3 | Admin → Leave → Applications tab → see B2 with **`Planned`** badge next to MC badge | ✅ Badge visible |
| B4 | Admin approves with `approvedDays = 1` | ✅ MC balance: 13 → 12 |

### C. Medical Leave — post-event flow with negative balance

| # | Action | Expected |
|---|---|---|
| C1 | Login as nexauser → Apply Leave → MC → toggle **Post-event (already happened)** | ✅ Toggle visible |
| C2 | Pick start = 5 May 2026 (past), end = 7 May 2026, total 3 days, reason `"Flu — clinic"`, optionally upload PDF | ✅ Submission accepted **regardless of balance** (no insufficient-balance block, even when MC balance is low) |
| C3 | Admin sees C2 with **`Post-event`** badge | ✅ Badge visible |
| C4 | Admin opens review modal → tries `approvedDays = 5` (more than requested 3) | ✅ Amber warning: `⚠️ Exceeds requested (3) — allowed but unusual`; submit still allowed |
| C5 | Admin sets `approvedDays = 2` (partial), approves | ✅ MC balance: 12 → 10. App marked `approved`. `approvedDays=2` saved on record. |
| C6 | Repeat C2–C5 with a 20-day MC (extreme case) → admin approves all 20 | ✅ MC balance dips deeply negative (e.g., 10 → −10). System does **not** block. |

### D. Negative balance auto-reset (cron)

| # | Action | Expected |
|---|---|---|
| D1 | After C6 has put MC balance to −10, run in psql:<br>`SELECT app_nexahrsoft2.clamp... -- or invoke the storage method via a node REPL` <br>**Easier:** wait until 1st of next month at 00:05 SGT, OR manually bump current MC balance to −5 and trigger the function | ✅ Negative MC clamped to 0; AL behaves the same way after the cron extension |
| D2 | Verify in admin Leave → Balances: nexauser MC balance = 0 (no fresh entitlement added — that's still manual) | ✅ |
| D3 | After A2 was blocked, manually edit nexauser AL balance to −2 via admin → Set Leave Balance → wait for cron | ✅ Cron now also clears AL negatives (extension shipped this turn) |

### E. Announcements carousel (sanity check)

| # | Action | Expected |
|---|---|---|
| E1 | Admin → Tools → Announcements tab → New Announcement → title `"Office closed Vesak Day"`, body `"Friday 22 May 2026"`, Active = on | ✅ Posted |
| E2 | Login as nexauser → dashboard | ✅ Carousel card visible (no longer "Refer & Earn") |
| E3 | Post a 2nd announcement → reload dashboard | ✅ Carousel auto-rotates every 6s; manual prev/next buttons work; dot indicator updates |
| E4 | Admin toggles one off | ✅ Dashboard carousel hides it on next load (or rotates past it) |
| E5 | Admin deletes both | ✅ Dashboard card disappears entirely (returns to original layout) |

---

## Reset between test runs

To wipe and re-seed nexauser, just re-run `nexauser_vishnu_test_data.sql` — it's idempotent (DELETE → INSERT inside a single transaction).

## Pitfalls / known caveats

- The Master Leave Sheet's "taken" column shows mixed sign conventions (some entries positive, some negative). My import takes `abs()` — if the running totals don't match the spreadsheet exactly for one or two employees, that's why.
- `nexauser` must already exist with `username = 'nexauser'`. If it doesn't, the SELECT subqueries return zero rows and INSERTs become no-ops (silent). Verify with the SELECT at the bottom of the SQL file.
- The MC balance of 14 used for nexauser is a **test default**, not from the Excel — the spreadsheet doesn't track MC entitlement, only MC events. Adjust if your real MC policy differs.
- After running the import, the dashboard carousel will only show announcements you've posted — there are no seeded announcements in the SQL.
