# PHASE 3 — is the FMCSA census usable as a source of DSP leads?

**Date:** 2026-08-03 · Investigates **risk 5** in `RESEARCH.md` §7
("real DSP coverage in the FMCSA census unverified") · **Cost:** $0

---

## Short verdict

> **The source is good. The filter we assumed is not.**
>
> The census is free, legal, queryable by API and covers the whole universe of
> carriers. But **its fields can't identify an Amazon DSP**. Filtering by fleet
> size and age removes a lot of noise, and what's left is still irrigation,
> excavation and mechanical companies.

This does **not** invalidate the decision in `RESEARCH.md` §8 to swap Google
Maps for the census — Google Places still forbids storing its content. What
changes is that **enrichment stops being an extra and becomes the piece that
does the work**.

---

## The good part: nothing has to be downloaded

The dataset lives on Socrata and accepts **server-side** filters:

```
https://data.transportation.gov/resource/az4n-8mr2.json
  ?$select=count(*)
  &$where=phy_state='NJ' AND status_code='A'
```

It matters on a VPS that already touches swap: **the full file never comes
down**. You ask for counts and specific pages. The fear of a multi-hundred-MB
CSV is gone.

⚠️ A detail that costs half an hour if you don't know it: **`power_units` is
TEXT** in the dataset. A `BETWEEN 10 AND 60` fails with
`query.soql.type-mismatch`. You have to cast:
`(power_units::number) between 10 and 60`.

## The funnel, measured in New Jersey

| Filter | Result |
|---|---|
| All carriers | 130,098 |
| Active (`status_code='A'`) | 49,286 |
| Active + registered since 2018 | 30,337 |
| Active + fleet 10-60 | 2,486 |
| Active + since 2018 + fleet 15-45 | **405** |

From 130,098 to 405 with three conditions. The funnel works.

## The bad part: the 405 aren't DSPs

A real sample from the finest filter:

```
TBI UNLIMITED LLC              BRIDGETON     19
GREENWAY INDUSTRIES OF NJ LLC  FARMINGDALE   15
SEMOLA ENTERPRISES LLC         BERLIN        31
ULTRA FLOW IRRIGATION LLC      BARNEGAT      33
OVER THE EDGE EXCAVATING LLC   RIVERDALE     18
GE MECHANICAL LLC              VINELAND      24
```

Irrigation, excavation, mechanical. Companies with vans, not delivery
companies. The census **has no field that says "Amazon DSP"**, and fleet size
doesn't tell someone delivering parcels apart from someone taking tools to a job
site.

## VERIFIED: the hypothesis holds. The census does NOT work

**2026-08-03, with three real DSPs known to the owner.** This is the result that
closes the question:

| DSP | In the census? |
|---|---|
| **DSP A** | ❌ Doesn't exist. No match anywhere in the country |
| **DSP B** | ⚠️ There's one in New Jersey with **0 units** |
| **DSP C** | ❌ Doesn't exist. The name matches only fireworks and energy companies |

**Two out of three aren't registered.** And the only one that shows up declares
zero vans, so **the 15-45 fleet filter would have dropped it too**. The
130,098 → 405 funnel that seemed to work would have left out all three.

The suspected reason is confirmed: a DSP's vans are under 10,001 lb and **don't
need a USDOT number**. The census doesn't under-represent them: it doesn't
contain them.

### Consequence

**The FMCSA census is ruled out as a source of DSP leads.** Not for legal or
cost reasons — it's still free and public — but because the niche isn't in it.
It works for truck carriers; last-mile DSPs aren't that.

### Where to go next (to be decided with the owner)

The signal that does set a DSP apart from any other company with vans is **that
it hires drivers non-stop**. A DSP lives on driver turnover and posts openings
continuously. That's observable and public.

| Route | For | Against |
|---|---|---|
| **Job postings** (Indeed, ZipRecruiter: "Delivery Associate" + city) | Niche-specific signal, public, and gives name + city + sometimes phone | Each portal's ToS must be reviewed before touching anything |
| **State business registry** (NJ Division of Revenue, NY DOS) | Public, free, official | Doesn't flag the industry: same problem as the census |
| **Amazon Logistics / DSP directory** | The authentic source | Not public |

Recommendation: explore the job-postings route, **with a ToS review before
writing a single line of scraper** — the mistake already avoided with Google
Places.

---

## The original hypothesis (as stated before checking it)

⚠️ **Not a verified fact, the most likely explanation, to be measured:** a DSP
runs Ford Transits and Sprinters, which usually sit **below 10,001 lb gross
weight**. That's exactly the threshold for needing a USDOT number. If most DSPs
don't need to register, **the census doesn't under-represent them by chance: it
doesn't contain them**.

Checking it is cheap and is the first thing for the next session: take 5 known
local DSPs and look for a USDOT number. If they don't have one, the lead source
must be rethought entirely, and it's better to know before building the importer
than after.

## What to do depending on the result

| If the known DSPs… | Then |
|---|---|
| **do** have USDOT | The census works as the universe. Web enrichment (throwaway Playwright) decides whether each candidate is a DSP. Cost: one visit per candidate over ~400, not 130,000 |
| **don't** have USDOT | The census is useless for this niche and another source is needed. Google Places remains ruled out by its storage policy |

**The lead schema doesn't get built until this is answered.** A `lead` with
fields designed for the census is wasted work if the source changes.

## How to reproduce

```bash
B=https://data.transportation.gov/resource/az4n-8mr2.json
curl -s -G "$B" --data-urlencode '$select=count(*)' \
  --data-urlencode "\$where=phy_state='NJ' AND status_code='A' AND (power_units::number) between 15 and 45"
```

---

# NEW SOURCE: dspjobhub.com (2026-08-03)

The owner brings the source the census couldn't provide: **a job board specific
to Amazon DSPs**. It confirms the intuition that what sets a DSP apart is that
**it hires drivers non-stop**.

Acid test passed: **DSP C shows up there**, and it's one of the three the FMCSA
census didn't contain.

## Legal review — BEFORE writing anything

| Check | Result |
|---|---|
| `robots.txt` | General `Allow: /`. Blocks `/jobs?*` (search with parameters), `/admin`, `/login`, `/register`, `/recruitersearch` |
| `/job/...` listings | **NOT blocked** — that's where the data is |
| Terms of service | **Don't exist**: `/terms`, `/terms-of-service`, `/privacy`, `/legal` return 404 |

No ToS forbids anything, and `robots.txt` allows exactly the route that matters.
**Rule that stands:** only `/job/...` listings, never `/jobs?...`, and at a human
pace. If they ever publish terms, they get re-read before continuing.

## ⚠️ The trap: the "right" field lies

The listings carry schema.org **`JobPosting` JSON-LD**, the best possible news:
structured data, no fragile HTML scraping. But:

```json
"hiringOrganization": {"@type":"Organization","name":"Amazon"}
"title": "Delivery Driver (Amazon DSP - Bronx) - Example Logistics NYC"
```

**`hiringOrganization.name` is "Amazon" in every posting.** The DSP's name is
only in the `title`, after the last " - ". Trusting the structured field — the
natural thing with JSON-LD — would give thousands of leads called "Amazon" and a
useless dataset.

**The DSP name is extracted from the `title`, not from `hiringOrganization`.**

## Usable fields

| Field | Example | Use |
|---|---|---|
| `title` | `… - Example Logistics NYC` | **DSP name** (after the last " - ") |
| `jobLocation[].address.addressLocality` | `The Bronx, NY, United States` | city and state |
| `datePosted` | `2026-04-21` | recency = sign it's still operating |
| `jobBenefits` | `$23.75 / hour` | rough size/health |
| `url` | listing | provenance, to be able to re-audit |
| `description` | HTML | sometimes includes the company's website or socials |

⚠️ `validThrough` comes with the year **2126** — a century too far. Useless for
expiring anything; use `datePosted`.

## What it does NOT give, and how it's completed

The listing confirms it: **no phone and no Instagram** on the page (`telephone`
and `instagram` absent from the HTML). Contact is the second step:

- Many DSPs have **Instagram** → search by name
- **Google Maps** has them, but usually **without a direct phone**
- The `description` sometimes includes a website or socials

That turns enrichment into what had already been concluded: the source gives
**name + city**, and the contact is found separately.

## Concrete next step

1. Count how many listings there are for NJ/NY and how many **distinct** DSPs
   remain after deduplicating by name. It's the equivalent of the census count,
   and it decides whether the source has volume or is four repeated companies.
2. Only then, the `lead` schema.

---

## ⚠️ "Amazon DSP" is ambiguous — and it pollutes any search

Discovered on 2026-08-03 while looking at a marketing agency that bids on Google
Ads for the exact keyword `amazon dsp services`.

**They are two unrelated Amazon products:**

| Acronym | What it is | Who uses it |
|---|---|---|
| **DSP = Delivery Service Partner** | Last-mile delivery companies | Our niche |
| **DSP = Demand-Side Platform** | Amazon's programmatic ad platform | Marketing agencies and sellers |

That agency ("Full Service Amazon Marketing Agency", 200+ brands scaled) sells
the second one. It shows up first when you search "amazon dsp services" because
it pays for that keyword.

**Consequence for the lead pipeline:** searching for plain "Amazon DSP" brings ad
agencies mixed with delivery companies, and the mix isn't visible until someone
tries to call. Search terms must disambiguate (*delivery service partner*,
*delivery associate*, *last mile*, *DSP owner*) and exclude the advertising side
(*ads*, *demand-side*, *PPC*, *seller*, *agency*).

This does **not** affect `dspjobhub.com`, which is delivery-specific by
construction. It affects any enrichment through web or Maps search, which is
exactly the step still missing to get the contacts.
