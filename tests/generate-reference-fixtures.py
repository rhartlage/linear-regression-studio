"""Generate independent regression oracles. Runtime tests need only Node.

Uses NumPy's LAPACK SVD, not the application's QR implementation; SciPy's
Student-t/F/normal distributions supply inference and quantile references.
Run from the repository root: python tests/generate-reference-fixtures.py
"""

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform

import numpy as np
import scipy
from scipy import stats


def reference(name, X, y, terms, center=True, tolerance=None):
    X, y = np.asarray(X, dtype=float), np.asarray(y, dtype=float)
    n, p = X.shape
    means = np.array([math.fsum(X[:, j]) / n for j in range(p)]) if center else np.zeros(p)
    original = X - means
    columns = [np.ones(n)] + [np.prod(original[:, term], axis=1) for term in terms]
    design = np.column_stack(columns)
    k = design.shape[1]
    # Scale columns before SVD so independently chosen units do not destroy rank.
    scales = np.linalg.norm(design, axis=0)
    scaled = design / scales
    u, singular_values, vt = np.linalg.svd(scaled, full_matrices=False)
    assert np.linalg.matrix_rank(scaled) == k
    inverse = (vt.T / singular_values) @ u.T
    beta = (inverse @ y) / scales
    predictions = design @ beta
    residuals = y - predictions
    sse = float(residuals @ residuals)
    y_centered = y - math.fsum(y) / n
    sst = float(y_centered @ y_centered)
    ssr = sst - sse
    mse = sse / (n - k)
    covariance = (inverse @ inverse.T) / np.outer(scales, scales) * mse
    se = np.sqrt(np.diag(covariance))
    t_values = beta / se
    p_values = 2 * stats.t.sf(np.abs(t_values), n - k)
    critical = stats.t.ppf(0.975, n - k)
    f = (ssr / (k - 1)) / mse if k > 1 else None
    f_p = float(stats.f.sf(f, k - 1, n - k)) if k > 1 else None
    vifs = [None]
    for j in range(1, k):
        target = design[:, j]
        others = np.delete(design, j, axis=1)
        other_scales = np.linalg.norm(others, axis=0)
        nuisance_beta = np.linalg.lstsq(others / other_scales, target, rcond=None)[0]
        nuisance_residual = target - (others / other_scales) @ nuisance_beta
        total = target - math.fsum(target) / n
        vifs.append(float((total @ total) / (nuisance_residual @ nuisance_residual)))
    result = {
        "n": n, "k": k, "rank": k, "means": means.tolist(),
        "coefficients": [{"estimate": float(beta[j]), "se": float(se[j]),
                          "t": float(t_values[j]), "p": float(p_values[j]),
                          "ciLow": float(beta[j] - critical * se[j]),
                          "ciHigh": float(beta[j] + critical * se[j]),
                          "vif": vifs[j]} for j in range(k)],
        "predictions": predictions.tolist(), "residuals": residuals.tolist(),
        "leverage": np.sum(u * u, axis=1).tolist(),
        "sse": sse, "sst": sst, "ssr": ssr,
        "r2": 1 - sse / sst,
        "adjustedR2": 1 - (sse / (n - k)) / (sst / (n - 1)),
        "mse": mse, "residualSE": math.sqrt(mse),
        "dfRegression": k - 1, "dfError": n - k, "dfTotal": n - 1,
        "f": f, "p": f_p,
    }
    return {"name": name, "X": X.tolist(), "y": y.tolist(), "terms": terms,
            "options": {"center": center}, "expected": result,
            "tolerance": tolerance or {"relative": 2e-8, "absolute": 2e-10}}


rng = np.random.default_rng(20261110)
fixtures = []
fixtures.append(reference("simple_nontrivial", [[x] for x in [-4, -2, -1, 0, 1, 2, 4, 7, 8, 10]],
                          [-7.1, -3, -0.8, 2.1, 1.4, 5.2, 10.3, 15.1, 17.8, 22.3], [[0]]))

X = rng.normal(size=(40, 3)) * [2, 4, 0.5] + [5, -2, 7]
y = 4 + X @ [1.2, -0.8, 2.4] + rng.normal(0, 1.1, 40)
fixtures.append(reference("multiple_three_predictors", X, y, [[0], [1], [2]]))

X = rng.uniform(-4, 5, size=(42, 2)) + [11, -7]
Z = X - X.mean(axis=0)
y = 8 + 1.4 * Z[:, 0] - 0.7 * Z[:, 1] + 0.8 * Z[:, 0] ** 2 - 0.3 * Z[:, 1] ** 2 + 0.5 * Z[:, 0] * Z[:, 1] + rng.normal(0, 1.8, 42)
terms = [[0], [1], [0, 0], [1, 1], [0, 1]]
fixtures.append(reference("quadratic_and_interaction", X, y, terms))
fixtures.append(reference("uncentered_quadratic_and_interaction", X, y, terms, center=False))

X = rng.uniform(-2, 2, size=(48, 3)) + [1, -3, 5]
Z = X - X.mean(axis=0)
y = 3 + Z @ [1.5, -0.8, 0.3] + 0.9 * Z[:, 0] * Z[:, 1] - 0.4 * Z[:, 0] * Z[:, 2] + 0.7 * Z[:, 1] * Z[:, 2] - 1.2 * Z.prod(axis=1) + rng.normal(0, 0.8, 48)
fixtures.append(reference("hierarchical_three_way", X, y, [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]))

Z = rng.normal(size=(36, 3))
X = Z * [1e9, 1e-9, 1e3]
y = 12 + Z @ [1.4, -2.5, 0.9] + rng.normal(0, 0.5, 36)
fixtures.append(reference("different_predictor_scales", X, y, [[0], [1], [2]]))

X = np.array([[2 ** 40 + i, 2 ** 35 + ((i * 7) % 19)] for i in range(32)], dtype=float)
Z = X - X.mean(axis=0)
y = 6 + Z @ [0.4, -0.8] + np.array([((i * 13) % 11 - 5) / 8 for i in range(32)])
fixtures.append(reference("large_predictor_offsets", X, y, [[0], [1], [0, 1]]))

x = rng.normal(size=48)
X = np.column_stack([x, x + 1e-5 * rng.normal(size=48), rng.normal(size=48)])
y = 4 + X @ [3, -2, 0.3] + rng.normal(0, 0.4, 48)
fixtures.append(reference("near_collinear_predictors", X, y, [[0], [1], [2]],
                          tolerance={"relative": 2e-5, "absolute": 2e-7}))

fixtures.append(reference("intercept_only", np.empty((9, 0)), [4, 7, 2, 9, 8, 3, 6, 1, 5], []))
fixtures.append(reference("three_observations", [[-1], [0], [2]], [0, 2, 3], [[0]]))
fixtures.append(reference("zero_slope", [[-3], [-2], [-1], [0], [1], [2], [3]], [4, 2, 1, 3, 1, 2, 4], [[0]]))

X = rng.normal(size=(24, 2))
y = (4 + X @ [0.6, -1.4] + rng.normal(0, 0.4, 24)) * 1e-9
fixtures.append(reference("tiny_response_units", X, y, [[0], [1]],
                          tolerance={"relative": 2e-8, "absolute": 1e-30}))

tail_cases = [{"df": df, "t": t, "p": float(2 * stats.t.sf(abs(t), df))}
              for df in [1, 2, 5, 30, 1000] for t in [0, 0.1, 1, 2, 8, 30, 100]]
normal_cases = [{"p": p, "q": float(stats.norm.ppf(p))}
                for p in [1e-9, 1e-6, 0.001, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999, 1 - 1e-6, 1 - 1e-9]]
f_cases = [{"df1": df1, "df2": df2, "f": f, "p": float(stats.f.sf(f, df1, df2))}
           for df1, df2 in [(1, 1), (1, 30), (3, 12), (10, 1000)] for f in [0, 0.1, 1, 10, 1000]]
t_quantiles = [{"df": df, "p": p, "q": float(stats.t.ppf(p, df))}
               for df in [1, 2, 5, 30, 1000] for p in [0.001, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999]]
qq_residuals = [2.5, -1, 0, 7, -4, 0.5]
qq_order = np.argsort(qq_residuals, kind="stable")
qq_points = [{"theoretical": float(stats.norm.ppf((i + 1 - 0.375) / (len(qq_residuals) + 0.25))),
              "residual": qq_residuals[int(row)], "rowIndex": int(row)} for i, row in enumerate(qq_order)]

output = {
    "provenance": {
        "generatedUtc": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
        "seed": 20261110,
        "method": "Independent NumPy LAPACK SVD of column-scaled design; scipy.stats.t/f/norm; no application code imported.",
        "confidenceLevel": 0.95,
        "command": "python tests/generate-reference-fixtures.py",
    },
    "fits": fixtures,
    "studentTTails": tail_cases,
    "normalQuantiles": normal_cases,
    "fTails": f_cases,
    "studentTQuantiles": t_quantiles,
    "qq": {"residuals": qq_residuals, "points": qq_points},
}
destination = Path(__file__).with_name("reference-fixtures.json")
destination.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
print(f"Wrote {len(fixtures)} independent fits, {len(tail_cases)} t tails, {len(f_cases)} F tails, {len(normal_cases)} normal quantiles, {len(t_quantiles)} t quantiles, and QQ points to {destination}")
