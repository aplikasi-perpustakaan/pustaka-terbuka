# Contributing to PustakaTerbuka

Thank you for your interest in contributing to PustakaTerbuka!

## For Schools and Libraries: Submitting or Updating Holdings

### Step 1: Register or Update Your Organization

Add your organization to `data/orgs.json`:

```json
{
  "YourOrgCode": {
    "name": "Your School Name",
    "state": "Your State",
    "type": "school",
    "default_scheme": "DDC",
    "contact": "librarian@example.edu.my"
  }
}
```

### Step 2: Create Your Holdings File

Create `data/holdings/YourOrgCode.csv` with one row per title your library holds:

```csv
record,org,scheme,class_number,item_number,full_call_number,location
ab12cd34ef,YourOrgCode,DDC,005.133,ABC,005.133 ABC,Main Library
```

- `record`: The permanent PustakaTerbuka record ID or an ISBN (which will be resolved)
- `org`: Your organization code (must match `orgs.json`)
- `scheme`: `LCC`, `DDC`, or `other`
- `class_number`: The classification number
- `item_number`: The item/Cutter number
- `full_call_number`: The complete call number as displayed
- `location`: Optional shelving location

### Step 3: Submit a Pull Request

1. Fork the repository
2. Add your organization to `orgs.json` and create your holdings file
3. Run validation: `npm run validate-holdings`
4. Submit a pull request

The automated validation workflow will check your submission.

## For Developers

### Running Tests

```bash
npm test
```

### Code Style

- JavaScript: ES modules, no framework dependencies
- UTF-8 without BOM everywhere
- LF line endings for all text files (enforced by `.gitattributes`)

### Design Decisions

See `docs/DECISIONS.md` for architectural decisions and their rationale.
