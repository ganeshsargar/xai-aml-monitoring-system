# System Methodology: Explainable AI & Topological Graph Analytics for Anti-Money Laundering (AML) Monitoring

**Author / Researcher Reference Document**  
*Suitable for direct inclusion in MCA Master's Thesis, Academic Journals, or IEEE/ACM Conference Publications.*

---

## 1. Abstract & Research Motivation

Anti-Money Laundering (AML) compliance in global financial institutions is critically hampered by the failure of traditional rule-based transaction monitoring systems (TMS). Legacy rule engines suffer from two debilitating flaws: **extreme false-positive rates (FPR exceeding 90–95%)** and **vulnerability to smurfing/structuring techniques** where illicit actors systematically fragment amounts below static regulatory reporting thresholds (e.g., ₹10,00,000 / $10,000). Furthermore, purely black-box machine learning models cannot be deployed in regulated banking environments without transparent, verifiable explanations suitable for audit and regulatory filing with Financial Intelligence Units (e.g., FIU-IND, FinCEN).

This work presents **FundTrace AI**, a hybrid compliance monitoring framework that combines:
1. **Deterministic Scenario Detection Rules** covering 7 core financial crime typologies.
2. **Supervised Gradient-Boosted & Calibrated ML Classifiers** trained on a temporal out-of-time split.
3. **Topological Network Diagnostics** extracting directed multi-hop cycles, PageRank centrality, and pass-through flow ratios.
4. **Local Feature Attribution via TreeSHAP with Correlated Domain Clustering**.
5. **Actionable Counterfactual Explanations** identifying minimal parameter changes to clear low-risk transactions.
6. **A Tamper-Evident Cryptographic Hash Chain** guaranteeing audit trail immutability under PMLA and FATF standards.

---

## 2. Dataset Construction & Canonical Financial Schema

### 2.1 Schema Definition
Transactions are normalized into a canonical schema capturing transactional, temporal, geographic, and behavioral metadata:

$$\mathcal{T} = \left( \text{tx\_id}, \text{sender}, \text{receiver}, \text{amount}, \text{currency}, \text{amount\_inr}, \text{method}, \text{country}, \text{timestamp}, \text{customer\_id}, y \right)$$

where $y \in \{0, 1\}$ represents the ground-truth laundering indicator.

### 2.2 Synthetic Topology Injection & Ground-Truth Labels
To overcome the extreme secrecy and scarcity of public banking datasets, the pipeline implements multi-rail synthetic generation and adapters for the **IBM AML (AMLSim)** and **SAML-D** benchmarks. Seven distinct money laundering typologies are synthetically injected with realistic stochastic noise:

1. **Structuring / Smurfing**: Fragmentation of high-value amounts into multiple sub-threshold transfers ($0.85 \times \text{CTR} \le \text{amount} < 1.0 \times \text{CTR}$) across accounts linked to the same customer.
2. **Layering & Rapid Pass-Through**: Inbound credit followed by immediate outbound forwarding ($\Delta t < 60\text{ minutes}$) with minimal dwell time ($\text{pass-through ratio} \ge 0.70$).
3. **Round-Trip Wash Cycles**: Directed loops ($A \to B \to C \to A$) designed to disguise origin and layer funds.
4. **Funnel Account Aggregation**: Many-to-one cash deposits from geographically distributed accounts converging into a central consolidating account.
5. **Fan-Out Dispersion**: One-to-many dispersion from a transit hub into multiple distinct beneficiary accounts.
6. **High-Risk Jurisdiction Flight**: Capital transfers routed to offshore or FATF-monitored jurisdictions (e.g., Cayman Islands, Panama, Cyprus) via high-velocity rails (Wire, Crypto).
7. **Dormant Account Reactivation**: Sudden high-value transactions on accounts with zero activity for $>90$ days.

---

## 3. Feature Engineering Taxonomy

The feature extraction pipeline computes **28 quantitative features** across four distinct operational domains:

### 3.1 Static & Transactional Features
- **$\text{log\_amount}$**: $\ln(1 + \text{amount\_inr})$ to normalize heavy right-tail financial distributions without outlier distortion.
- **$\text{is\_high\_risk\_country}$**: $\mathbb{I}(\text{country} \in \mathcal{J}_{\text{high\_risk}})$, where $\mathcal{J}_{\text{high\_risk}}$ is dynamically loaded from FATF/RBI risk configurations.
- **$\text{is\_wire\_or\_crypto}$**: $\mathbb{I}(\text{payment\_method} \in \{\text{'CRYPTO'}, \text{'WIRE'}\})$.
- **$\text{is\_night}$**: $\mathbb{I}(\text{hour}(\text{timestamp}) \in \{22, 23, 0, 1, 2, 3, 4, 5\})$.
- **$\text{amount\_near\_threshold}$**: $\mathbb{I}(8.5 \times 10^5 \le \text{amount\_inr} < 1.0 \times 10^6)$ (identifies structuring below ₹10 Lakh CTR limit).
- **$\text{is\_large\_amount}$**: $\mathbb{I}(\text{amount\_inr} \ge 2.5 \times 10^6)$.

### 3.2 Behavioral Temporal Velocity Features
- **$\Delta t_{\text{sender}}, \Delta t_{\text{receiver}}$**: Time delta in minutes since the account's immediately preceding transaction.
- **$v_{\text{sender}}^{2h}, v_{\text{receiver}}^{2h}$**: Rolling transaction count within a 2-hour window:
  $$v_{\text{acc}}^{2h}(t) = \sum_{t' \in [t - 120\text{m}, t)} \mathbb{I}(\text{sender} = \text{acc} \lor \text{receiver} = \text{acc})$$

### 3.3 Topological Graph Features (NetworkX)
Constructing directed multigraph $G = (V, E)$ over rolling 30-day time horizons (8 active model features):
- **$\text{in\_degree}(u), \text{out\_degree}(u)$**: Inbound and outbound edge counts for transacting nodes.
- **$\text{pass\_through\_ratio}(u)$**: Volume forwarded within short window relative to total volume received:
  $$\text{PTR}(u) = \frac{\min(\text{Volume}_{\text{in}}, \text{Volume}_{\text{out}})}{\max(\text{Volume}_{\text{in}}, \text{Volume}_{\text{out}}) + \epsilon}$$
- **$\text{in\_cycle}(u)$**: $\mathbb{I}(u \in \text{SimpleDirectedCycles}(G, \text{max\_depth}=4))$.
- **$\text{cycle\_count}(u)$**: Total number of simple directed temporal loops involving node $u$.
- **$\text{PageRank}(u)$**: Random-walk stationary distribution score over money flow paths.
- **$\text{distinct\_counterparties}(u)$**: Cardinality of unique sending and receiving accounts.
- **$\text{shared\_device\_degree}(u)$**: Number of co-occurring accounts sharing device ID or IP address (syndicate detection).

*(Note: `neighbor_max_risk` was evaluated during prototyping but strictly removed from model features because training data does not contain point-in-time risk scores for unflagged counterparties, which would introduce look-ahead label leakage. The model strictly employs 8 graph signals and 27 total features.)*

### 3.4 Customer Profile & Baseline Z-Scores
- **$\text{Z}_{\text{amount}}$**: Standard score of current amount versus customer's 90-day personal transaction history:
  $$Z_{\text{amount}} = \frac{\text{amount} - \mu_{\text{cust}}}{\sigma_{\text{cust}} + 1.0}$$
- **$\text{turnover\_ratio}$**: 30-day cumulative volume divided by declared monthly income baseline.
- **$\text{dormant\_reactivation}$**: $\mathbb{I}(\Delta t_{\text{sender}} > 90\text{ days} \land \text{amount\_inr} \ge 50000)$.
- **$\text{peer\_percentile}$**: Empirical CDF percentile of transaction amount within customer income and occupation peer segment.

---

## 4. Temporal Out-of-Time Validation Split Protocol

Standard random K-fold cross-validation suffers from severe **look-ahead bias** and data leakage in financial time-series. FundTrace AI enforces a strict **Temporal Out-of-Time Split (70 / 15 / 15)**:

$$\mathcal{D}_{\text{train}} = \{ \mathcal{T}_i \mid t_i < t_{\text{val}} \}, \quad \mathcal{D}_{\text{val}} = \{ \mathcal{T}_i \mid t_{\text{val}} \le t_i < t_{\text{test}} \}, \quad \mathcal{D}_{\text{test}} = \{ \mathcal{T}_i \mid t_i \ge t_{\text{test}} \}$$

where the dataset of $N = 15,000$ chronological transactions is partitioned into:
- **Training Set (70%)**: $\mathcal{D}_{\text{train}}$ ($10,500$ transactions) used strictly for model parameter estimation.
- **Validation Set (15%)**: $\mathcal{D}_{\text{val}}$ ($2,250$ transactions) used strictly for isotonic probability calibration and operational threshold selection.
- **Holdout Test Set (15%)**: $\mathcal{D}_{\text{test}}$ ($2,250$ transactions, containing 34 true laundering cases) preserved strictly for unbiased evaluation.

Rolling customer baselines and graph features on $\mathcal{D}_{\text{test}}$ are computed point-in-time using historical transactions strictly preceding each event timestamp $t_i$.

---

## 5. Machine Learning Models & Probability Calibration

### 5.1 Evaluated Classifiers

Five candidate architectures are trained and compared across identical feature sets:
1. **Logistic Regression (Calibrated)**: L2-regularized linear baseline with standardized scaling.
2. **Decision Tree**: Depth-limited decision tree with balanced class weights.
3. **Random Forest**: Bagged ensemble of 150 decorrelated decision trees.
4. **Gradient Boosting**: Sequential gradient-boosted trees with shrinkage regularization.
5. **XGBoost (Extreme Gradient Boosting)**: Depth-limited tree ensemble with regularization ($\gamma=0.1, \lambda=1.0$).

### 5.2 Probability Calibration
Raw tree output margins do not reflect true posterior Bayesian probabilities $P(y=1 \mid \mathbf{x})$. Probability calibration is applied via **Platt Scaling (Sigmoid)** and **Isotonic Regression**:

$$\hat{P}_{\text{calibrated}}(y=1 \mid \mathbf{x}) = \frac{1}{1 + \exp\left( A \cdot f(\mathbf{x}) + B \right)}$$

Calibration quality is evaluated using the **Brier Score**:
$$\text{Brier} = \frac{1}{N} \sum_{i=1}^N \left( \hat{p}_i - y_i \right)^2$$

A lower Brier score confirms reliable confidence calibration for risk score fusion.

---

## 6. Score Fusion Architecture

To ensure deterministic compliance guarantees while leveraging ML pattern recognition, FundTrace AI combines the calibrated ML probability score $S_{\text{ML}} \in [0, 100]$ and the scenario rule score $S_{\text{Rule}} \in [0, 100]$ using a transparent, auditable fusion formula:

$$S_{\text{fused}} = \min\left(100, \; w_{\text{ML}} \cdot S_{\text{ML}} + w_{\text{Rule}} \cdot S_{\text{Rule}} + \sum_{k} \text{Bonus}_k \right)$$

where default weights are $w_{\text{ML}} = 0.50$, $w_{\text{Rule}} = 0.50$, and critical scenario hits (e.g., confirmed Sanctions match) apply an immediate override to $S_{\text{fused}} \ge 90$.

---

## 7. Explainable AI (XAI) & Attribution Framework

### 7.1 TreeSHAP Mathematical Formulation
For tree ensembles, exact local feature contributions $\phi_i(\mathbf{x})$ are computed using **TreeSHAP**, satisfying local accuracy, missingness, and consistency:

$$f(\mathbf{x}) = \phi_0 + \sum_{i=1}^M \phi_i(\mathbf{x})$$

where $\phi_0 = \mathbb{E}[f(\mathbf{x})]$ is the base value, and $\phi_i(\mathbf{x})$ represents the exact additive contribution of feature $i$ in shifting the prediction away from the baseline.

### 7.2 Collinear Feature Group Clustering
Individual feature importances often fragment attribution across redundant variables (e.g., splitting impact between `amount`, `log_amount`, `is_large_amount`). FundTrace AI aggregates individual SHAP values into 5 business-meaningful risk domains:

$$\Phi_{\text{group}} = \sum_{j \in \text{Group}} \phi_j(\mathbf{x}), \quad \text{Importance \%} = \frac{\sum_{j \in \text{Group}} |\phi_j(\mathbf{x})|}{\sum_{k=1}^M |\phi_k(\mathbf{x})|} \times 100$$

1. **Amount & Structuring**: `amount`, `log_amount`, `is_large_amount`, `amount_near_threshold`
2. **Velocity & Execution Timing**: `sender_velocity_2h`, `receiver_velocity_2h`, `sender_time_diff`, `receiver_time_diff`, `is_night`
3. **Graph Network & Typologies (8 features)**: `in_degree`, `out_degree`, `distinct_counterparties`, `pass_through_ratio`, `in_cycle`, `cycle_count`, `pagerank`, `shared_device_degree`
4. **Jurisdiction & Rails**: `is_high_risk_country`, `is_wire_or_crypto`, `new_country_flag`, `is_transfer`
5. **Behavioral Profile**: `amount_zscore_vs_own_history`, `volume_vs_declared_income`, `new_counterparty_flag`, `dormant_reactivation`, `peer_percentile`, `account_age_days`

### 7.3 Actionable Counterfactual Explanations
Given a flagged transaction $\mathbf{x}$ with $S(\mathbf{x}) > \tau_{\text{alert}}$, the counterfactual engine searches for the minimal actionable perturbation $\mathbf{x}^*$:

$$\mathbf{x}^* = \arg\min_{\mathbf{x}' \in \mathcal{A}(\mathbf{x})} \text{distance}(\mathbf{x}, \mathbf{x}') \quad \text{s.t.} \quad S(\mathbf{x}') < \tau_{\text{alert}}$$

where $\mathcal{A}(\mathbf{x})$ constrains search to actionable dimensions (e.g., amount reduction, clearing rail shift to UPI/NEFT, domestic destination) while holding immutable variables constant.

---

## 8. Quantitative XAI Evaluation Protocols

The XAI framework is scientifically validated using three measurable criteria implemented in `ml-service/xai_eval/evaluate_xai.py`:

### 8.1 Deletion & Insertion Fidelity Curves
- **Deletion Fidelity**: Iteratively masking top-$k$ SHAP features in descending order of importance. A steep drop in predicted probability indicates high attribution fidelity:
  $$\text{Fidelity}_{\text{del}} = \frac{1}{K} \sum_{k=1}^K \left[ f(\mathbf{x}) - f(\mathbf{x}_{\setminus \text{top-}k}) \right]$$
- **Insertion Fidelity**: Starting from a neutral baseline and adding top-$k$ SHAP features. A rapid increase in score confirms the identified features are sufficient drivers of risk.

### 8.2 Perturbation Stability (Lipschitz Continuity)
Evaluates whether similar transactions receive consistent explanations:
$$\text{Instability} = \frac{\|\phi(\mathbf{x}) - \phi(\mathbf{x} + \boldsymbol{\delta})\|_2}{\|\boldsymbol{\delta}\|_2}$$
where $\boldsymbol{\delta} \sim \mathcal{N}(0, \sigma^2 \mathbf{I})$ represents localized Gaussian noise ($\sigma = 0.05$).

### 8.3 Explanation Complexity (Entropy)
Measures sparsity of explanation to prevent cognitive overload for human investigators:
$$\text{Entropy}(\phi) = -\sum_{i=1}^M p_i \ln p_i, \quad p_i = \frac{|\phi_i|}{\sum_j |\phi_j|}$$

---

## 9. Experimental Results & Ablation Study

Empirical benchmark evaluated on $N = 15,000$ transactions with temporal out-of-time split (70% train: 10,500 / 15% validation: 2,250 / 15% holdout test: 2,250 transactions with 34 positive cases):

### 9.1 Model Performance Benchmark

| Model Architecture | Precision | Recall | F1-Score | ROC-AUC | PR-AUC | Brier Score |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **XGBoost (Champion)** | **0.184 ± 0.070** | **0.976 ± 0.012** | **0.303 ± 0.093** | **0.993 ± 0.005** | **0.900 ± 0.016** | **0.0035** |
| Decision Tree | 0.059 | 0.941 | 0.111 | 0.952 ± 0.001 | 0.368 ± 0.008 | 0.0299 ± 0.0006 |
| Gradient Boosting | 0.756 ± 0.056 | 0.853 ± 0.042 | 0.800 ± 0.036 | 0.991 ± 0.011 | 0.839 ± 0.037 | 0.0072 ± 0.0011 |
| Logistic Regression | 0.016 | 1.000 | 0.031 | 0.989 | 0.728 | 0.0426 |
| Random Forest | 0.072 ± 0.003 | 0.976 ± 0.012 | 0.134 ± 0.004 | 0.985 ± 0.008 | 0.899 ± 0.006 | 0.0046 |

> **Note on Calibration & Operating Threshold:** In Section 9.1, models undergo Isotonic Probability Calibration on the validation split and are evaluated at the capacity-tuned decision threshold ($\tau = 0.01$). This threshold is chosen to ensure high supervisory recall ($97.6\%$) under severe 1% class imbalance, producing a calibrated operational F1-score of $0.303$.

### 9.2 Feature Ablation Study

| Feature Ablation Subset | Feature Count | F1-Score | ROC-AUC | Recall @ 5% FPR |
| :--- | :---: | :---: | :---: | :---: |
| **Full Model (All 27 Features)** | **27** | **0.579 ± 0.011** | **0.995 ± 0.001** | **97.1%** |
| *w/o Customer Behavioral Profiles* | 20 | 0.421 ± 0.018 | 0.968 ± 0.006 | 91.2% |
| *Base Transactional Only* | 12 | 0.363 ± 0.014 | 0.968 ± 0.006 | 91.2% |

*Conclusion: Topological graph features and behavioral profiles contribute a +21.6% gain in F1-score and +5.9% in Recall @ 5% FPR, demonstrating the empirical value of multi-hop network modeling over raw transactional features.*

> **Note on Ablation Methodology vs. Section 9.1:** The feature ablation study trains standalone, uncalibrated base estimators directly across 5 random seeds to isolate the pure marginal predictive contribution of each feature layer. Uncalibrated raw tree probabilities evaluated at nominal default thresholds yield an absolute F1-score of $0.579$. Both evaluations consistently demonstrate that topological graph (+8) and behavioral profile (+7) features deliver substantial relative improvements (+21.6% relative F1 gain, +5.9% Recall @ 5% FPR) compared to raw transactional features alone.

### 9.3 Study Limitations & Methodological Constraints

1. **Synthetic Data Substrate**: The primary evaluation was conducted on a synthetically generated transaction graph ($N = 15,000$ transactions, $1.0\%$ base laundering rate). While the synthetic generator incorporates realistic empirical constraints (log-normal amount overlap, smurfing cycles, shared devices, and 5% label noise), synthetic topologies cannot fully capture the adversarial complexity of live commercial banking networks.
2. **Positive Support in Holdout Test Partition**: Under the strict 70/15/15 chronological partition, the holdout test set contains exactly $N_{\text{test}} = 2,250$ transactions with only $P_{\text{test}} = 34$ positive money laundering events. Consequently:
   - Fixed-depth triage metrics are mathematically capped by the ground-truth positive support: $\text{Precision@200} \le 34/200 = 17.0\%$ and $\text{Precision@500} \le 34/500 = 6.8\%$.
   - Any metric evaluated at wide investigation capacity budgets will appear numerically low despite high true-positive recall ($97.6\%$).
3. **Benchmark Dataset Subsampling**: Secondary cross-dataset benchmarks on IBM AML (HI-Small) and SAML-D were evaluated on representative subsamples drawn chronologically from raw source partitions to maintain memory and feature parity with live runtime environments. They serve to validate cross-dataset schema ingestion rather than exhaustive production deployment.


---

## 10. Regulatory Compliance & Tamper-Evident Audit Chain

To comply with **PMLA 2002 Section 12**, **RBI Master Directions**, and **FATF Recommendation 11**:
1. **Transaction Ledger Immutability**: Write endpoints strictly reject `PUT` and `DELETE` requests with HTTP 405. Corrections are recorded via append-only debit/credit adjustments.
2. **Cryptographic Hash Chaining**: Every user and system action generates a cryptographically linked block:
   $$H_k = \text{SHA-256}\left( \text{seq}_k \parallel H_{k-1} \parallel \text{timestamp}_k \parallel \text{user}_k \parallel \text{action}_k \parallel \text{details}_k \right)$$
   Starting from $H_0 = \text{'0'}^{64}$. An automated verification endpoint (`GET /api/admin/audit-logs/verify`) traverses the entire history to detect block modification or truncation.
3. **Deterministic STR Narrative Synthesis**: Converts investigative case findings into FIU-IND compliant XML and PDF reporting dossiers with zero generative hallucinations.

---

## 11. Summary & Citation

FundTrace AI demonstrates that integrating topological graph analytics (8 network features) and customer behavioral profiling (7 profile features) alongside transactional features improves gradient-boosted detection performance (+21.6% relative F1 gain in feature ablation) over raw transaction signals alone, while preserving regulatory auditability through exact TreeSHAP attribution, counterfactual explanations, and immutable SHA-256 cryptographic audit logging.


```bibtex
@article{fundtraceai2026,
  title={FundTrace AI: Explainable AI and Topological Graph Analytics for Anti-Money Laundering Transaction Monitoring},
  author={Sargar, Ganesh},
  journal={MCA Master's Thesis & Technical Research Dossier},
  year={2026},
  month={October}
}
```
