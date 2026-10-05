# FundTraceAI AML Platform - API Documentation

The Express Backend Gateway exposes REST API endpoints under `/api`. All endpoints (except public authentication routes) require a JWT token passed in the `Authorization` header: `Bearer <token>`.

---

## 🔐 1. Authentication Endpoints

### Register User
* **Endpoint**: `POST /api/auth/register`
* **Access**: Public / Admin
* **Payload**:
  ```json
  {
    "username": "investigator_01",
    "password": "secure_password",
    "name": "Jane Compliance Officer",
    "role": "Investigator"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "User registered successfully.",
    "user": { "id": "93jksld", "username": "investigator_01", "name": "Jane Compliance Officer", "role": "Investigator" }
  }
  ```

### User Login
* **Endpoint**: `POST /api/auth/login`
* **Access**: Public
* **Payload**:
  ```json
  {
    "username": "investigator_01",
    "password": "secure_password"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Login successful.",
    "token": "eyJhbGciOi...",
    "user": { "id": "93jksld", "username": "investigator_01", "name": "Jane Compliance Officer", "role": "Investigator" }
  }
  ```

---

## 💰 2. Transaction Management

### Query Transaction Ledger
* **Endpoint**: `GET /api/transactions`
* **Access**: Authenticated (Admin, Investigator, Auditor)
* **Query Parameters**:
  - `page`: default `1`
  - `limit`: default `10`
  - `search`: string to search names, IDs, accounts
  - `minAmount` / `maxAmount`: numerical boundaries
  - `country`: e.g., `KY`, `US`
  - `risk_level`: `Low`, `Medium`, `High`, `Critical`
  - `status`: `Approved`, `Pending`, `Flagged`
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "total": 128,
    "page": 1,
    "totalPages": 13,
    "data": [
      {
        "transaction_id": "TX100234",
        "sender_account": "ACC10023",
        "sender_name": "Customer_10023",
        "receiver_account": "ACC20984",
        "receiver_name": "Customer_20984",
        "amount": 9500,
        "currency": "INR",
        "timestamp": "2026-07-05T12:00:00.000Z",
        "country": "KY",
        "status": "Flagged",
        "risk_score": 82,
        "reasons": ["Structuring: Near $10K limit", "Transacting with a high-risk country / tax haven"]
      }
    ]
  }
  ```

### Upload Bulk Transaction CSV (Legacy Gated Endpoint)
* **Endpoint**: `POST /api/transactions/import`
* **Access**: Admin, Investigator
* **Headers**: `Content-Type: multipart/form-data`
* **Form Field**: `file` (a `.csv` file containing transaction rows)
* **Behavior**: Pipeline gated. Delegates to header detection and auto-applies mapping if matching template signature exists; otherwise requires mapping confirmation.

---

## 📊 2B. Column Mapping & Upload Gateway (Phase A)

### 1. Detect Headers & Staging
* **Endpoint**: `POST /api/uploads/detect-headers`
* **Access**: Admin, Investigator
* **Headers**: `Content-Type: multipart/form-data`
* **Form Field**: `file` (a `.csv` file)
* **Description**: Stages raw file with unique `upload_id`, reads headers and first 5 preview rows using a streaming reader (does not load full file into memory), computes deterministic `source_signature`, and checks for an exact matching saved template.
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "upload_id": "upl_1727623912_abc123",
    "headers": ["Txn_Ref_No", "Debtor_Acc", "Creditor_Acc", "Val", "CCY", "Booking_Date"],
    "preview_rows": [
      { "Txn_Ref_No": "TX001", "Debtor_Acc": "ACC1", "Creditor_Acc": "ACC2", "Val": "50000", "CCY": "INR", "Booking_Date": "2026-05-10T10:00:00Z" }
    ],
    "row_count_estimate": 100,
    "source_signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "auto_applied_template": {
      "template_id": "tmpl_12345",
      "template_name": "Core Banking Standard Export",
      "mapping": { "transaction_id": "Txn_Ref_No", "amount": "Val", ... }
    }
  }
  ```

### 2. Auto-Suggested Column Mapping
* **Endpoint**: `GET /api/uploads/:upload_id/suggested-mapping`
* **Access**: Admin, Investigator
* **Description**: Evaluates raw headers against canonical schema using exact synonym matching and Levenshtein distance fallback (similarity >= 0.6). Resolves conflicts greedily to guarantee 1-to-1 assignments, and flags missing REQUIRED fields.
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "upload_id": "upl_1727623912_abc123",
    "source_signature": "e3b0c442...",
    "raw_headers": ["Txn_Ref_No", "Debtor_Acc", ...],
    "suggestions": [
      {
        "canonical_field": "transaction_id",
        "display_label": "Transaction ID",
        "description": "Unique identifier for the financial transaction",
        "expected_type": "string",
        "required": true,
        "suggested_raw_header": "Txn_Ref_No",
        "confidence": 0.95,
        "method": "synonym"
      }
    ],
    "missing_required": [],
    "unmapped_raw": ["Internal_Audit_Code"]
  }
  ```

### 3. Confirm Mapping & Trigger Ingestion
* **Endpoint**: `POST /api/uploads/:upload_id/mapping`
* **Access**: Admin, Investigator
* **Payload**:
  ```json
  {
    "mapping": {
      "transaction_id": "Txn_Ref_No",
      "timestamp": "Booking_Date",
      "sender_account": "Debtor_Acc",
      "receiver_account": "Creditor_Acc",
      "amount": "Val",
      "currency": "CCY",
      "sender_name": "Payer",
      "receiver_name": "Payee",
      "country": "Origin_Jurisdiction",
      "payment_method": "Channel"
    },
    "save_as_template": true,
    "template_name": "Core Banking Standard Export"
  }
  ```
* **Validation**:
  - Every REQUIRED field must be mapped to a valid raw header present in the file.
  - No two canonical fields may be mapped to the same raw column.
* **Pipeline Execution**: Streams staged file, translates each row to canonical fields, executes AML feature engineering & batch inference, inserts transactions & alerts to DB, and logs audit trail.
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Import completed successfully. Processed 100 transactions and raised 8 alerts in 1.4s.",
    "upload_id": "upl_1727623912_abc123",
    "processed": 100,
    "flagged": 8,
    "elapsed_seconds": 1.4,
    "mapping": { ... },
    "template_saved": true
  }
  ```

### 4. List Mapping Templates
* **Endpoint**: `GET /api/uploads/mapping-templates`
* **Access**: Authenticated
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "templates": [
      {
        "template_id": "tmpl_12345",
        "template_name": "Core Banking Standard Export",
        "source_signature": "e3b0c442...",
        "headers_count": 10,
        "headers": ["Txn_Ref_No", "Debtor_Acc", ...],
        "mapping": { "transaction_id": "Txn_Ref_No", ... },
        "usage_count": 4,
        "created_by": "admin",
        "created_at": "2026-05-15T14:30:00.000Z",
        "last_used_at": "2026-05-16T09:00:00.000Z"
      }
    ]
  }
  ```

### 5. Delete Mapping Template
* **Endpoint**: `DELETE /api/uploads/mapping-templates/:id`
* **Access**: Admin, Investigator
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Mapping template deleted successfully."
  }
  ```

---

## 🔔 3. Compliance Alert Queue

### Get Alerts Queue
* **Endpoint**: `GET /api/alerts`
* **Access**: Authenticated (Admin, Investigator, Auditor)
* **Query Parameters**: `status` (New, Investigating, Dismissed, Escalated), `level` (Critical, High, Medium, Low)
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "count": 1,
    "data": [
      {
        "alert_id": "ALT198273",
        "transaction_id": "TX100234",
        "risk_score": 82,
        "level": "Critical",
        "status": "New",
        "transaction": { ... }
      }
    ]
  }
  ```

### Update Alert Status
* **Endpoint**: `PUT /api/alerts/:id`
* **Access**: Admin, Investigator
* **Payload**: `{ "status": "Investigating" }`

---

## 📂 4. Case Files & Report Generation

### Create Investigation Case
* **Endpoint**: `POST /api/cases`
* **Access**: Admin, Investigator
* **Payload**:
  ```json
  {
    "title": "Suspicious Structuring target ACC10023",
    "alerts": ["ALT198273"]
  }
  ```

### Add Case Investigator Notes
* **Endpoint**: `POST /api/cases/:id/notes`
* **Access**: Admin, Investigator
* **Payload**: `{ "text": "Audited sender trans-speed. Velocity flags matched smurfing profile." }`

### Compile & Download Case Report PDF
* **Endpoint**: `GET /api/cases/:id/report`
* **Access**: Authenticated (Admin, Investigator, Auditor)
* **Response**: Returns compiled `application/pdf` binary stream directly as a file download.

---

## 💻 5. Admin & Auditing

### Query System Logs
* **Endpoint**: `GET /api/admin/audit-logs`
* **Access**: Admin, Auditor
* **Response**: Returns a complete array of action trails including timestamp, audited operator, action types, IP address, and details.
