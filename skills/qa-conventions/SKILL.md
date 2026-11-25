---
name: qa-conventions
description: Cross-language rules for generated QA automation frameworks. Applies to every language-specific qa-playwright-* skill.
---

# QA framework conventions

Shared by all language skills. The generator appends these rules after the language-specific ones.

## Rules

- Use the REAL selectors from the page analysis above
- Defensive checks only: prefer `data-testid`, `aria-label`, or specific CSS selectors over text matching
- Page-loaded checks use title, URL, or an element count greater than zero, never an assumed specific element
- Do NOT assume credentials exist
- Do NOT interact with cookie banners, modals, popups, or promotional overlays; they are unpredictable
- Keep tests SIMPLE: verify the page loads, the title is correct, and key navigation works
- Do not pin package versions unless the language requires it
- Always include a README.md tailored to the language and framework
