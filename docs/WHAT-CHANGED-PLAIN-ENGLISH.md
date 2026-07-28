# What just got added — in plain English

No jargon, no code. This is what the software can do now that it couldn't do last week,
why each thing was worth building, and what you have to type in before it does anything
useful.

There are **twelve** new things. Read the bold line under each heading if you're in a
hurry.

---

## 1. You can finally delete master data

**Before:** once a supplier, fabric, colour or vendor was added, it was there forever.
Typos, duplicates, a supplier you stopped using in 2023 — all permanent.

**Now:** every master has a **Delete** button.

The interesting part is what happens when you press it on something that's *in use*.
Instead of either refusing flatly or quietly breaking your history, it shows you **exactly
what's in the way**:

> **Supplier Screen Art is in use** — 1 entry references it
> **Trims sourced from them: 1** → *MAIN LABELS HEAT 4XL-48*

…with a **"Deactivate instead"** button right there. Deactivating hides it from every
dropdown but leaves your old purchase orders and challans intact.

**Why this mattered.** Deleting a supplier that's still on old paperwork would have
silently blanked their name off those documents — the POs would still exist but say
"supplier: —". You'd never notice until you went looking. The software now counts every
reference before it lets anything go.

**One real example it caught:** deleting the vendor *Fashion 11* is blocked because
someone has a **login** under that name. Nothing in the database formally connects the two
— the link is just the spelling of the name — so this had to be checked specially.
Otherwise you'd have deleted a vendor and locked a real person out with no clue why.

---

## 2. Fabric is now recorded colour by colour on each lay

**This is the most important change, and it was fixing a quiet mistake.**

**Before:** when you cut a lay, you typed **one** "fabric issued" and **one** "fabric used"
figure for the whole lay. But a lay usually has several colours in it — black, navy,
charcoal. The software split your single number across those colours **by piece count**.

That guess was wrong whenever one colour eats more cloth than another. If navy takes more
metres per piece than black, your stock for both colours was quietly off — and "Extra"
was one lump for the whole lay, so you couldn't see *which* colour over-ran.

**Now:** the cutting grid has three new columns on **every colour row**:

| Colour | S | M | L | **Total** | **Issued** | **Used** | **Balance** |
|---|---|---|---|---|---|---|---|
| BLACK | 10 | 20 | 15 | 45 | 120.0 | 118.5 | 1.5 |
| NAVY | 8 | 12 | 10 | 30 | 82.0 | 85.0 | **−3.0** |

Balance calculates itself and **goes red when negative** — that's over-cutting, and now
you can see the exact colour it happened on.

The lay's overall issued/used figures still show, but they're now just the **sum of the
colour rows** — you don't type them twice.

**Why it matters:** your fabric stock now moves by the number you actually wrote down, not
by a calculation. Fabric is your biggest cost; this is the one place a small error
compounds quietly for months.

**Old lays are untouched.** Anything cut before this keeps working exactly as it did.
Nothing was rewritten or migrated.

---

## 3. Vendor and supplier accounts — what work is worth, and what's still owed

**Before:** the software knew work had happened — pieces cut, dispatched, material
received — but had **no idea what any of it was worth or whether it had been paid.**

**Now:** every vendor and supplier has an **Account** page showing:

> **Billed ₹1,42,000 · Paid ₹90,000 · Outstanding ₹52,000**
> 0–30 days ₹12,000 · 31–60 ₹18,000 · 61–90 ₹9,000 · **90+ ₹13,000**

The important design decision: **the bill is calculated, never typed.**

- **Vendors** are billed on pieces that came *back* (dispatched), not pieces cut. They're
  owed for work actually returned — pieces still on their floor aren't earned yet.
- **Suppliers** are owed the value of material on locked inward challans.

The **only** things you type are payments and advances. Everything else is worked out
from documents you're already creating, so the account can never drift from reality.

**Rates:** the job-work rate sits on **each lay**, not on the job card. That's deliberate —
a card often splits across several vendors, and a card-level rate would bill them all the
same, which would be wrong money.

**Nothing is ever deleted.** Made a mistake? Post the opposite entry. The trail stays.

**Also:** a **Payables** box on the home dashboard showing who's owed most, oldest first,
and a **CSV export for Tally**. This isn't accounting software — Tally still keeps the
books. This tells you the operational position and hands it over cleanly.

**Before it shows anything:** a vendor needs a rate. Set it on their account page.

---

## 4. The software can now speak up

**Before:** every alert it calculated — low stock, delayed deliveries, a card sent to a
vendor — sat on a dashboard nobody keeps open. The software waited to be clicked.

**Now:** there's a **bell** in the sidebar with a red unread count, plus a **daily 8am
summary**:

> Sport Sun — 28 Jul 2026
> Cut 4,200 · dispatched 3,100 · 12 active
> 3 job cards past ETD
> 2 delayed purchase orders
> 7 items at or below reorder level
> ₹18,000 outstanding across 1 party

**Be clear about the limit:** right now these alerts land **inside the app only**. Nothing
goes out by WhatsApp or email yet — that needs a paid WhatsApp Business account or an
email server, and neither is connected.

That's on purpose, not an oversight. It's built so the whole system works with zero
external setup, and connecting a real sender later is a single small change — every alert
already flows through one place.

**Settings → Notifications** lets you switch individual alerts on and off, and add your
phone/email for when a sender does get connected.

---

## 5. Quality inspections that record and warn — but never block

**Before:** quality was a note. You could type a reject count, but nothing categorised the
fault or sent bad pieces anywhere.

**Now:** any job card can be inspected:

> Checked **100** · Pass **90** · Reject **6** · Rework **4**
> Defects: *Fabric hole 6*

16 common defects are pre-loaded under the names a floor actually uses — broken stitch,
skip stitch, print misalign, shade variation, loose thread. You can add your own.

Rejected pieces can be **sent for rework** to a vendor and received back, tracked on its
own document number.

**The key rule: it never stops you shipping.** If you dispatch a card that failed
inspection, or was never inspected, you get:

> *The last inspection passed only partially.*
> **Dispatch anyway?**

Say yes and it ships. The warning is recorded. Software that refuses to let a factory ship
is software a factory stops using — so it warns, and you decide.

**On the reports page:** reject rate by vendor, and a breakdown of *which defects* are
costing you. "Reject 4%" is a number. "Reject 4%, mostly stitching, mostly one vendor" is
something you can act on.

---

## 6. Supplier scorecards

**Before:** the software recorded what you bought but never judged who you bought it from.

**Now:** every supplier is scored automatically from purchase orders you've already
raised — **no new data entry at all**:

- **On-time %** — did the material arrive by the date promised?
- **Average lead time** — order to full delivery
- **Fill rate** — did you get everything you ordered?
- **Price trend** — is the last rate above or below their recent average?

The list page shows a badge (*"87% on time"*) and there's a full scorecard per supplier.

**One subtlety worth knowing.** If a supplier sends 20% on time and the other 80% a month
late, the software counts that as **late** — it scores on the *complete* delivery, not the
first box through the door. The obvious way of measuring would have called that supplier
punctual.

**Also:** on any low-stock alert there's now a **"Draft PO"** button — it pre-fills a
purchase order for the shortfall. It only drafts. You still confirm and send it.

---

## 7. Can I take this order, and when will it ship?

**Before:** entirely reactive. It recorded what a vendor did, never what a vendor *can*
do, so "can I take this job?" was a guess.

**Now:** a **Planning** page. You enter one number per vendor — **pieces per day** — and
it works out the rest:

> **Pebble** — 500 pieces open · 100/day · **5 days to clear** · nearest ETD **3 days**
> ⚠️ **Over-committed**

That vendor cannot finish what they're already holding before their next deadline. You'd
have found that out when they missed it.

**No capacity entered = no projection shown.** It won't invent one. A made-up date is
worse than a blank.

**Before it shows anything:** type a pieces-per-day figure against your vendors, right on
the planning board.

---

## 8. Where the extra fabric went

**Before:** you knew what a job *should* have used and what it *did* use. Nothing put the
two side by side.

**Now**, on each job card (owner only):

> **Standard 90 kg · Actual 170 kg · +80 kg · 53% yield**

And on the reports page, wastage by vendor and by product, so a vendor who consistently
burns more cloth than the standard becomes visible instead of just expensive.

**Careful bits handled:** it never mixes kilograms and metres in one total, and a job
that's been cut but not yet reconciled shows a dash rather than a fake "100% waste".

---

## 9. Samples, before bulk

**Before:** the software only started once a style was approved. But the decisions that
lose money — how many rounds, what it actually costs, whether the price you quoted made
sense — all happen *before* that.

**Now:** samples are proper numbered documents (**SMP-2026-001**) that move through
Requested → In progress → Submitted → **Approved / Rejected**, with a remark recording why
and the ability to start another round.

Each sample can carry:

- A **cost sheet** — fabric, trims, cutting, stitching, finishing, overhead — totalled
  against your target price to show the **margin** *before* you commit (owner only)
- A **measurement table** — every point of measure across every size, with tolerances
- A printable **tech pack** in your letterhead: measurements, trims, notes — the thing you
  actually send a vendor

When a sample is approved, **"Start bulk"** opens a new job card already filled in from
it, so nothing gets re-typed.

---

## 10. Which roll did this come from?

**Before:** when a buyer says *"this batch's shade is off"*, you couldn't trace which
fabric roll or lot that cutting came from.

**Now** you can write a **lot number and shade reference** on inward challan lines, and
the lot on each lay. Then the **Trace** page walks it either direction:

**Forward** — from a job card: which lays, which lots, which challan, which supplier.
**Backward** — type a lot number, see every job card and every shipment that used it.

So a shade complaint becomes: *"that's lot 4471, from this supplier, and it also went into
these two other cards"* — which tells you how far the problem spreads.

**Before it shows anything:** somebody has to start writing lot numbers on challans. Blank
lots behave exactly as today; nothing breaks.

---

## 11. A phone-friendly view for people on the floor

**Before:** the software was built for a desk. The people who actually move the work are
standing at machines with a phone.

**Now** there's **My work**, and it shows different things to different people:

- **A vendor** sees only their own open cards, grouped by stage, with what's expected and
  by when. Big tap targets, one column.
- **The trims keeper** sees challans waiting to be completed and trims below reorder level.
- **Cutting** sees recent lays with fabric issued vs used.

**This also closed a hole.** The home dashboard had no access rules on it, so *every*
login — vendors included — was seeing the full owner dashboard: reorder levels, delayed
purchase orders, the lot. They now land on their own view instead.

---

## 12. It keeps working when the internet doesn't

The factory's connection isn't reliable. When it drops, the software used to be simply
dead.

**Now:** the app installs itself on a phone like an app, and when the connection goes:

- Pages you've already opened still load, with a clear red **"Offline"** bar so nobody
  thinks they're looking at live numbers
- A few high-frequency entries — recording a lay, fabric actuals, an inward receipt, an
  inspection — are **saved on the device** and sent when the connection returns

**The bit that took the most care:** making sure a queued entry sent twice doesn't post
twice. Each one carries a unique ticket; the server remembers tickets it has already
honoured and ignores repeats. Tested by deliberately sending the same entry three times —
it recorded once.

**And if something can't be saved, it is never silently dropped** — it stays with its
error for someone to re-confirm.

**Also added:** a **Status** page showing database size, when the last backup ran (it goes
red past 36 hours), and a written **restore procedure** for whoever has to fix things at a
bad moment.

---

# Things that are on but look empty

Not broken — just waiting for a number.

| Screen | Fills in once… |
|---|---|
| Payables, vendor accounts | a vendor has a **job rate** |
| Planning projections | a vendor has **pieces per day** |
| Fabric yield | the product has an **average consumption** |
| Trace | someone writes a **lot number** on a challan |
| Supplier scorecards | there are **completed purchase orders** to score |

None of these need anything technical. Type the number, the screen fills.

---

# What was deliberately left out

Being straight about the edges:

- **Alerts don't leave the building yet.** In-app only. Real WhatsApp or email needs a
  paid account or a mail server connected.
- **This isn't accounting.** It tracks what's owed to vendors and suppliers and exports to
  Tally. It doesn't do customer invoicing, GST returns or your books.
- **Quality never blocks a dispatch.** It warns and records. That's the design.
- **Off-site backups aren't switched on.** Backups run nightly onto the same machine — the
  ability to copy them elsewhere is built and waiting, just not turned on yet. Worth doing:
  a backup on the same machine survives a mistake, not a dead server.
- **No barcodes or scanners.** Tracing works at the document level.
- **Nobody's existing work changed.** Every screen that worked last week works the same
  way. Everything here is additive — old job cards, old lays, old challans all behave
  exactly as before.
