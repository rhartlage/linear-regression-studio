# Regression Workbench

Browser-local regression teaching app. The data/model builder supports imported numeric observations, simple and multiple regression, and manual model selection. The original line playground remains available in its own mode.

## Model-builder capabilities

- Local CSV/TSV import or paste from Excel with preview, clear excluded-row reporting, and fixed analysis rows throughout term selection.
- Seeded business examples, actual data scales, and an external slope/intercept comparison line for one-predictor models.
- Intercept-only forward starts, full-candidate backward starts, manual add/remove, suggestions, and undoable model history.
- Squares and two-/three-way interactions with strong hierarchy. Numeric predictors only; categorical encoding must be deliberate and external.
- Recalculated OLS coefficients, standard errors, t tests, 95% confidence intervals, VIF, ANOVA, R², adjusted R², and residual standard error.
- Observed/fitted, residual/fitted, residual/order, and normal probability (Q-Q) plots with textual summaries and observation-level results.
- Conditional model slices, prediction references, and a sensitivity tornado that includes interior quadratic turning points. The tornado is not a significance ranking.
- Explicit warnings for singularity, missing residual degrees of freedom, constant responses, perfect fits, unstable collinearity, selection bias, and extrapolation.

Formal inference always uses fitted least squares. Moving a comparison line does not change ANOVA or coefficient tests.

## Verification

`npm test` runs independent numerical fixtures and CSV/data tests. The reference generator in `tests/` uses NumPy LAPACK SVD and SciPy, not the production engine. See `tests/README.md` for provenance. `npm run check` checks JavaScript syntax.

`npm run test:ui` runs local headless Playwright tests. Supply `REGRESSION_PLAYWRIGHT_MODULE` (an installed module specifier or file URL) and `REGRESSION_CHROMIUM_PATH` if Playwright/Chromium are not on the default path. `REGRESSION_TEST_URL` optionally tests a composed/hosted candidate. `REGRESSION_SCREENSHOT_DIR` enables desktop/mobile screenshots. There are no runtime dependencies or build step.

The hosted shell must copy all five runtime files: `index.html`, `regression-math.js`, `workbench-data.js`, `workbench.js`, and `workbench.css`. Update the canonical source commit and file list together in `tool-sources.json`; integrate into the latest hosted shell, not an older release.

Students can:

- build or load datasets,
- drag a custom regression line and compare it to least squares,
- inspect residual plots, ANOVA values, and variance diagnostics,
- discuss extrapolation warnings and non-constant variance examples.
- reproduce a dataset from its seed and check a slope-direction prediction.

The app uses no accounts, analytics, external fonts, storage, or transmitted
student data. Graph results have live text equivalents and a print/static
fallback.

## Local use

Open `index.html` directly in a browser, or serve the folder with any static file server.

## Public site

Once GitHub Pages is enabled for this repository, the app will be available at:

`https://tools.benhartlage.com/linear-regression/`

Compatibility URL:

`https://rhartlage.github.io/linear-regression-studio/`
