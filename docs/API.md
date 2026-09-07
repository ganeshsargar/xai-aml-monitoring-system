# Argus AML Platform - API Documentation

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

### Upload Bulk Transaction CSV
* **Endpoint**: `POST /api/transactions/import`
* **Access**: Admin, Investigator
* **Headers**: `Content-Type: multipart/form-data`
* **Form Field**: `file` (a `.csv` file containing transaction rows)
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "CSV Import completed successfully. Processed 100 transactions. Flagged 8 suspicious.",
    "processed": 100,
    "flagged": 8
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
