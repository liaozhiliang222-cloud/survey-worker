# Import regression fixtures

These workbooks preserve production-like survey export structures while using synthetic,
non-identifying values. Regenerate them with:

```powershell
python scripts/build-import-regression-fixtures.py
```

`manifest.json` is the acceptance contract consumed by the unified browser parser tests.
`unknown-layout.xlsx` is a negative fixture used to verify actionable diagnostics for unsupported structures.
