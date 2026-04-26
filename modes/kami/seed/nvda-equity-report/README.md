# NVDA Equity Report (CN demo)

Two-page A4 个股研报 — header + metric strip + thesis + price chart +
financials, then a second sheet with revenue breakdown, comp table, risk
grid, and analyst summary box. Layout is the equity-report doc type
introduced upstream in [tw93/kami](https://github.com/tw93/kami) v1.2.0
(MIT), adapted to the paper-canvas runtime.

The candlestick and stacked-bar SVGs are inlined demo charts — the kami
diagram catalog (`_shared/assets/diagrams/`) has full versions you can
copy-paste in for richer visualizations.

Edit copy and tables inside each `<div class="page">…</div>`. The demo's
NVDA numbers are illustrative — replace with your own ticker, financials,
and thesis. Strict constraint: each page must still fit on one A4 sheet
after edits.

This is research-format demo content only — not investment advice.
