# Guided-tour copy bank

Explanatory copy that used to sit in the product UI. It was removed on 2026-07-27 —
the tool is a formal system of record, not a tutorial, and it should not narrate its
own mechanics to the client.

Kept here as raw material for the **guided tour / onboarding walkthrough of the
whitelabel version**, where explaining how the system works is the actual job.

Each entry names where the copy lived, so a tour step can be anchored to that screen.

---

## Job cards

### `/job-cards/new` — cutting layers panel
> The real job card is cut in several **layers** — each its own size mix and fabric maths — and the order total is the sum. Type each lay here; the grand total, per-colour and per-size roll-ups, and each colour's live stock all update as you go, **before** you commit a single metre.

### `/job-cards/new` — fabric panel, empty state
> Pick a product — we'll split fabric per colour and check each colour's live stock.

> Enter cut quantities to see the per-colour fabric requirement.

### `/job-cards/new` — trims shortfall
> Some trims are short — the card still saves and is flagged in Pending Trims.

> No trims — load the preset or add rows.

### `/job-cards/[si]` — trim sheet
> Trims leave stock only when an outward challan is locked. Need more mid-job? Raise another one.

### Job-card list, empty state
> A job card is created when fabric is issued for cutting. Start one to begin tracking cut, stitch and receipt.

> Try clearing the search or switching back to All.

### Job-card list, header
> Every cutting-to-receipt order, linked to its style, vendor and fabric.
> (vendor role) Your cutting-to-receipt orders, linked to style and fabric.

### Edit job card
> Header details only — quantities live on Add split / re-cut

> Merchandiser — who is handling this card.

> Item — made-to-order card, there's no catalogue product.

### Delete job card
> The ledger keeps both the original movements and their reversal. This cannot be undone.

> Reverses the fabric this card issued and removes its layers, lines and draft challan. The ledger keeps both postings.

---

## Cutting layers

### Edit layer
> The colour × size cells aren't edited here — a re-cut is a new lay, and changing quantities after fabric has been issued belongs on the actuals form.

> Stitching vendor — the vendor doing the work on this lay.

> Takes {n} pcs off the card and returns the fabric this lay was issued.

### Fabric actuals
> stock always settles at USED — re-saving the same figures moves nothing

---

## Production orders

### `/production-orders/new` — the two locked rules
> The owner's two locked rules, enforced in software: order **2× the monthly sale**, and **never raise a duplicate** active order for the same article.

### `/production-orders/new` — header + duplicate check
> Target defaults to 2× monthly sale · duplicates are checked before saving

> Pick a product — we check for an existing active order before you commit.

> …already has order {no} in progress. Raising another would double the cut.

### `/production-orders` — header
> Plan production off the catalog — target qty defaults to 2× monthly sale; duplicate active orders are blocked.

---

## Dashboard

### `/` — header
> Live from {n} job cards. "Received" means stitched goods back in the warehouse — market dispatch to dealers is tracked separately in E-manage.

### Vendor progress, empty state
> Vendor progress appears once job cards are cut and issued to a stitching unit.

### Overdue panel, empty state
> Every active job card is still inside its planned ETD.

---

## Board

> Every order on one screen — most overdue first. Cut · dispatched · stitching balance · fabric · ETD · stage.

---

## Dispatch

### `/dispatch` — header
> Log finished garments dispatched from vendors back to the warehouse — size×colour, against the cutting layers. Balances and the dashboard update instantly.

### Layer dispatch
> Sale is colour-less — any size, not clamped to the cut.

### Edit dispatch
> Keeps the DC number — the card balance is recomputed

> Quantity — this event has no size × colour breakup.

> Challan ref — optional, the paper challan this matches.

---

## Materials challans

### `/challans` — header
> Inward from suppliers · outward to vendors — one master inventory ledger

### Challan manager
> Lock posts every line to the master inventory once (subtracts / adds). Drafts touch nothing.

> No job card attached to this challan. Trim / combined challans should name their job card.

### Challan document
> Draft — editable · correct the quantities to what physically arrived, then lock

> Old movements reverse and the new lines post — stock stays exact.

---

## Fabric

### `/fabric-orders` — header
> Procurement pipeline that feeds fabric into colour stock. Receiving an order lands its quantity in that colour's inventory.

### `/inventory` — header
> Live fabric stock — depletes automatically as job cards consume it.

### Fabric detail — ledger caption
> Stock Ledger · every issue against this fabric

### Fabric master — suppliers
> Rate here is what they quote — the master estimate above is separate.

### Fabric order manager, empty state
> Pick a fabric and add colours.

---

## Trims

### `/trims` — header
> One unified trim master across the 7 categories — stock, supplier, rate & specs. Add a trim with ~4 fields; current = latest physical count.

### `/trim-orders` — header
> Procurement pipeline for trims and accessories. Generate a POT, then log the inward challan — locking that challan is what lands the stock.

### Trim detail
> Current is the latest physical count from the store register — opening ± movements may not fully reconcile.

### Trim sheet caption
> Trim Sheet · required (frozen plan) vs issued · issued = locked outward challans · drafts read as pending

### Trim order manager — colour/size lines
> For trims ordered colour- or size-wise. Leave blank for a flat order — the total above then drives the order.

### Trims table footer
> · refine your search to see more · trims/accessories store

### Job trim challan button
> Full BOM quantities, ignoring what has already been issued

### `/pending-trims` — header + empty state
> Trims short of store stock across active job cards — a live arrange/buy list. Cutting is never blocked; this is what to chase.

> No trims short right now — every active card is covered. 🎉

---

## Stock adjustments

> Adjust stock with a reason

> Physical count — rack counted, correct the book figure to what's there.

> Opening stock — first count, also becomes the utilisation baseline.

> Wastage — consumed as wastage, not against a job card.

> Other — anything else, say what in the note.

> Note — optional: who counted, which rack, invoice ref.

> This leaves a negative balance. That's allowed — it means more has gone out than came in.

---

## Finishing (job-work)

### `/finishing` — header
> Print, embroidery, wash and sublimation given out as job-work — its own JW series, per vendor, per layer. A tracking record: it moves no stock.

### Finishing panel
> No finishing given out for this card. Optional — the process flags above still plan it.

> This records the hand-off only. It moves no fabric, no trims and no dispatch balance.

> Usually one lay; a job-work may span several of this card's layers.

> {si} — a JW document per hand-off

> Vendor — who is doing the finishing.

> Bill no — the vendor's bill for this job-work.

> Pieces received now — partial receipts accumulate, log each as it arrives.

> More back than went out. That's allowed and recorded as-is — no clamping.

---

## Catalog / product master

### `/catalog` — header
> The full commercial range, from the product master. Pricing, lifecycle status, and live production at a glance.

### `/catalog/new` — header
> Add a style to the product master. Save first, then add colours, images and BOM on its page.

### Product master form
> Save the product first, then add colours & images on its page.

### Product detail
> BOM by Job Card · actual consumption per card

> This SKU isn't linked to the production workbook and has no BOM or live orders yet.

### BOM editor, empty state
> No BOM lines yet — add the product's trims below.

### Image uploader
> Drag & drop, paste, pick a file(s), or use the camera on phone.

---

## Masters & admin

### `/masters` — header
> One place to manage every reusable dropdown list — add, rename or deactivate. Renaming keeps a stable key, so existing records stay valid.

### Category tree
> Head categories with sub-categories nested under them. Add a head, add subs, rename, re-parent or deactivate.

### Colour master
> Shared colour master (also editable inline from fabric orders).

### Masters tabs
> Units used on fabric & trim (MTR, KG, PCS…).

> The trim master's 7 head categories.

> Optional grouping used on products.

### `/suppliers` — header
> Shared supplier master for fabric orders and every trim category. Add, edit or deactivate — old records keep resolving.

### `/users` — header
> Logins and roles. Deactivate rather than delete — a disabled login keeps its history and can be switched back on.

### `/vendors` — header
> Stitching units — in-house and external — ranked by volume and fill rate.

---

## Reports

### Vendor fabric variance caption
> Vendor Fabric Variance · extra fabric taken beyond assumed (cards with actuals)

### Forecast, empty state
> Add monthly sale on production orders to forecast.

---

## Sourcing panel (fabric & trims)

> Sourcing · rates we've bought this at

> The master rate ({rate}) is an estimate used as the default.
