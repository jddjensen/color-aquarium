# Convert Excel Formula to Airtable

## Trigger
When user wants to convert an Excel formula to Airtable.

## Common Conversions

| Excel | Airtable |
|-------|----------|
| `A1`, `B2` | `{Field Name}` |
| `VLOOKUP` | Use linked records + rollup |
| `HLOOKUP` | Use linked records + rollup |
| `SUMIF` | Use rollup field with SUM |
| `COUNTIF` | Use rollup field with COUNT |
| `IFERROR(x,y)` | `IF(ISERROR(x), y, x)` |
| `ISBLANK(x)` | `x = BLANK()` or `NOT(x)` |
| `TEXT(x,"fmt")` | `DATETIME_FORMAT(x, "fmt")` |
| `DATEVALUE` | `DATETIME_PARSE` |
| `CONCATENATE` | Same, or use `&` operator |
| `NOW()` | Same (callable constant) |
| `TODAY()` | Same (callable constant) |

## Steps

1. **Identify Excel functions used**
2. **Map to Airtable equivalents**
3. **Replace cell refs with field refs**
4. **Add error handling if needed**
5. **Test in Airtable**

## Not Available - Use Workarounds

- **VLOOKUP/HLOOKUP**: Create linked record field, then use rollup
- **SUMIF/COUNTIF**: Create linked records with filter, use rollup
- **INDIRECT**: Not available, restructure logic
- **OFFSET**: Not available, use ARRAYSLICE for arrays
