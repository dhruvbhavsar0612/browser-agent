# `@browser-agent/marketplace-contract`

Versioned declarative schemas, TypeScript validators/types, catalog generation, and provider adapter
boundaries for the Browser Agent marketplace.

```bash
pnpm validate:examples
pnpm catalog
```

The official MCP Registry importer is canonical and accepts an injected `fetch`. Smithery and Glama
are optional interfaces only. This package does not install or run MCP servers. See
`../../docs/MARKETPLACE.md` for the extraction layout, security model, publication process, and app
boundary.
