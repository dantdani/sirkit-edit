# Chat consolidation, BOM view, dev config

Date: 2026-06-26 · Status: done (type-checked, lint-clean)

## Chat consolidation
Removed the top "Generate" prompt bar and folded everything into the right chat,
keeping the conversational assistant. The shared input now drives four actions:
**Ask** (conversational `/api/chat`), **Edit** (Tier 1/2 editing), **Generate**
(build/theory), **Review** (Layer-2). Generation errors + electrical-validation
warnings surface in the chat panel.

## BOM view
`app/components/bom/BomView.tsx` — replaces the BOM tab placeholder. Walks
`components` + `kicadComponents`, groups by partId+value (KiCad) / type+value
(theory), shows refDes / description / value / MPN / footprint / manufacturer /
qty / datasheet link, with Copy CSV. Price/stock intentionally omitted (needs a
distributor integration). Theory parts show "—" for catalog fields (idealized).

## Dev config
`next.config.ts` — added `allowedDevOrigins: ["172.20.20.20"]` to silence the
cross-origin dev-resource warnings when hitting the dev server from the LAN.

## Files
`app/page.tsx`, `app/components/bom/BomView.tsx`, `next.config.ts`
