# Debug Airtable Formula

## Trigger
When user asks to debug or fix an Airtable formula error.

## Steps

1. **Identify the error type**
   - `#ERROR` → Syntax or reference issue
   - `NaN` → Division 0/0 or invalid date math
   - `Infinity` → Division X/0
   - `Circular reference` → Field references itself

2. **Check common issues**
   - [ ] Balanced parentheses `()`
   - [ ] Balanced braces `{}`
   - [ ] Balanced quotes `""` or `''`
   - [ ] No smart/curly quotes
   - [ ] No comments (`//` or `/* */`)
   - [ ] Field names spelled correctly
   - [ ] All function names valid

3. **Add guards for runtime errors**
   - Division: `IF({D}=0, BLANK(), {N}/{D})`
   - Dates: `IF({Date}=BLANK(), BLANK(), ...)`
   - Errors: `IF(ISERROR(expr), fallback, expr)`

4. **Test the fix**
   - Save the formula
   - Check output in Airtable
