---
description: Rules for using the Airtable User MCP server tools
globs: ["**/*"]
alwaysApply: true
---

# Airtable MCP Server — Tool Usage Rules

These rules apply whenever you interact with Airtable bases via the MCP tools.

## Server Identity

- **Name**: airtable-user-mcp
- **Version**: 2.1.0
- **Protocol**: Model Context Protocol (stdio, JSON-RPC 2.0)
- **Capabilities**: Schema read, field CRUD, view CRUD, formula validation, extension management
- **Tool Count**: 30 tools across 5 categories

## Mandatory Workflows

### Before Creating a Formula Field
1. Call `list_fields` to verify all referenced field names exist and check their types
2. Call `validate_formula` to check syntax and result type
3. Only then call `create_formula_field` or `create_field`

### Before Updating a Formula Field
1. Call `list_fields` to get the `fieldId`
2. Call `validate_formula` with the new formula text
3. Only then call `update_formula_field`

### Before Deleting a Field
1. Call `list_fields` to confirm the field exists and get its exact name
2. Call `delete_field` with both `fieldId` and `expectedName`
3. If dependencies are returned, show them to the user and ask before using `force: true`

### Before Installing an Extension
1. `create_extension` to get blockId
2. `create_extension_dashboard` to get pageId
3. `install_extension` with both IDs

## Safety Rules

- **NEVER** call `delete_field`, `delete_view`, or `remove_extension` without explicit user confirmation
- **NEVER** set `force: true` on `delete_field` without showing dependencies to the user first
- **ALWAYS** validate formulas before creating/updating them
- **ALWAYS** use read tools to discover IDs — never guess or fabricate Airtable IDs
- **PREFER** lightweight reads: use `list_tables` over `get_base_schema` when you only need table names
- **PREFER** shorthands: use `create_formula_field` instead of `create_field` with type formula

## Tool Selection Guide

| User Intent | Tool(s) to Use |
|-------------|----------------|
| "Show me the tables" | `list_tables` |
| "What fields does X have?" | `list_fields` or `get_table_schema` |
| "Create a formula that..." | `list_fields` then `validate_formula` then `create_formula_field` |
| "Update the formula in..." | `list_fields` then `validate_formula` then `update_formula_field` |
| "Delete the field..." | `list_fields` then confirm with user then `delete_field` |
| "Add a new text/number field" | `create_field` with appropriate fieldType |
| "Create a view filtered by..." | `list_fields` then `create_view` then `update_view_filters` |
| "Sort/group this view by..." | `apply_view_sorts` or `update_view_group_levels` |
| "Hide these columns" | `show_or_hide_view_columns` with `visibility: false` |
| "Install an extension" | `create_extension` then `create_extension_dashboard` then `install_extension` |

## Filter Operators Quick Reference

`contains`, `doesNotContain`, `is`, `isNot`, `isEmpty`, `isNotEmpty`,
`isGreaterThan`, `isLessThan`, `isGreaterThanOrEqualTo`, `isLessThanOrEqualTo`,
`isWithin`, `isAfter`, `isBefore`, `hasAnyOf`, `hasAllOf`, `hasNoneOf`

## Common Mistakes to Avoid

1. **Creating a formula without validating** — may produce invalid formula errors in Airtable
2. **Using table name instead of table ID for mutations** — some tools require `tableId` (tblXXX format)
3. **Forgetting expectedName on delete_field** — deletion will be refused
4. **Passing field names instead of field IDs to view tools** — view tools use `fldXXX` IDs, not names
5. **Deleting the last view in a table** — will fail; tables must have at least one view
