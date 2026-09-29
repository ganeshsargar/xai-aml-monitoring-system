# FundTraceAI Architectural Decisions & Log

## Phase A: Column Mapping Layer Decisions

### 1. New Dependencies
- **`fast-levenshtein`** (v3.0.0+) in `backend`:
  - **Reason**: Needed for fuzzy fallback string similarity in the column auto-suggestion service (`columnMappingService.js`) when an uploaded raw header is not found in the curated synonym list.
  - **Trade-off / Alternative**: Custom Levenshtein implementation vs tested, zero-dependency, high-performance CJS library. Chosen for speed, accuracy, and zero transitive dependencies.

### 2. Canonical Schema Definition
- Located in `backend/src/config/canonicalSchema.js` and mirrored in `ml-service/canonical_schema.py`.
- **REQUIRED fields**:
  - `transaction_id` (string)
  - `timestamp` (date/ISO)
  - `sender_account` (string)
  - `receiver_account` (string)
  - `amount` (number)
  - `currency` (string)
- **OPTIONAL fields**:
  - `sender_name` (string)
  - `receiver_name` (string)
  - `country` (string)
  - `city` (string)
  - `device_id` (string)
  - `ip_address` (string)
  - `payment_method` (string)
  - `category` (string)
  - `merchant` (string)
  - `status` (string)
- Each field provides realistic synonym arrays covering common banking, fintech, SWIFT, NEFT/RTGS, UPI, and core banking terminology (e.g. `amt_inr`, `debit_acc`, `txn_dt`, `booking_date`, etc.).

### 3. Source Signature Computation
- To uniquely and deterministically identify column header sets across uploads:
  `source_signature = SHA256( raw_headers.map(h => h.trim().toLowerCase()).sort().join('|') )`
- This ensures that column reordering or minor whitespace/case discrepancies still match the exact same template.

### 4. Matching & Conflict Resolution Rules
- **Normalization**: Strip all punctuation, whitespace, underscores, hyphens, and convert to lowercase.
- **Synonym Match**: 1.0 confidence for exact canonical field name; 0.95 confidence for normalized synonym match.
- **Fuzzy Match**: Using normalized Levenshtein similarity:
  `similarity = 1 - (levenshtein_distance / max_len)`
  Matches with similarity >= 0.6 are eligible as fuzzy suggestions. Matches below 0.6 are left unmapped (`method: "none"`).
- **One-to-One Resolution**:
  - Auto-suggestion resolves competing candidates greedily by highest confidence score.
  - In manual confirmation (`POST /api/uploads/:upload_id/mapping`), validation enforces that:
    1. Every REQUIRED canonical field must be mapped to an existing raw header.
    2. No two canonical fields may be mapped to the same raw header (e.g., cannot map both `sender_account` and `receiver_account` to the same raw column).
    3. Conflicting or duplicate mappings are rejected with HTTP 400 and an explicit error explanation.

### 5. Staging & Pipeline Gating
- Uploaded CSVs are stored in `uploads/staging/` with a unique `upload_id`.
- On header detection (`POST /api/uploads/detect-headers`), a streaming reader captures headers and first 5 rows for preview, destroying the stream immediately without loading the entire file into memory.
- Downstream processing (scoring, batch prediction, DB ingestion) cannot execute until the mapping is confirmed via `POST /api/uploads/:upload_id/mapping`.
- If an exact matching template exists for the file's `source_signature`, the mapping is auto-applied and returned to the client with an option to review or change.

### 6. Local Storage Fallback Batch Performance (FileModel insertMany)
- **Problem**: When running in offline fallback mode without a live MongoDB instance, `Transaction.json` grows large. Performing row-by-row synchronous disk writes (`readFileSync` + `writeFileSync` per record) caused the backend event loop to block during bulk imports.
- **Decision**: Added atomic batch `insertMany()` to `FileModel` in `backend/src/config/db.js` and optimized `_write` to use compact JSON serialization.
- **Result**: Bulk ingestion latency dropped from ~10 minutes down to ~200–600ms for entire batches, eliminating UI loader freezing while preserving offline capabilities prior to MongoDB migration.

### 7. Multi-Hop Sub-Graph Expansion for Investigation Cases
- **Problem**: When creating or viewing an investigation case file from an alert, escalating a single transaction resulted in a basic 2-node, 1-edge visual graph ($A \to B$), failing to reveal the broader laundering typologies (such as multi-hop layering chains and circular wash-trading loops).
- **Decision**: Implemented an automated 2-hop transaction traversal algorithm in `getCaseGraph` (`backend/src/controllers/caseController.js`).
  1. Gathers initial seed accounts from base alert transactions.
  2. Hop 1: Queries the database for all incoming and outgoing transfers involving the seed accounts (finding forwarders and contributors).
  3. Hop 2: Traverses counterparties to locate transactions that link counterparties together or loop back to the originating accounts (capping total transactions at 55–60 for fast Cytoscape canvas responsiveness).
  4. Enhanced `ml-service/graph_module.py` to evaluate cycles up to length 6 (`2 <= len(c) <= 6`).
  5. Enhanced `FileModel.find` in `backend/src/config/db.js` with full `$or` operator support to ensure query compatibility between local JSON mode and production Mongoose/MongoDB.
- **Result**: Opening a case automatically reconstructs and highlights full circular money flows (e.g. $A \to B \to C \to D \to E \to A$) with NetworkX cycle detection, Louvain community clustering, and animated round-trip edges in Cytoscape.

