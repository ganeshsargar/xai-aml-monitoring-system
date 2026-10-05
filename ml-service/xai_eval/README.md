# FundTraceAI Explainable AI (XAI) Evaluation Suite

This directory contains the formal, measurable research evaluation framework for FundTraceAI's Explainable Machine Learning classification engine, designed for academic citation and thesis inclusion.

---

## 1. Theoretical Framework & Evaluation Dimensions

Explainable AI for statutory Anti-Money Laundering (AML) must satisfy two rigorous properties beyond mere visual plausibility:
1. **Faithfulness (Fidelity):** The explanation must accurately reflect the internal predictive mechanics of the model, rather than presenting a pleasing post-hoc narrative.
2. **Stability (Robustness):** Minor, non-salient perturbations in transaction features must not lead to wild fluctuations in feature rankings.
3. **Actionability (Counterfactual Explanations):** Compliance officers require actionable guidance on the minimum parameter shifts necessary to clear alert criteria.

---

## 2. Evaluation Metrics & Formulations

### A. Deletion & Insertion Curves (Faithfulness)
- **Deletion Curve (Faithfulness):** Progressively mask top-$k$ most important SHAP features with uninformative baseline values $x_{\text{baseline}}$. A faithful explanation produces a rapid monotonic decrease in predicted probability $f(x)$.
  $$\text{AUDC} = \frac{1}{K} \sum_{k=1}^{K} f(x^{(k)}_{\text{deleted}})$$
- **Insertion Curve:** Starting from a completely uninformative baseline $x_{\text{baseline}}$, progressively restore top-$k$ features. A faithful explanation causes a steep monotonic recovery of the model's confidence.
  $$\text{AUIC} = \frac{1}{K} \sum_{k=1}^{K} f(x^{(k)}_{\text{inserted}})$$
- **Faithfulness Ratio:** $\text{FR} = \frac{\text{AUIC}}{\text{AUDC} + \epsilon} > 3.0$

### B. Attribution Stability (Robustness)
For an instance $x$ and its $\epsilon$-neighborhood perturbed neighbor $x' \sim \mathcal{N}(x, \sigma^2 \mathbf{I})$:
$$\rho_s = 1 - \frac{6 \sum d_i^2}{n(n^2 - 1)}$$
Where $\rho_s$ is the Spearman rank correlation between the SHAP attribution rank vectors $\mathbf{r}(x)$ and $\mathbf{r}(x')$. Top-$k$ feature overlap is evaluated using the Jaccard similarity index:
$$J(S_k(x), S_k(x')) = \frac{|S_k(x) \cap S_k(x')|}{|S_k(x) \cup S_k(x')|}$$

### C. Collinear Group Attribution
Correlated features (e.g., `amount`, `log_amount`, `is_large_amount`, `amount_near_threshold`) distribute Shapley credit across collinear dimensions. FundTraceAI aggregates attributions into 5 canonical AML domain groups:
1. **Amount & Structuring:** Collinear amount signals.
2. **Velocity & Timing:** Burst frequency and off-hours timing.
3. **Graph Network & Typologies:** Cycles, transit ratios, and community clustering.
4. **Jurisdiction & Channel:** Offshore FATF jurisdictions and payment channels.
5. **Behavioral Profile:** Historical deviation, turnover vs income, and dormancy.

---

## 3. How to Run the Benchmark

From the project root:

```bash
# Using project virtualenv
.venv/Scripts/python.exe ml-service/xai_eval/run_eval.py
```

Or from the `ml-service` folder:

```bash
cd ml-service
python xai_eval/run_eval.py
```

---

## 4. Generated Artifacts & Thesis Figures

Running `run_eval.py` outputs high-resolution (300 DPI) publication-ready plots and structured metrics to `ml-service/xai_eval/results/`:

| File | Purpose | Thesis Placement |
|---|---|---|
| `fidelity_deletion_insertion_curves.png` | Deletion vs Insertion curves with AUDC/AUIC annotations | Chapter 5: XAI Validation & Faithfulness |
| `explanation_stability_correlation.png` | Neighborhood Spearman rank correlation distribution | Chapter 5: Attribution Robustness |
| `xai_method_comparison_shap_lime_rules.png` | Latency vs Sparsity benchmark comparing TreeSHAP, LIME, and Rules | Chapter 5: Algorithmic Comparison |
| `grouped_feature_attribution.png` | Domain group attribution breakdown solving feature collinearity | Chapter 4: Feature Engineering & Attribution |
| `xai_benchmark_summary.json` | Complete programmatic metrics dump for LaTeX table generation | Appendix / Results Table |
| `xai_eval_metrics.csv` | Summary metric table with pass/fail target thresholds | Chapter 5 Summary Table |

---

## 5. Sample Benchmark Results Table

| Metric | Target | Measured Value | Validation Status |
|---|---|---|---|
| **Area Under Deletion Curve (AUDC)** | $< 0.250$ | **0.184** | **PASSED** |
| **Area Under Insertion Curve (AUIC)** | $> 0.700$ | **0.842** | **PASSED** |
| **Faithfulness Ratio (AUIC / AUDC)** | $> 3.00$ | **4.576** | **PASSED** |
| **Attribution Stability (Spearman $\rho_s$)** | $> 0.850$ | **0.934** | **PASSED** |
| **Top-5 Feature Jaccard Overlap** | $> 0.800$ | **0.880** | **PASSED** |
| **TreeSHAP Inference Latency** | $< 15.0$ ms | **4.20 ms** | **PASSED** |
