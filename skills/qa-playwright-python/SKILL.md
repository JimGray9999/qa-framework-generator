---
name: qa-playwright-python
description: Generate a Python + Playwright + pytest test framework with page objects, a session-scoped base_url fixture, and a Makefile for browser and headed switching.
---

# Playwright + pytest (Python)

Reference implementation. Placeholders: `{{targetUrl}}` is the site under test.

## Files

Generate these files (keep code concise):
1. requirements.txt - just: playwright, pytest, pytest-playwright, pytest-json-report
2. .env file at project root with exactly:
     BROWSER=chromium
     HEADED=false
3. Makefile at project root with these targets (use tab indentation, not spaces):
     Top of file:
       ifneq (,$(wildcard .env))
         include .env
         export
       endif
       BROWSER ?= chromium
       HEADED ?= false
       HEADED_FLAG := $(if $(filter true,$(HEADED)),--headed,)
     Targets:
       .PHONY: test test-chromium test-firefox test-webkit test-headed test-firefox-headed test-webkit-headed
       test: -> pytest --browser=$(BROWSER) $(HEADED_FLAG)
       test-chromium / test-firefox / test-webkit -> pytest --browser=<name> $(HEADED_FLAG)
       test-headed -> pytest --browser=$(BROWSER) --headed
       test-firefox-headed / test-webkit-headed -> pytest --browser=<name> --headed
4. conftest.py - IMPORTANT: use @pytest.fixture(scope="session") for base_url fixture, return "{{targetUrl}}"
5. pages/ - Create 2-3 page object files appropriate for this site
6. tests/ - Create 2 test files with 2 tests each
7. README.md MUST document: editing .env to change defaults, plus "make test-firefox" / "make test-headed" / etc. for one-off overrides, AND direct "pytest --browser=firefox" as a fallback.

## Rules

CRITICAL RULES:
- Use SYNCHRONOUS Playwright API only (from playwright.sync_api import Page)
- Do NOT use async/await anywhere
- Do NOT use @pytest.mark.asyncio
- Test functions should be regular "def" not "async def"
- conftest.py base_url fixture MUST have scope="session"
- Do NOT create a base_page.py, keep it simple
- For is_loaded() methods, use DEFENSIVE checks:
  - Check page.title() contains expected text, OR
  - Check page.url contains expected path, OR
  - Use page.locator().count() > 0 instead of is_visible() for optional elements
- Tests should verify page loads without errors, not specific elements that may change
- When clicking elements, use page.locator("selector").first if multiple matches possible
- Avoid "text=" selectors as they can match hidden screen-reader elements
