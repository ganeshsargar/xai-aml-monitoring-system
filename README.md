# FundTrace AI: Explainable AI-Based AML Monitoring Platform

FundTrace AI is an enterprise-grade Banking Anti-Money Laundering (AML) Compliance, Transaction Monitoring, & Network Intelligence platform. engineered for public and private financial institutions in India. 

The system leverages Machine Learning classification models to calculate transaction risk probabilities, SHAP (Explainable AI) to construct local feature-attribution explanations for compliance officers, and NetworkX (Graph Theory) to map account links, detecting Louvain communities and circular money-routing schemes (wash trading).

---

## 📁 System Architecture & Port Mapping

FundTrace AI is built on a decoupled, three-tier service architecture:

```
                  ┌──────────────────────────────┐
                  │   React Frontend Client      │
                  │   (Vite Server - Port 3000)  │
                  └──────────────┬───────────────┘
                                 │
                                 │ REST API Calls (Port 5050)
                                 ▼
                  ┌──────────────────────────────┐
                  │   Express API Gateway        │
                  │   (Node Server - Port 5050)  │
                  └──────────────┬───────────────┘
                                 │
                                 │ REST API / JSON Payloads (Port 5000)
                                 ▼
                  ┌──────────────────────────────┐
                  │   Python Flask ML Engine     │
                  │   (Model & Network Graph)    │
                  └──────────────────────────────┘
```

1. **Frontend Portal (Port `3000`)**: React, Vite, and Tailwind CSS client featuring Cytoscape.js for interactive directed money-routing networks and Recharts for statistical compliance telemetry.
2. **Backend API Gateway (Port `5050`)**: Node.js and Express server with JWT authentication and Role-Based Access Control (RBAC). Integrates with MongoDB (or falls back to automated local JSON file storage).
3. **Machine Learning Service (Port `5000`)**: Python Flask API executing Scikit-learn, XGBoost, SHAP explainer trees, and NetworkX graph cycle algorithms.

---

## 📁 Repository Structure

```
explainable-aml-monitoring/
├── .gitignore             # Global workspace gitignore (virtual envs, node_modules, local data)
├── dataset/               # Data Simulation Module
│   └── generate_dataset.py # Generates 10k transaction records with AML typologies
├── ml-service/            # Python Flask ML & Graph Service
│   ├── app.py             # Flask application entrypoint serving predictions & Graph metrics
│   ├── train.py           # Model comparative training & evaluation pipeline
│   ├── graph_module.py    # NetworkX cycle, PageRank, & community detection algorithms
│   └── requirements.txt   # Python dependency list
├── backend/               # Express.js Server
│   ├── src/
│   │   ├── config/        # Database setup (Mongo/JSON fallback) and compliance report generator
│   │   ├── middleware/    # auth.js JWT validation & Role-Based Access Control
│   │   ├── controllers/   # Route handler actions for transactions, cases, and admin settings
│   │   └── routes/        # Express API endpoints
│   ├── server.js          # Express server entrypoint
│   ├── .env.example       # Example configuration files for backend environments
│   └── package.json
└── frontend/              # React + Vite Client
    ├── src/
    │   ├── components/    # Reusable navigation elements, SHAP explainer graphs, and NetworkX visualizers
    │   ├── pages/         # Login, Dashboard, Ledger, Alerts, Case Management, and Auditor Console
    │   ├── context/       # AuthContext and ThemeContext (Light/Dark mode)
    │   └── main.jsx
    ├── .env.example       # Example configuration files for client environments
    └── package.json
```

---

## ⚙️ Environment Configurations

### Backend Setup (`/backend/.env`)
Create a `.env` file in the `/backend` directory based on the `.env.example`:
```env
PORT=5050
MONGODB_URI=mongodb://127.0.0.1:27017/aml_db
JWT_SECRET=your_jwt_secret_key_here
ML_SERVICE_URL=http://127.0.0.1:5000
NODE_ENV=production
```

### Frontend Setup (`/frontend/.env`)
Create a `.env` file in the `/frontend` directory based on the `.env.example`:
```env
VITE_API_URL=http://localhost:5050
VITE_ML_SERVICE_URL=http://localhost:5000
```

---

## 🚀 Step-by-Step Installation & Launch

### Step 1: Initialize Python ML Service
1. Navigate to the project root directory.
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate
   ```
3. Install required packages:
   ```bash
   pip install -r ml-service/requirements.txt
   ```
4. Generate the synthetic transaction dataset:
   ```bash
   python dataset/generate_dataset.py
   ```
5. Run the comparative model training script to select the best-performing model:
   ```bash
   python ml-service/train.py
   ```
6. Launch the Python Flask service:
   ```bash
   python ml-service/app.py
   ```

### Step 2: Launch Backend API Gateway
1. Open a new terminal and navigate to the `/backend` directory.
2. Install node dependencies:
   ```bash
   npm install
   ```
3. Seed the local default roles and users (if starting fresh):
   ```bash
   node seed_users.js
   ```
4. Start the Express server:
   ```bash
   npm start
   ```

### Step 3: Launch React Frontend Client
1. Open a new terminal and navigate to the `/frontend` directory.
2. Install node dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to the development URL (default is `http://localhost:3000`).

---

## 🔐 Credentials for Demonstration Roles

The platform defines three authorization profiles aligned with banking compliance hierarchies:

| Username | Password | Role | Panel Permissions |
| :--- | :--- | :--- | :--- |
| **admin** | `admin123` | **Admin** | Full access to user management, database re-indexing, and ML training pipelines. |
| **investigator** | `investigator123` | **Investigator** | Full access to ledger, case assignments, timeline annotations, evidence file uploads, and PDF reports. |
| **auditor** | `auditor123` | **Auditor** | Read-only access to transaction history, system audit logs, and CSV logs export. |
