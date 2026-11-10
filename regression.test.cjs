'use strict';

// Run: node --test regression.test.cjs
// Fixtures come from tests/generate-reference-fixtures.py, independently of this engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const math = require('./regression-math.js');
const reference = require('./tests/reference-fixtures.json');

function close(actual, expected, label, relative = 2e-8, absolute = 2e-10) {
  if (expected === null) {
    assert.equal(actual, null, `${label}: expected unavailable statistic`);
    return;
  }
  assert.equal(typeof actual, 'number', `${label}: expected a number, got ${actual}`);
  assert.ok(Number.isFinite(actual), `${label}: expected a finite number, got ${actual}`);
  const tolerance = absolute + relative * Math.abs(expected);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: actual=${actual}, expected=${expected}, error=${Math.abs(actual - expected)}, tolerance=${tolerance}`);
}

function vectorClose(actual, expected, label, relative, absolute) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  expected.forEach((value, index) => close(actual[index], value, `${label}[${index}]`, relative, absolute));
}

function successfulFit(X, y, terms, options) {
  const result = math.fit(X, y, terms, options);
  assert.equal(result.ok, true, `Fit failed: ${JSON.stringify(result)}`);
  return result;
}

function rejectsFit(X, y, terms, options) {
  const result = math.fit(X, y, terms, options);
  assert.equal(result.ok, false, 'Invalid/singular fit must not be presented as successful');
  assert.ok(result.error, 'Rejected fit must explain why');
}

for (const fixture of reference.fits) {
  const { name, X, y, terms, options, expected, tolerance } = fixture;
  const { relative, absolute } = tolerance;
  test(`${name}: coefficients and 95% inference match independent SVD/SciPy`, () => {
    const fit = successfulFit(X, y, terms, options);
    assert.equal(fit.coefficients.length, expected.coefficients.length);
    expected.coefficients.forEach((coefficient, index) => {
      for (const field of ['estimate', 'se', 't', 'p', 'ciLow', 'ciHigh']) {
        close(fit.coefficients[index][field], coefficient[field], `${name}.beta[${index}].${field}`, relative, absolute);
      }
      if (index > 0) close(fit.coefficients[index].vif, coefficient.vif, `${name}.VIF[${index}]`, relative, absolute);
    });
  });

  test(`${name}: ANOVA and model summary match independent SVD/SciPy`, () => {
    const fit = successfulFit(X, y, terms, options);
    for (const field of ['n', 'k', 'rank', 'dfRegression', 'dfError', 'dfTotal']) {
      assert.equal(fit[field], expected[field], `${name}.${field}`);
    }
    for (const field of ['sse', 'sst', 'ssr', 'r2', 'adjustedR2', 'mse', 'residualSE', 'f', 'p']) {
      close(fit[field], expected[field], `${name}.${field}`, relative, absolute);
    }
    vectorClose(fit.means, expected.means, `${name}.means`, relative, absolute);
  });

  test(`${name}: predictions, residuals, leverage match independent SVD`, () => {
    const fit = successfulFit(X, y, terms, options);
    for (const field of ['predictions', 'residuals', 'leverage']) {
      vectorClose(fit[field], expected[field], `${name}.${field}`, relative, absolute);
    }
    X.forEach((row, index) => close(math.predict(fit, row), expected.predictions[index], `${name}.predict[${index}]`, relative, absolute));
  });

  test(`${name}: OLS projection identities and input immutability`, () => {
    const snapshot = JSON.stringify({ X, y, terms, options });
    const fit = successfulFit(X, y, terms, options);
    assert.equal(JSON.stringify({ X, y, terms, options }), snapshot, 'fit may not mutate caller-owned data');
    const sum = values => values.reduce((a, b) => a + b, 0);
    close(sum(fit.leverage), fit.k, 'trace(H)=rank', 1e-8, 1e-8);
    assert.ok(fit.leverage.every(h => h >= -1e-12 && h <= 1 + 1e-10), 'Leverage is in [0,1]');
    const responseScale = Math.max(...y.map(Math.abs), Number.MIN_VALUE);
    close(sum(fit.residuals), 0, 'residuals sum to zero', 0, responseScale * y.length * 1e-7);
    close(fit.ssr + fit.sse, fit.sst, 'ANOVA sum of squares identity', relative, absolute);
    close(fit.sse, sum(fit.residuals.map(r => r * r)), 'SSE is residual norm squared', relative, absolute);
    for (const term of terms) {
      const column = X.map(row => term.reduce((product, j) => product * (row[j] - fit.means[j]), 1));
      const cross = sum(column.map((value, i) => value * fit.residuals[i]));
      const bound = Math.sqrt(sum(column.map(value => value * value)) * fit.sse);
      close(cross, 0, 'residuals orthogonal to design', 0, Math.max(Number.MIN_VALUE, bound * 5e-7));
    }
  });
}

test('Browser global exposes same public API without dependencies', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'regression-math.js'), 'utf8'), sandbox);
  assert.ok(sandbox.RegressionMath, 'RegressionMath browser global');
  for (const name of ['fit', 'predict', 'qq', 'partialF']) assert.equal(typeof sandbox.RegressionMath[name], 'function', name);
});

test('Centering defaults to original means before expanding nonlinear terms', () => {
  const X = [[10, 5], [11, 9], [12, 6], [14, 11], [16, 8], [18, 2], [20, 4], [23, 7]];
  const y = [1, 2, 4, 8, 7, 6, 11, 8];
  const terms = [[0], [1], [0, 0], [0, 1]];
  const fit = successfulFit(X, y, terms);
  const explicit = successfulFit(X, y, terms, { center: true });
  vectorClose(fit.means, [15.5, 6.5], 'default means');
  vectorClose(fit.predictions, explicit.predictions, 'default centering');
  const x = [21, 3];
  const z = x.map((value, index) => value - fit.means[index]);
  const expected = fit.coefficients[0].estimate + terms.reduce((total, term, index) =>
    total + fit.coefficients[index + 1].estimate * term.reduce((product, j) => product * z[j], 1), 0);
  close(math.predict(fit, x), expected, 'original-unit prediction applies centering once');
});

test('Supplied centering means are preserved for cross-validation/prediction', () => {
  const source = reference.fits.find(f => f.name === 'quadratic_and_interaction');
  const means = [10, -6];
  const fixed = successfulFit(source.X, source.y, source.terms, { center: true, means });
  const automatic = successfulFit(source.X, source.y, source.terms);
  vectorClose(fixed.means, means, 'fixed means');
  vectorClose(fixed.predictions, automatic.predictions, 'full quadratic basis is centering invariant');
  close(math.predict(fixed, [8, -4]), math.predict(automatic, [8, -4]), 'out-of-sample centered prediction');
});

test('Center=false uses zero centers, and polynomial predictions remain invariant', () => {
  const source = reference.fits.find(f => f.name === 'quadratic_and_interaction');
  const centered = successfulFit(source.X, source.y, source.terms);
  const uncentered = successfulFit(source.X, source.y, source.terms, { center: false });
  vectorClose(uncentered.means, [0, 0], 'uncentered means');
  vectorClose(centered.predictions, uncentered.predictions, 'same full polynomial column space');
  close(centered.sse, uncentered.sse, 'centering invariant SSE');
});

test('Strong collinearity is disclosed, not silently treated as well conditioned', () => {
  const source = reference.fits.find(f => f.name === 'near_collinear_predictors');
  const fit = successfulFit(source.X, source.y, source.terms);
  assert.ok(fit.coefficients.slice(1).some(c => c.vif > 1e8));
  assert.ok(Array.isArray(fit.warnings) && fit.warnings.length > 0, 'Collinearity warning is required');
});

test('One added term has partial F = t squared, including tail probability', () => {
  const source = reference.fits.find(f => f.name === 'quadratic_and_interaction');
  const full = successfulFit(source.X, source.y, source.terms);
  const reduced = successfulFit(source.X, source.y, source.terms.slice(0, -1));
  const comparison = math.partialF(reduced, full);
  const last = full.coefficients.at(-1);
  close(comparison.f, last.t ** 2, 'partial F = t squared', 1e-9, 1e-10);
  close(comparison.p, last.p, 'partial F p = two-sided t p', 1e-7, 1e-100);
  assert.equal(comparison.df1, 1);
  assert.equal(comparison.df2, full.dfError);
});

test('Multiple added terms use correct partial F numerator/denominator df', () => {
  const source = reference.fits.find(f => f.name === 'hierarchical_three_way');
  const full = successfulFit(source.X, source.y, source.terms);
  const reduced = successfulFit(source.X, source.y, [[0], [1], [2]]);
  const comparison = math.partialF(reduced, full);
  const expected = ((reduced.sse - full.sse) / 4) / full.mse;
  close(comparison.f, expected, '4-term partial F');
  assert.equal(comparison.df1, 4);
  assert.equal(comparison.df2, full.dfError);
  close(comparison.p, math.fPValue(expected, 4, full.dfError), '4-term partial F tail', 1e-8, 1e-100);
});

test('Adding independent terms never increases SSE', () => {
  const source = reference.fits.find(f => f.name === 'hierarchical_three_way');
  let previous = Infinity;
  for (let count = 0; count <= source.terms.length; count++) {
    const fit = successfulFit(source.X, source.y, source.terms.slice(0, count));
    assert.ok(fit.sse <= previous + 1e-9, `SSE increased at ${count} terms`);
    previous = fit.sse;
  }
});

test('Reordering terms changes display order, not fit or coefficient inference', () => {
  const source = reference.fits.find(f => f.name === 'hierarchical_three_way');
  const ordinary = successfulFit(source.X, source.y, source.terms);
  const order = [6, 3, 0, 5, 1, 4, 2];
  const reordered = successfulFit(source.X, source.y, order.map(i => source.terms[i]));
  vectorClose(reordered.predictions, ordinary.predictions, 'term permutation predictions');
  order.forEach((originalIndex, newIndex) => {
    for (const field of ['estimate', 'se', 't', 'p', 'ciLow', 'ciHigh', 'vif']) {
      close(reordered.coefficients[newIndex + 1][field], ordinary.coefficients[originalIndex + 1][field], `term permutation ${field}`);
    }
  });
});

test('Reordering observation rows preserves estimates and reorders diagnostics', () => {
  const source = reference.fits.find(f => f.name === 'quadratic_and_interaction');
  const ordinary = successfulFit(source.X, source.y, source.terms);
  const reversed = successfulFit(source.X.slice().reverse(), source.y.slice().reverse(), source.terms);
  ordinary.coefficients.forEach((coefficient, i) => close(reversed.coefficients[i].estimate, coefficient.estimate, 'row permutation estimate'));
  for (const field of ['predictions', 'residuals', 'leverage']) vectorClose(reversed[field].slice().reverse(), ordinary[field], `row permutation ${field}`);
});

test('Large common response offset preserves residual variation and slope inference', () => {
  const X = Array.from({ length: 24 }, (_, i) => [i - 12, (i * 7) % 11]);
  const y = X.map(([x, z], i) => 3 + 2 * x - 0.5 * z + (i % 5) / 4);
  const ordinary = successfulFit(X, y, [[0], [1]]);
  const shifted = successfulFit(X, y.map(value => value + 2 ** 40), [[0], [1]]);
  for (const field of ['sse', 'r2', 'f', 'p', 'residualSE']) close(shifted[field], ordinary[field], `response offset ${field}`, 1e-7, 1e-10);
  vectorClose(shifted.residuals, ordinary.residuals, 'response offset residuals', 1e-7, 1e-8);
  for (const i of [1, 2]) {
    for (const field of ['estimate', 'se', 't', 'p']) close(shifted.coefficients[i][field], ordinary.coefficients[i][field], `response offset beta ${field}`, 1e-7, 1e-10);
  }
});

test('Very large response units retain finite dimensionless inference and disclose overflow', () => {
  const source = reference.fits.find(f => f.name === 'simple_nontrivial');
  const ordinary = successfulFit(source.X, source.y, source.terms);
  const enlarged = successfulFit(source.X, source.y.map(value => value * 1e200), source.terms);
  close(enlarged.r2, ordinary.r2, 'large response R2');
  close(enlarged.f, ordinary.f, 'large response F');
  close(enlarged.p, ordinary.p, 'large response p', 1e-8, 1e-100);
  assert.ok(enlarged.warnings.length > 0, 'Unrepresentable sums must be disclosed');
  assert.ok(enlarged.predictions.every(Number.isFinite));
});

test('Serialization preserves original-unit prediction without leaking training rows', () => {
  const source = reference.fits.find(f => f.name === 'hierarchical_three_way');
  const fit = successfulFit(source.X, source.y, source.terms);
  const copy = JSON.parse(JSON.stringify(fit));
  assert.equal(Object.hasOwn(copy, '_training'), false);
  close(math.predict(copy, [1.5, -2.2, 4.3]), math.predict(fit, [1.5, -2.2, 4.3]), 'serialized prediction');
});

test('Partial F refuses reversed or nonnested comparisons', () => {
  const source = reference.fits.find(f => f.name === 'multiple_three_predictors');
  const reduced = successfulFit(source.X, source.y, [[0]]);
  const full = successfulFit(source.X, source.y, [[0], [1]]);
  const other = successfulFit(source.X, source.y, [[2]]);
  for (const comparison of [math.partialF(full, reduced), math.partialF(other, full), math.partialF(full, full)]) {
    assert.ok(comparison == null || comparison.ok === false || comparison.f == null,
      'Invalid nested comparison must not expose fabricated F');
  }
});

test('Partial F refuses fits using different response observations', () => {
  const source = reference.fits.find(f => f.name === 'multiple_three_predictors');
  const reduced = successfulFit(source.X, source.y, [[0]]);
  const changed = successfulFit(source.X, source.y.map((y, i) => y + (i % 2)), [[0], [1]]);
  const comparison = math.partialF(reduced, changed);
  assert.ok(comparison == null || comparison.ok === false || comparison.f == null);
});

test('Partial F accepts different centering only when column spaces really are nested', () => {
  const source = reference.fits.find(f => f.name === 'quadratic_and_interaction');
  const reduced = successfulFit(source.X, source.y, [[0], [1]], { center: false });
  const centered = successfulFit(source.X, source.y, [[0], [1]]);
  const full = successfulFit(source.X, source.y, source.terms);
  const one = math.partialF(reduced, full);
  const two = math.partialF(centered, full);
  assert.equal(one.ok, true);
  close(one.f, two.f, 'centering-invariant partial F');
  close(one.p, two.p, 'centering-invariant partial F p', 1e-8, 1e-100);
  const squareOnly = successfulFit(source.X, source.y, [[0, 0]], { center: false });
  const centeredSquare = successfulFit(source.X, source.y, [[0, 0], [1, 1]]);
  const invalid = math.partialF(squareOnly, centeredSquare);
  assert.equal(invalid.ok, false, 'Matching labels alone do not establish polynomial nesting');
});

test('Constant predictor is rejected even with centering disabled', () => {
  rejectsFit([[1], [1], [1], [1]], [2, 3, 4, 5], [[0]]);
  rejectsFit([[1], [1], [1], [1]], [2, 3, 4, 5], [[0]], { center: false });
});

test('Duplicate predictors and duplicate terms are rejected', () => {
  rejectsFit([[1, 1], [2, 2], [3, 3], [4, 4]], [1, 3, 2, 6], [[0], [1]]);
  rejectsFit([[1], [2], [3], [4]], [1, 3, 2, 6], [[0], [0]]);
});

test('Permutation-equivalent interaction terms are rejected', () => {
  rejectsFit([[1, 3], [2, 4], [3, 1], [4, 2], [5, 6]], [1, 3, 2, 6, 8], [[0, 1], [1, 0]]);
});

test('More coefficients than observations are rejected', () => {
  rejectsFit([[1], [2]], [3, 7], [[0], [0, 0]]);
});

test('Numerically indistinguishable predictors are rejected rather than claiming precise inference', () => {
  const X = Array.from({ length: 20 }, (_, i) => [i, i + 1e-14 * (i % 3)]);
  rejectsFit(X, X.map(([x], i) => x + (i % 4)), [[0], [1]]);
});

test('Saturated full-rank fit warns and suppresses all inference', () => {
  const fit = successfulFit([[0], [1]], [2, 5], [[0]]);
  assert.equal(fit.dfError, 0);
  vectorClose(fit.predictions, [2, 5], 'saturated predictions');
  assert.ok(fit.warnings.length > 0);
  for (const field of ['mse', 'residualSE', 'adjustedR2', 'f', 'p']) assert.equal(fit[field], null, field);
  for (const coefficient of fit.coefficients) {
    for (const field of ['se', 't', 'p', 'ciLow', 'ciHigh']) assert.equal(coefficient[field], null, field);
  }
});

test('Constant response has no invented R squared or significance', () => {
  const fit = successfulFit([[-2], [-1], [0], [1], [2]], [5, 5, 5, 5, 5], [[0]]);
  vectorClose(fit.predictions, [5, 5, 5, 5, 5], 'constant predictions');
  assert.ok(fit.warnings.length > 0);
  for (const field of ['r2', 'adjustedR2', 'f', 'p']) assert.equal(fit[field], null, field);
  for (const coefficient of fit.coefficients) {
    for (const field of ['se', 't', 'p', 'ciLow', 'ciHigh']) assert.equal(coefficient[field], null, field);
  }
});

test('Exact nonconstant line gives perfect-fit limits rather than spurious tiny errors', () => {
  const fit = successfulFit([[-2], [-1], [0], [1], [2]], [-1, 1, 3, 5, 7], [[0]]);
  assert.equal(fit.sse, 0);
  assert.equal(fit.mse, 0);
  assert.equal(fit.residualSE, 0);
  assert.equal(fit.r2, 1);
  assert.equal(fit.f, Infinity);
  assert.equal(fit.p, 0);
  for (const coefficient of fit.coefficients) {
    assert.equal(coefficient.se, 0);
    assert.equal(coefficient.p, 0);
    assert.ok(!Number.isFinite(coefficient.t));
    close(coefficient.ciLow, coefficient.estimate, 'perfect-fit lower CI');
    close(coefficient.ciHigh, coefficient.estimate, 'perfect-fit upper CI');
  }
});

test('Zero coefficient in a perfect fit has undefined t/p, not false significance', () => {
  const fit = successfulFit([[-2], [-1], [0], [1], [2]], [-4, -2, 0, 2, 4], [[0]]);
  close(fit.coefficients[0].estimate, 0, 'zero intercept');
  assert.equal(fit.coefficients[0].t, null);
  assert.equal(fit.coefficients[0].p, null);
});

test('Roundoff-sized zero coefficients in a perfect fit do not claim significance', () => {
  const X = Array.from({ length: 12 }, (_, i) => [i - 5, (i * 7) % 5]);
  const y = X.map(([x]) => 3 + 2 * x);
  const fit = successfulFit(X, y, [[0], [1]]);
  assert.equal(fit.perfectFit, true);
  close(fit.coefficients[2].estimate, 0, 'irrelevant predictor estimate', 0, 1e-13);
  assert.equal(fit.coefficients[2].t, null, 'Rounding noise must not produce infinite significance');
  assert.equal(fit.coefficients[2].p, null, 'Rounding noise must not produce p=0');
});

test('Zero response is handled as constant rather than NaN contamination', () => {
  const fit = successfulFit([[-2], [-1], [0], [1], [2]], [0, 0, 0, 0, 0], [[0]]);
  vectorClose(fit.predictions, [0, 0, 0, 0, 0], 'zero response');
  assert.equal(fit.r2, null);
  assert.equal(fit.p, null);
});

test('Invalid inputs return actionable failures', () => {
  const cases = [
    [[], [], []],
    [[[1], [2], [3]], [1, 2], [[0]]],
    [[[1], [2, 3], [4]], [1, 2, 3], [[0]]],
    [[[1], [NaN], [3]], [1, 2, 3], [[0]]],
    [[[1], [2], [3]], [1, Infinity, 3], [[0]]],
    [[[1], [2], [3]], [1, 2, 3], [[1]]],
    [[[1], [2], [3]], [1, 2, 3], [[-1]]],
    [[[1], [2], [3]], [1, 2, 3], [[0.5]]],
    [[[1], [2], [3]], [1, 2, 3], [[]]],
  ];
  for (const args of cases) rejectsFit(...args);
});

test('Overflow in term expansion is rejected clearly', () => {
  rejectsFit([[1e200], [2e200], [-1e200], [-2e200]], [1, 3, 2, 5], [[0, 0]]);
});

test('Invalid original-unit prediction rows return unavailable rather than extrapolated garbage', () => {
  const source = reference.fits.find(f => f.name === 'multiple_three_predictors');
  const fit = successfulFit(source.X, source.y, source.terms);
  for (const row of [[], [1, 2], [1, 2, 3, 4], [1, NaN, 3], [1, Infinity, 3], ['1', 2, 3]]) assert.equal(math.predict(fit, row), null);
  assert.equal(math.predict({ ok: false }, [1, 2, 3]), null);
});

test('QQ points use independent Blom normal quantiles and retain observation rows', () => {
  const residuals = reference.qq.residuals.slice();
  const qq = math.qq(residuals);
  assert.equal(qq.length, residuals.length);
  qq.forEach((point, i) => {
    assert.equal(point.rowIndex, reference.qq.points[i].rowIndex);
    assert.equal(point.residual, residuals[point.rowIndex]);
    close(point.theoretical, reference.qq.points[i].theoretical, `QQ[${i}]`, 1e-8, 2e-9);
  });
  assert.deepEqual(residuals, [2.5, -1, 0, 7, -4, 0.5], 'qq may not mutate residual input');
  assert.deepEqual(math.qq([]), []);
});

test('Normal quantile matches SciPy across center and extreme tails', () => {
  for (const { p, q } of reference.normalQuantiles) close(math.normalQuantile(p), q, `normal(${p})`, 1e-8, 2e-9);
});

test('Two-sided Student t probabilities match SciPy, including df=1 and tiny tails', () => {
  for (const { df, t, p } of reference.studentTTails) {
    close(math.studentTPValue(t, df), p, `t(${t}, df=${df})`, 2e-8, 1e-300);
    close(math.studentTPValue(-t, df), p, `t(${-t}, df=${df})`, 2e-8, 1e-300);
  }
});

test('Representable extreme Cauchy tails do not vanish through intermediate overflow', () => {
  for (const t of [1e155, 1e160, 1e200]) {
    const expected = 2 * Math.atan(1 / t) / Math.PI;
    close(math.studentTPValue(t, 1), expected, `Cauchy tail ${t}`, 2e-8, 1e-300);
  }
});

test('F upper-tail probabilities match SciPy without 1-CDF cancellation', () => {
  for (const { df1, df2, f, p } of reference.fTails) close(math.fPValue(f, df1, df2), p, `F(${f},${df1},${df2})`, 2e-8, 1e-300);
});

test('Student t critical values invert tails and are symmetric', () => {
  for (const { df, p, q } of reference.studentTQuantiles) close(math.studentTQuantile(p, df), q, `t critical(${p},${df})`, 2e-8, 2e-9);
  for (const df of [1, 2, 5, 30, 1000]) {
    for (const p of [0.9, 0.975, 0.999]) {
      const q = math.studentTQuantile(p, df);
      close(math.studentTPValue(q, df), 2 * (1 - p), `t quantile inverse df=${df}`, 1e-7, 1e-12);
      close(math.studentTQuantile(1 - p, df), -q, `t quantile symmetry df=${df}`, 1e-8, 1e-9);
    }
  }
});

test('Distribution boundaries remain mathematically meaningful', () => {
  assert.equal(math.studentTPValue(0, 1), 1);
  assert.equal(math.studentTPValue(Infinity, 5), 0);
  assert.equal(math.fPValue(0, 2, 8), 1);
  assert.equal(math.fPValue(Infinity, 2, 8), 0);
  close(math.normalQuantile(0.5), 0, 'standard-normal median', 0, 1e-14);
  for (const df of [0, -1, NaN, Infinity]) {
    assert.equal(math.studentTPValue(2, df), null, 'Invalid t df');
    assert.equal(math.fPValue(2, df, 8), null, 'Invalid numerator df');
    assert.equal(math.fPValue(2, 2, df), null, 'Invalid denominator df');
  }
});
