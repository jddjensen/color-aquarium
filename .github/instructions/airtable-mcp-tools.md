# Airtable User MCP — Tools Guide

> **Server**: airtable-user-mcp v2.1.0
> **Protocol**: Model Context Protocol (MCP) over stdio
> **Transport**: JSON-RPC 2.0

This MCP server provides **30 tools** for managing Airtable bases, organized into 5 categories.
All tools require an `appId` (e.g. `"appXXX"`) as their first parameter.
All tools accept an optional `debug: true` parameter to include raw Airtable responses.

---

## Category 1: Schema Read Tools (5 tools)

Use these tools to **discover and inspect** base structure before making changes.
These are **read-only** and safe to call at any time.

| Tool | When to Use |
|------|-------------|
| `get_base_schema` | Get full schema of all tables, fields, and views in a base. Use as the first step when exploring an unknown base. |
| `list_tables` | Lightweight listing of table IDs and names. Prefer over `get_base_schema` when you only need table names. |
| `get_table_schema` | Get full schema for a single table (fields + views). Use when you know which table to work with. |
| `list_fields` | List all fields/columns in a table with types and typeOptions. Use before creating formulas to check field names and types. |
| `list_views` | List all views in a table with IDs, names, and types. Use before modifying views. |

### Key Parameters
- `appId` (required): The Airtable base ID, always starts with `"app"`
- `tableIdOrName`: Accepts either table ID (`"tblXXX"`) or exact table name (case-sensitive)

### Best Practice
> **Always call a read tool before a mutation tool.** For example, call `list_fields` before `create_field` to verify field names and avoid duplicates.

---

## Category 2: Field Mutation Tools (8 tools)

Use these tools to **create, update, rename, delete, and duplicate** fields (columns).

### Creating Fields

| Tool | When to Use |
|------|-------------|
| `create_field` | Create any field type (text, number, checkbox, formula, rollup, lookup, count, etc.). Supports computed fields not available via the official API. |
| `create_formula_field` | Shorthand for creating a formula field. Use when you only need a formula — saves specifying `fieldType` and `typeOptions` wrapper. |

### Validating & Updating Formulas

| Tool | When to Use |
|------|-------------|
| `validate_formula` | **Always call this before** `create_formula_field` or `update_formula_field`. Returns whether the formula is valid and what result type it produces. Catches syntax errors early. |
| `update_formula_field` | Update the formula text of an existing formula field. Shorthand for `update_field_config`. |
| `update_field_config` | Update configuration of any computed field (formula, rollup, lookup, count). Use for non-formula computed fields. |

### Renaming & Deleting

| Tool | When to Use |
|------|-------------|
| `rename_field` | Rename a field. Pre-validates the field exists. |
| `delete_field` | **⚠️ DESTRUCTIVE** — Delete a field. Requires both `fieldId` AND `expectedName` as safety guard. Checks for downstream dependencies first. |
| `duplicate_field` | Clone a field structure. Optionally copies cell values with `duplicateCells: true`. |

### Required Workflow: Formula Creation
```
1. list_fields          → verify field names and types exist
2. validate_formula     → check syntax and result type
3. create_formula_field → create the field if validation passes
```

### Required Workflow: Formula Update
```
1. list_fields          → get the fieldId of the formula field
2. validate_formula     → validate the new formula text
3. update_formula_field → apply the update if validation passes
```

### Safety Rules for Field Mutations
- **Never delete a field without user confirmation.** Always show the field name and ask.
- `delete_field` checks for downstream dependencies (other fields referencing it). If dependencies exist, it returns dependency info instead of deleting. Set `force: true` only if the user explicitly confirms.
- `expectedName` must match exactly (case-sensitive) or deletion is refused.

### typeOptions Reference
| Field Type | typeOptions |
|------------|-------------|
| formula | `{ formulaText: "IF({A},1,0)" }` |
| rollup | `{ fieldIdInLinkedTable, recordLinkFieldId, resultType, referencedFieldIds }` |
| lookup | `{ recordLinkFieldId, fieldIdInLinkedTable }` |
| count | `{ recordLinkFieldId }` |
| text, number, checkbox | `{}` (no typeOptions needed) |

---

## Category 3: View Tools (10 tools)

Use these tools to **create, configure, and manage** views.

### Creating & Managing Views

| Tool | When to Use |
|------|-------------|
| `create_view` | Create a new view. Types: `"grid"`, `"form"`, `"kanban"`, `"calendar"`, `"gallery"`, `"gantt"`, `"levels"` (list). Can copy config from an existing view. |
| `duplicate_view` | Clone a view with all its configuration (filters, sorts, field visibility). |
| `rename_view` | Rename a view. |
| `delete_view` | **⚠️ DESTRUCTIVE** — Delete a view. Cannot delete the last remaining view in a table. |

### Configuring Views

| Tool | When to Use |
|------|-------------|
| `update_view_description` | Set or clear a view's description text. |
| `update_view_filters` | Set filter conditions on a view. Supports AND/OR conjunctions. |
| `reorder_view_fields` | Change column order in a view. Provide a map of field IDs → column index. |
| `show_or_hide_view_columns` | Show or hide specific columns in a view. |
| `apply_view_sorts` | Set sort conditions. Pass empty array `[]` to clear sorts. |
| `update_view_group_levels` | Set grouping. Pass empty array `[]` to clear grouping. |
| `update_view_row_height` | Change row height: `"small"`, `"medium"`, `"large"`, `"xlarge"`. |

### Filter Syntax
```json
{
  "filterSet": [
    { "columnId": "fldXXX", "operator": "contains", "value": "test" },
    { "columnId": "fldYYY", "operator": "isEmpty" }
  ],
  "conjunction": "and"
}
```

### Available Filter Operators
`contains`, `doesNotContain`, `is`, `isNot`, `isEmpty`, `isNotEmpty`,
`isGreaterThan`, `isLessThan`, `isGreaterThanOrEqualTo`, `isLessThanOrEqualTo`,
`isWithin`, `isAfter`, `isBefore`, `hasAnyOf`, `hasAllOf`, `hasNoneOf`

---

## Category 4: Field Description Tool (1 tool)

| Tool | When to Use |
|------|-------------|
| `update_field_description` | Set or update the description text of any field. Use to document field purpose, formula logic, or data source. |

---

## Category 5: Extension/Block Tools (6 tools)

Use these tools to manage Airtable extensions (blocks) and dashboard pages.

| Tool | When to Use |
|------|-------------|
| `create_extension` | Register a new extension in a base. Returns a `blockId` needed for installation. |
| `create_extension_dashboard` | Create a new dashboard page. Extensions are installed onto pages. |
| `install_extension` | Install an extension onto a dashboard page. Requires `blockId` + `pageId`. |
| `update_extension_state` | Enable or disable an installed extension (`"enabled"` / `"disabled"`). |
| `rename_extension` | Rename an installed extension. |
| `duplicate_extension` | Clone an installed extension to a dashboard page. |
| `remove_extension` | **⚠️ DESTRUCTIVE** — Remove an extension from a dashboard. |

### Required Workflow: Extension Installation
```
1. create_extension           → get blockId
2. create_extension_dashboard → get pageId
3. install_extension          → install block onto page
```

---

## Global Rules

1. **Read before write**: Always call a read tool to understand current state before mutating.
2. **Validate before create**: Always `validate_formula` before creating or updating formula fields.
3. **Confirm destructive ops**: Never call `delete_field`, `delete_view`, or `remove_extension` without explicit user confirmation.
4. **Use exact IDs**: Airtable IDs are case-sensitive. Copy them exactly from read tool results.
5. **Prefer shorthands**: Use `create_formula_field` over `create_field` with type formula. Use `update_formula_field` over `update_field_config`.
6. **Check dependencies**: Before deleting a field, the tool automatically checks for downstream dependencies. Review the response before forcing deletion.
7. **Use debug sparingly**: Only pass `debug: true` when troubleshooting — it returns large raw payloads.

## ID Format Reference

| Entity | Prefix | Example |
|--------|--------|---------|
| Base/App | `app` | `appXXXXXXXXXXXXXX` |
| Table | `tbl` | `tblXXXXXXXXXXXXXX` |
| Field | `fld` | `fldXXXXXXXXXXXXXX` |
| View | `viw` | `viwXXXXXXXXXXXXXX` |
| Block | `blk` | `blkXXXXXXXXXXXXXX` |
| Block Installation | `bli` | `bliXXXXXXXXXXXXXX` |
| Block Release | `blr` | `blrXXXXXXXXXXXXXX` |
| Dashboard Page | `bip` | `bipXXXXXXXXXXXXXX` |
