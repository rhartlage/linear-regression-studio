# Numerical regression verification

Run the committed reference suite without installing dependencies:

```sh
node --test regression.test.cjs
```

The oracle is generated **without importing any application code**. It uses
NumPy's LAPACK singular value decomposition of a column-scaled design matrix
for ordinary least squares, covariance, and leverage, plus SciPy's Student-t,
F, and normal distributions. The application uses a separate pivoted QR solver.

The committed JSON records generator versions, random seed, command, timestamp,
input observations, model terms, and expected outputs. Regenerate only when
Python, NumPy, and SciPy are already available:

```sh
python tests/generate-reference-fixtures.py
```

The original fixture environment was Python 3.12.10, NumPy 2.4.4, SciPy 1.17.1.
Runtime tests need Node's standard library only; there are no test packages.

Coverage includes coefficients, standard errors, t tests, 95% confidence
intervals, variance inflation factors, ANOVA, model summaries, predictions,
residuals, leverage, Q-Q points, distribution tails, and critical values.
Fixtures include single and multiple predictors, squares, two-way and three-way
interactions, centered and uncentered terms, mixed units, large offsets,
collinearity, small response units, and intercept-only models. Additional tests
exercise rank deficiency, saturated/constant/perfect fits, malformed input,
projection identities, and nested-model comparisons.

Stress checks also cover changing predictor/observation order, a common response
offset of 2^40, response units of 1e200, serializing a predictive model, and
true column-space nesting when centering differs. For enormous Student-t
statistics with one degree of freedom, the independent analytic Cauchy tail
`2 * atan(1 / abs(t)) / pi` checks probabilities as small as about 6.4e-201.
Perfect-fit tests distinguish meaningful nonzero coefficients from roundoff-sized
estimates of mathematically zero effects.

Tolerance is explicit in each fixture. Ordinary fixtures use relative 2e-8 and
absolute 2e-10. The deliberately ill-conditioned fixture uses relative 2e-5
and absolute 2e-7; the tiny-response fixture has an absolute floor of 1e-30.
Dedicated distribution-tail assertions use a 1e-300 absolute floor so a zero
probability cannot silently pass for a representable small probability.

These tests verify the numerical engine, not browser interaction, accessibility,
CSV parsing, visual layout, or the truth of statistical assumptions. Statistical
inference still assumes an appropriate linear model with independent,
homoscedastic errors; software cannot establish those assumptions from a fit.
