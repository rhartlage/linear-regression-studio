# RegressionMath API

`regression-math.js` works as a classic local browser script (`globalThis.RegressionMath`) and as CommonJS (`require('./regression-math.js')`). It has no external assets, dependencies, storage, or network calls.

## Fit and predict

`fit(X, y, terms = [], options = {})` fits an intercept plus the supplied terms. X is an array of equal-length numeric predictor rows; y has the same number of finite numeric values. Terms are predictor-index arrays: `[0]`, `[0,0]`, `[0,1]`, `[0,1,2]`. Reordered duplicates are rejected. Empty terms fit the intercept-only model.

Predictors are centered **before** forming products by default. `options.center=false` disables predictor centering. `options.means=[...]` fixes the means for a family of models and requires centering to be enabled. For stepwise work, retain the same X/y rows and pass the initial fit's means for every model. Main-effect estimates therefore describe effects at those predictor means, and the intercept refers to original predictors equal to those means. With centering disabled the intercept refers to zero predictors. Internal term-column centering does not change the requested model or its reported coefficients.

A successful result includes `ok:true`, `error:null`, `warnings`, `n`, `k` (including the intercept), `rank`, `means`, `centered`, `terms`, `coefficients`, `predictions`, `residuals`, `leverage`, `sse`, `sst`, `ssr`, `r2`, `adjustedR2`, `mse`, `residualSE`, `dfRegression`, `dfError`, `dfTotal`, `f`, `p`, `condition`, `perfectFit`, and `constantResponse`. Coefficients are ordered intercept first, then exactly the provided terms. Each contains `estimate`, `se`, `t`, `p`, `ciLow`, `ciHigh`, and `vif`. The intercept's VIF is null. CIs are two-sided 95% intervals and coefficient p-values are two-sided t-test probabilities. Conditional VIF uses the actual generated term columns, controlling for all other terms and the intercept. `condition` is an infinity-norm condition estimate of the scaled triangular QR factor, not the condition number of raw X.

`predict(fit, xOriginal)` returns a predicted response from the original predictor row, regenerating centered interaction/polynomial terms. It returns null for invalid rows or nonfinite predictions. Retain `termOffsets`, `termScales`, `termNorms`, and `predictionModel` if serializing a fit for later prediction; these fields preserve accurate predictions even when the displayed intercept suffers cancellation at large offsets.

Invalid data, too few observations (`n < k`), rank deficiency, and unrepresentable term/coefficient magnitudes return `{ok:false,error,warnings,n,k,rank}` without throwing. Rank-deficient models are never silently reduced. Failed rank is informative when QR reaches rank detection; earlier validation failures report zero.

## Guardrails

- A full-rank fit with `n == k` is allowed. It has no residual degrees of freedom, so MSE, residual SE, adjusted R², coefficient inference, and F inference are null with a warning.
- Constant y is allowed. R², adjusted R², coefficient inference, and F inference are null with a warning. Fits and coefficients remain available.
- Exact fits within a strict floating-point rounding threshold have zero SSE, MSE, and coefficient SE when residual df exists. Nonzero coefficient t statistics are signed Infinity with p=0; coefficients indistinguishable from zero at scaled solver precision have null t/p. This avoids turning tiny rounding errors into false significance. The overall F is Infinity/p=0 when predictor terms exist. A warning explains that this degenerate inference is not ordinary uncertainty evidence. Residuals retain their small computed rounding error rather than being fabricated as zeros.
- Intercept-only fits have no regression F test (`f`/`p` null).
- Infinite ANOVA sums caused by extremely large response magnitudes produce a warning; dimensionless fit statistics are calculated on a scaled response. A nonfinite statistic should display as unavailable or infinity, never as an ordinary finite value.

Numerics use unit-norm column scaling and Householder QR with column pivoting, recomputing pivot norms. There is no normal-equation solve or inverse of X'X. Rank tolerance is `32 * Number.EPSILON * max(n,k)` on the normalized columns. Covariance and leverage come from triangular solves; the condition estimate warns above 1e8, and any term VIF above 10 produces a collinearity warning. Perfect-fit tolerance on scaled SSE is `(32 * EPS * max(1,k))² * scaledSST`. Internal response centering/scaling protects predictions and residual calculations when the response has a large common offset.

## Diagnostics and comparisons

`qq(residuals)` returns sorted `{theoretical,residual,rowIndex}` points. `rowIndex` is the original zero-based row index. Theoretical standard-normal quantiles use Blom positions `(rank - 3/8)/(n + 1/4)` for ranks 1 through n. Empty or invalid input returns an empty array. The inverse-normal approximation is Acklam's (about 1e-8 absolute error in ordinary tails).

`partialF(reduced, full)` returns `{ok,error,f,p,df1,df2}`. Both arguments must be successful live fit objects from this session; saved/reloaded fits can predict but must be refitted for comparisons. It verifies identical original X/y rows and order, increasing model size, positive full-model residual df, and nested design-column spaces. It returns null F/p plus an explanatory error on invalid comparisons, constant response, or two exact fits. An exact full fit versus an inexact reduced fit has Infinity/p=0. This is a **partial** F test, not a sequential Type-I ANOVA contribution.

Distribution helpers are `studentTPValue(t,df)`, `studentTQuantile(probability,df)`, `fPValue(f,df1,df2)`, `normalQuantile(probability)`, and `regularizedBeta(x,a,b)`. t/F probabilities use regularized incomplete beta and evaluate the upper tail directly. Invalid p-value inputs return null; invalid quantile/beta inputs return NaN. These helpers are deterministic and dependency-free.
