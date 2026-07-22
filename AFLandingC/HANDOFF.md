# Handoff prompt — AffiliateFinder LP Variant C (continue in new session)

Start the new session **with `Michellehavnt/bio-link` as the source repo**, then paste the prompt below.

---

I'm continuing the AffiliateFinder.ai landing page redesign (Variant C). All prior progress is committed — do NOT restart the design. Read these first:

1. `add_repo Michellehavnt/Standard`, then read in that repo:
   - `CLAUDE.md` → section "AffiliateFinder.ai LP Redesign (Variant C) — Key Facts"
   - `AFLandingC/index.html` — the finished Variant C page (branch `claude/affiliatefinder-lp-redesign-6kuvvj` has the latest; check that branch, not main)
   - `AFLandingC/ICP-research.md` — verbatim ICP research from AFbrain sales calls (source of all copy)
   - `AFLandingC/logo.png` — white AF wordmark (CSS-inverted for light sections)
   - `AFPitch/index.html` — product ground truth (600K+ verified publishers, 150+ networks, 30K+ programs, 190+ countries, verified owner emails, platform + API)

2. Key decisions already locked (don't relitigate):
   - Style modeled on kinso.ai: Inter font w/ tight tracking, light warm base + film grain + fine grid, teal `#067280` as single accent, navy `#0c1929` reserved for the dark act-break, near-black glowing-stats section
   - Animations: pinned scrollytelling feature section (scroll swaps text/visual in place), scroll word-color reveal in dark section, floating notification cards, staggered reveals, count-up counter — all vanilla JS, no libraries
   - This is a **C variant** — the live Peace LP in this bio-link repo stays untouched; Variant C is added alongside for testing
   - It's a Meta-ad LP: no login; dual CTA everywhere = "Start free trial" (primary) + "Book a demo" (ghost)
   - No invented features: no newsletters, no automated outreach, no "database" wording (we are not positioned as a database). Platforms shown: Instagram, TikTok, YouTube, Websites. Trust bar: 10X Health, cope, gains, KeepSolid VPN Unlimited (currently CSS/SVG approximations)

3. Do now in this bio-link repo:
   - Find the current Peace LP and how pages are served/routed
   - Extract its original copy as additional product-truth input; improve Variant C copy where the Peace LP reveals better product facts (keep the ICP-research language)
   - Integrate `AFLandingC/` (index.html + logo.png) into this app as the C variant route, without touching the existing LP

4. Open TODOs from the previous session:
   - Replace the social-proof counter placeholder (4,218 — INVENTED number, flagged in HTML comment) with the real brand count (ask Michelle)
   - Wire the CTA hrefs: trial signup URL + Calendly demo link (ask Michelle)
   - Swap trust-bar CSS logos for official logo files when provided
   - Potential testimonials from jayger.media calls exist in ICP-research.md — need Michelle's permission before publishing
   - Michelle shared a kinso screen recording (https://jumpshare.com/share/wDMtF3FSHrPr7pnFYvJ6) — was unreachable from the previous sandbox; check specific animation moments against it if accessible

Connectors: AFbrain = AffiliateFinder call intelligence (enable for the chat if more ICP research is needed); CCbrain = CopeCart deployment, wrong data source for this ICP.
