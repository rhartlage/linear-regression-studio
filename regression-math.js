/* Browser-local ordinary least squares. No dependencies and no normal-equation solve. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RegressionMath = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPS = Number.EPSILON;
  var LOG_TWO_PI = Math.log(2 * Math.PI);

  function sum(values) {
    var total = 0, correction = 0;
    for (var i = 0; i < values.length; i++) {
      var next = total + values[i];
      correction += Math.abs(total) >= Math.abs(values[i])
        ? (total - next) + values[i] : (values[i] - next) + total;
      total = next;
    }
    return total + correction;
  }

  function dot(a, b) {
    var products = new Array(a.length);
    for (var i = 0; i < a.length; i++) products[i] = a[i] * b[i];
    return sum(products);
  }

  function norm(values) {
    var scale = 0, squares = 1;
    for (var i = 0; i < values.length; i++) {
      var value = Math.abs(values[i]);
      if (value !== 0) {
        if (scale < value) {
          squares = 1 + squares * (scale / value) * (scale / value);
          scale = value;
        } else squares += (value / scale) * (value / scale);
      }
    }
    return scale === 0 ? 0 : scale * Math.sqrt(squares);
  }

  // Subtract an anchor before summing to retain small variation on large offsets.
  function mean(values) {
    var anchor = values[0], differences = values.map(function (v) { return v - anchor; });
    var result = anchor + sum(differences.map(function (v) { return v / values.length; }));
    if (Number.isFinite(result)) return result;
    var scale = maxAbs(values);
    return scale === 0 ? 0 : sum(values.map(function (v) { return (v / scale) / values.length; })) * scale;
  }

  function finiteArray(values) {
    return Array.isArray(values) && values.every(function (v) { return typeof v === 'number' && Number.isFinite(v); });
  }

  function maxAbs(values) {
    var largest = 0;
    for (var i = 0; i < values.length; i++) largest = Math.max(largest, Math.abs(values[i]));
    return largest;
  }

  function logGamma(z) {
    var coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    var x = 0.99999999999980993;
    for (var i = 0; i < coefficients.length; i++) x += coefficients[i] / (z + i + 1);
    var t = z + coefficients.length - 0.5;
    return 0.5 * LOG_TWO_PI + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function betaFraction(a, b, x) {
    var tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 10000; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      var change = d * c;
      h *= change;
      if (Math.abs(change - 1) <= 8 * EPS) return h;
    }
    return NaN;
  }

  function regularizedBeta(x, a, b) {
    if (!(a > 0 && b > 0) || !Number.isFinite(a) || !Number.isFinite(b) ||
      typeof x !== 'number' || !(x >= 0 && x <= 1)) return NaN;
    if (x === 0 || x === 1) return x;
    var front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
    var value = x < (a + 1) / (a + b + 2)
      ? front * betaFraction(a, b, x) / a
      : 1 - front * betaFraction(b, a, 1 - x) / b;
    return Math.min(1, Math.max(0, value));
  }

  function studentTPValue(t, df) {
    if (!(df > 0) || !Number.isFinite(df) || typeof t !== 'number' || Number.isNaN(t)) return null;
    if (!Number.isFinite(t)) return 0;
    var ratio = Math.abs(t) / Math.sqrt(df);
    if (!Number.isFinite(ratio * ratio)) {
      return betaLowerLogX(-logOnePlusExp(2 * Math.log(Math.abs(t)) - Math.log(df)), df / 2, 0.5);
    }
    return regularizedBeta(1 / (1 + ratio * ratio), df / 2, 0.5);
  }

  function fPValue(f, df1, df2) {
    if (!(df1 > 0 && df2 > 0) || !Number.isFinite(df1) || !Number.isFinite(df2) || typeof f !== 'number' || !(f >= 0)) return null;
    if (f === Infinity) return 0;
    var ratio = (df1 / df2) * f;
    if (!Number.isFinite(ratio)) {
      return betaLowerLogX(-logOnePlusExp(Math.log(df1) + Math.log(f) - Math.log(df2)), df2 / 2, df1 / 2);
    }
    return regularizedBeta(1 / (1 + ratio), df2 / 2, df1 / 2);
  }

  function logOnePlusExp(value) {
    return value > 0 ? value + Math.log1p(Math.exp(-value)) : Math.log1p(Math.exp(value));
  }

  // A very small beta argument may underflow even when its fractional-power
  // probability is representable (for example, Cauchy t tails at t=1e155).
  function betaLowerLogX(logX, a, b) {
    var x = Math.exp(logX);
    var logValue = logGamma(a + b) - logGamma(a) - logGamma(b) + a * logX +
      b * Math.log1p(-x) + Math.log(betaFraction(a, b, x)) - Math.log(a);
    return Math.max(0, Math.min(1, Math.exp(logValue)));
  }

  function studentTQuantile(p, df) {
    if (!(df > 0) || !Number.isFinite(df) || typeof p !== 'number' || !(p >= 0 && p <= 1)) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    if (p === 0.5) return 0;
    var sign = p < 0.5 ? -1 : 1, tail = 2 * Math.min(p, 1 - p);
    var low = 0, high = 1;
    while (studentTPValue(high, df) > tail && high < Number.MAX_VALUE) {
      high = high > Number.MAX_VALUE / 2 ? Number.MAX_VALUE : high * 2;
    }
    if (studentTPValue(high, df) > tail) return sign * Infinity;
    for (var i = 0; i < 120; i++) {
      var middle = low + (high - low) / 2;
      if (studentTPValue(middle, df) > tail) low = middle;
      else high = middle;
    }
    return sign * (low + (high - low) / 2);
  }

  // Acklam's inverse normal approximation (absolute error about 1e-8 in ordinary tails).
  function normalQuantile(p) {
    if (typeof p !== 'number' || !(p >= 0 && p <= 1)) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.357751867269, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var q, r;
    if (p < 0.02425 || p > 0.97575) {
      q = Math.sqrt(-2 * (p < 0.5 ? Math.log(p) : Math.log1p(-p)));
      r = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < 0.5 ? r : -r;
    }
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // A is already column centered/scaled, including a unit-norm intercept column.
  // Householder QR recomputes pivot norms rather than downdating them near rank loss.
  function qrPivot(A, response, tolerance) {
    var n = A.length, k = A[0].length, matrix = A.map(function (row) { return row.slice(); });
    var transformed = response.slice(), permutation = Array.from({ length: k }, function (_, i) { return i; });
    var rank = 0;
    for (var j = 0; j < k; j++) {
      var best = j, bestNorm = -1;
      for (var c = j; c < k; c++) {
        var column = [];
        for (var i = j; i < n; i++) column.push(matrix[i][c]);
        var size = norm(column);
        if (size > bestNorm) { best = c; bestNorm = size; }
      }
      if (!(bestNorm > tolerance)) break;
      if (best !== j) {
        for (var row = 0; row < n; row++) {
          var saved = matrix[row][j]; matrix[row][j] = matrix[row][best]; matrix[row][best] = saved;
        }
        var oldIndex = permutation[j]; permutation[j] = permutation[best]; permutation[best] = oldIndex;
      }
      var vector = [];
      for (var r = j; r < n; r++) vector.push(matrix[r][j]);
      var alpha = vector[0] >= 0 ? -bestNorm : bestNorm;
      vector[0] -= alpha;
      var vectorNorm = norm(vector);
      vector = vector.map(function (v) { return v / vectorNorm; });
      for (var col = j; col < k; col++) {
        var elements = [];
        for (var rr = j; rr < n; rr++) elements.push(matrix[rr][col]);
        var projection = 2 * dot(vector, elements);
        for (var ri = j; ri < n; ri++) matrix[ri][col] -= projection * vector[ri - j];
      }
      var responseProjection = 2 * dot(vector, transformed.slice(j));
      for (var yrow = j; yrow < n; yrow++) transformed[yrow] -= responseProjection * vector[yrow - j];
      matrix[j][j] = alpha;
      for (var zero = j + 1; zero < n; zero++) matrix[zero][j] = 0;
      rank++;
    }
    if (rank < k) return { rank: rank, permutation: permutation };
    var beta = new Array(k).fill(0);
    for (var back = k - 1; back >= 0; back--) {
      var products = [];
      for (var upper = back + 1; upper < k; upper++) products.push(matrix[back][upper] * beta[upper]);
      beta[back] = (transformed[back] - sum(products)) / matrix[back][back];
    }
    // Triangular solves for R^-1, never an inverse of X'X.
    var inverse = Array.from({ length: k }, function () { return new Array(k).fill(0); });
    for (var basis = 0; basis < k; basis++) {
      for (var equation = k - 1; equation >= 0; equation--) {
        var contributions = [];
        for (var jj = equation + 1; jj < k; jj++) contributions.push(matrix[equation][jj] * inverse[jj][basis]);
        inverse[equation][basis] = ((equation === basis ? 1 : 0) - sum(contributions)) / matrix[equation][equation];
      }
    }
    var coefficients = new Array(k), inverseOriginal = new Array(k);
    for (var position = 0; position < k; position++) {
      coefficients[permutation[position]] = beta[position];
      inverseOriginal[permutation[position]] = inverse[position].slice();
    }
    var rNorm = 0, inverseNorm = 0;
    for (var ri2 = 0; ri2 < k; ri2++) {
      rNorm = Math.max(rNorm, sum(matrix[ri2].slice(ri2).map(Math.abs)));
      inverseNorm = Math.max(inverseNorm, sum(inverse[ri2].map(Math.abs)));
    }
    return { rank: rank, coefficients: coefficients, inverse: inverseOriginal, condition: rNorm * inverseNorm };
  }

  function termValue(row, term, means) {
    var value = 1;
    for (var i = 0; i < term.length; i++) value *= row[term[i]] - means[term[i]];
    return value;
  }

  function errorResult(message, n, k, rank, warnings) {
    return { ok: false, error: message, warnings: warnings || [], n: n || 0, k: k || 0, rank: rank || 0 };
  }

  function fit(X, y, terms, options) {
    var n = Array.isArray(y) ? y.length : 0;
    var k = Array.isArray(terms) ? terms.length + 1 : 0;
    try { return fitChecked(X, y, terms, options); }
    catch (error) { return errorResult('Cannot fit this model: ' + error.message, n, k, 0); }
  }

  function fitChecked(X, y, terms, options) {
    terms = terms === undefined ? [] : terms;
    options = options === undefined ? {} : options;
    var n = Array.isArray(y) ? y.length : 0, k = Array.isArray(terms) ? terms.length + 1 : 0;
    function fail(message, rank) { return errorResult(message, n, k, rank); }
    if (!Array.isArray(X) || !finiteArray(y) || n === 0 || X.length !== n) return fail('X and y must contain the same nonzero number of finite numeric rows.');
    if (!Array.isArray(X[0])) return fail('Each X row must be an array of predictor values.');
    var p = X[0].length;
    if (!X.every(function (row) { return finiteArray(row) && row.length === p; })) return fail('Predictor rows must have equal lengths and only finite numbers.');
    if (!Array.isArray(terms) || !terms.every(function (term) {
      return Array.isArray(term) && term.length > 0 && term.every(function (index) { return Number.isInteger(index) && index >= 0 && index < p; });
    })) return fail('Each model term must be a nonempty array of valid predictor indexes.');
    if (options === null || typeof options !== 'object') return fail('Model options must be an object.');
    if (options.center !== undefined && typeof options.center !== 'boolean') return fail('The center option must be true or false.');
    if (n < k) return fail('Not enough rows: this model needs at least ' + k + ' observations for its ' + k + ' coefficients.');
    var keys = terms.map(function (term) { return term.slice().sort(function (a, b) { return a - b; }).join(','); });
    if (new Set(keys).size !== terms.length) return fail('Duplicate terms make the model rank deficient. Remove repeated terms.');
    var centered = options.center !== false, means = new Array(p).fill(0);
    if (options.means !== undefined) {
      if (!centered || !finiteArray(options.means) || options.means.length !== p) return fail('Fixed means require center:true and one finite mean for each original predictor.');
      means = options.means.slice();
    } else if (centered) {
      for (var predictor = 0; predictor < p; predictor++) means[predictor] = mean(X.map(function (row) { return row[predictor]; }));
    }
    var rootN = Math.sqrt(n), design = Array.from({ length: n }, function () { return [1 / rootN]; });
    var termOffsets = [], termScales = [], termNorms = [];
    for (var j = 0; j < terms.length; j++) {
      var raw = X.map(function (row) { return termValue(row, terms[j], means); });
      if (!raw.every(Number.isFinite)) return fail('A model term exceeds numeric range. Rescale the original predictors or remove that term.');
      var offset = mean(raw), deviations = raw.map(function (v) { return v - offset; });
      if (!deviations.every(Number.isFinite)) return fail('Predictor variation exceeds numeric range. Rescale the original predictors.');
      var scale = maxAbs(deviations);
      if (scale === 0) return fail('The model is rank deficient: term ' + (j + 1) + ' is constant on these rows. Remove the constant or redundant term.');
      var normalized = deviations.map(function (v) { return v / scale; }), length = norm(normalized);
      termOffsets.push(offset); termScales.push(scale); termNorms.push(length);
      for (var rowIndex = 0; rowIndex < n; rowIndex++) design[rowIndex].push(normalized[rowIndex] / length);
    }
    var yMean = mean(y), yCentered = y.map(function (v) { return v - yMean; });
    if (!yCentered.every(Number.isFinite)) return fail('Response variation exceeds numeric range. Rescale the response.');
    var constantResponse = y.every(function (v) { return v === y[0]; });
    var yScale = maxAbs(yCentered) || 1, response = yCentered.map(function (v) { return v / yScale; });
    var rankTolerance = 32 * EPS * Math.max(n, k), qr = qrPivot(design, response, rankTolerance);
    if (qr.rank < k) return fail('The model is rank deficient or numerically indistinguishable from one. Remove redundant terms or collect more varied observations.', qr.rank);
    var warnings = [];
    if (qr.condition > 1e8) warnings.push('The model is poorly conditioned. Coefficients and t tests may be sensitive to small data changes.');
    var scaledPredictions = design.map(function (row) { return dot(row, qr.coefficients); });
    var scaledResiduals = response.map(function (v, i) { return v - scaledPredictions[i]; });
    var scaledSST = dot(response, response), scaledSSE = dot(scaledResiduals, scaledResiduals);
    // Only treat error at the floating-point rounding floor as a numerical perfect fit.
    var perfectThreshold = Math.pow(32 * EPS * Math.max(1, k), 2) * scaledSST;
    var perfectFit = !constantResponse && scaledSSE <= perfectThreshold;
    if (perfectFit) scaledSSE = 0;
    var dfError = n - k, dfRegression = k - 1, dfTotal = n - 1;
    if (dfError === 0) warnings.push('No residual degrees of freedom remain. The fitted values are available, but uncertainty estimates and significance tests are not.');
    if (constantResponse) warnings.push('The response is constant. R-squared and significance tests are undefined.');
    else if (perfectFit) warnings.push('The fit is exact within numerical precision. Zero standard errors and limiting test statistics do not provide ordinary uncertainty evidence.');
    var scaledSSR = Math.max(0, scaledSST - scaledSSE);
    var r2 = constantResponse ? null : Math.max(0, Math.min(1, 1 - scaledSSE / scaledSST));
    var adjustedR2 = constantResponse || dfError === 0 ? null : 1 - (scaledSSE / dfError) / (scaledSST / dfTotal);
    var residualSE = dfError > 0 ? Math.sqrt(scaledSSE / dfError) * yScale : null;
    var mse = residualSE === null ? null : residualSE * residualSE;
    var f = !constantResponse && dfError > 0 && dfRegression > 0
      ? (scaledSSE === 0 ? Infinity : (scaledSSR / dfRegression) / (scaledSSE / dfError)) : null;
    var overallP = f === null ? null : fPValue(f, dfRegression, dfError);
    var estimates = [0];
    for (var termIndex = 0; termIndex < terms.length; termIndex++) {
      estimates.push((qr.coefficients[termIndex + 1] / termNorms[termIndex]) * (yScale / termScales[termIndex]));
    }
    var anchorPrediction = yMean + (qr.coefficients[0] / rootN) * yScale;
    var interceptPieces = [anchorPrediction];
    for (var tt = 0; tt < terms.length; tt++) interceptPieces.push(-termOffsets[tt] * estimates[tt + 1]);
    estimates[0] = sum(interceptPieces);
    if (!estimates.every(Number.isFinite)) return fail('Coefficients exceed numeric range. Rescale the response or predictors before fitting.', qr.rank);
    var criticalT = dfError > 0 && !constantResponse ? studentTQuantile(0.975, dfError) : null;
    var interceptCovarianceRow = qr.inverse[0].map(function (v) { return v / rootN; });
    for (var cj = 0; cj < terms.length; cj++) {
      var multiplier = (termOffsets[cj] / termScales[cj]) / termNorms[cj];
      for (var cc = 0; cc < k; cc++) interceptCovarianceRow[cc] -= multiplier * qr.inverse[cj + 1][cc];
    }
    var responseNorm = norm(response), coefficientRoundingFactor = 32 * EPS * Math.max(1, k);
    var coefficients = estimates.map(function (estimate, index) {
      var se = null, t = null, coefficientP = null, ciLow = null, ciHigh = null;
      if (dfError > 0 && !constantResponse) {
        se = index === 0 ? residualSE * norm(interceptCovarianceRow)
          : (residualSE / termScales[index - 1]) * (norm(qr.inverse[index]) / termNorms[index - 1]);
        // An exact fit can still leave 1e-16-scale solver noise in a truly zero
        // coefficient. Do not turn that roundoff into infinite significance.
        var indistinguishableZero = perfectFit && (index === 0
          ? Math.abs(estimate) <= coefficientRoundingFactor * (Math.abs(yMean) + yScale * responseNorm * norm(interceptCovarianceRow))
          : Math.abs(qr.coefficients[index]) <= coefficientRoundingFactor * responseNorm * norm(qr.inverse[index]));
        if (se > 0) { t = estimate / se; coefficientP = studentTPValue(t, dfError); }
        else if (estimate !== 0 && !indistinguishableZero) { t = estimate > 0 ? Infinity : -Infinity; coefficientP = 0; }
        ciLow = estimate - criticalT * se;
        ciHigh = estimate + criticalT * se;
      }
      return { estimate: estimate, se: se, t: t, p: coefficientP, ciLow: ciLow, ciHigh: ciHigh,
        vif: index === 0 ? null : Math.max(1, dot(qr.inverse[index], qr.inverse[index])) };
    });
    if (coefficients.some(function (coefficient) { return coefficient.vif !== null && coefficient.vif > 10; })) {
      warnings.push('At least one term has VIF above 10. Collinearity inflates coefficient uncertainty; interpret individual t tests with care.');
    }
    var leverage = design.map(function (row) {
      var transformedRow = new Array(k).fill(0);
      for (var col = 0; col < k; col++) {
        var products = [];
        for (var term = 0; term < k; term++) products.push(row[term] * qr.inverse[term][col]);
        transformedRow[col] = sum(products);
      }
      return Math.max(0, Math.min(1, dot(transformedRow, transformedRow)));
    });
    var predictions = scaledPredictions.map(function (v) { return yMean + v * yScale; });
    var residuals = scaledResiduals.map(function (v) { return v * yScale; });
    var sse = Math.pow(Math.sqrt(scaledSSE) * yScale, 2);
    var sst = Math.pow(Math.sqrt(scaledSST) * yScale, 2);
    var ssr = Math.pow(Math.sqrt(scaledSSR) * yScale, 2);
    if (![sse, sst, ssr, mse].every(function (v) { return v === null || Number.isFinite(v); })) warnings.push('Some sums of squares exceed numeric range. Scaled calculations still provide R-squared and test statistics; rescale the response for finite ANOVA sums.');
    var result = { ok: true, error: null, warnings: warnings, n: n, k: k, rank: qr.rank,
      means: means, centered: centered, terms: terms.map(function (term) { return term.slice(); }), coefficients: coefficients,
      predictions: predictions, residuals: residuals, leverage: leverage, sse: sse, sst: sst, ssr: ssr,
      r2: r2, adjustedR2: adjustedR2, mse: mse, residualSE: residualSE, dfRegression: dfRegression,
      dfError: dfError, dfTotal: dfTotal, f: f, p: overallP, condition: qr.condition,
      perfectFit: perfectFit, constantResponse: constantResponse,
      termOffsets: termOffsets, termScales: termScales, termNorms: termNorms,
      predictionModel: { coefficients: qr.coefficients.slice(), responseMean: yMean, responseScale: yScale } };
    Object.defineProperty(result, '_training', { value: {
      X: X.map(function (row) { return row.slice(); }), y: y.slice(), design: design, inverse: qr.inverse,
      scaledSSE: scaledSSE, responseScale: yScale, rankTolerance: rankTolerance
    }});
    return result;
  }

  function predict(model, xOriginal) {
    if (!model || !model.ok || !finiteArray(xOriginal) || xOriginal.length !== model.means.length) return null;
    var row = [1 / Math.sqrt(model.n)];
    for (var j = 0; j < model.terms.length; j++) {
      var raw = termValue(xOriginal, model.terms[j], model.means);
      row.push(((raw - model.termOffsets[j]) / model.termScales[j]) / model.termNorms[j]);
    }
    var prediction = model.predictionModel.responseMean + dot(row, model.predictionModel.coefficients) * model.predictionModel.responseScale;
    return Number.isFinite(prediction) ? prediction : null;
  }

  function qq(residuals) {
    if (!finiteArray(residuals)) return [];
    // Blom plotting positions: (rank - 3/8) / (n + 1/4), ranks 1..n.
    return residuals.map(function (residual, rowIndex) { return { residual: residual, rowIndex: rowIndex }; })
      .sort(function (a, b) { return a.residual - b.residual || a.rowIndex - b.rowIndex; })
      .map(function (point, index) {
        return { theoretical: normalQuantile((index + 1 - 0.375) / (residuals.length + 0.25)), residual: point.residual, rowIndex: point.rowIndex };
      });
  }

  function partialF(reduced, full) {
    var df1 = full && reduced ? full.k - reduced.k : null, df2 = full ? full.dfError : null;
    function fail(message) { return { ok: false, error: message, f: null, p: null, df1: df1, df2: df2 }; }
    if (!reduced || !full || !reduced.ok || !full.ok || !reduced._training || !full._training) return fail('Compare two successful models fitted in this session.');
    if (!(df1 > 0 && df2 > 0)) return fail('The full model must add at least one coefficient and retain residual degrees of freedom.');
    var r = reduced._training, f = full._training;
    if (reduced.n !== full.n || r.X[0].length !== f.X[0].length || !r.y.every(function (v, i) { return v === f.y[i]; }) ||
      !r.X.every(function (row, i) { return row.every(function (v, j) { return v === f.X[i][j]; }); })) return fail('Partial F comparisons require exactly the same original predictor and response rows in the same order.');
    // Verify nesting by projecting each reduced design column into the full column space.
    // This also permits equivalent nested models with different centering conventions.
    for (var column = 0; column < reduced.k; column++) {
      var target = r.design.map(function (row) { return row[column]; });
      var projectedFit = qrPivot(f.design, target, f.rankTolerance);
      var differences = target.map(function (v, i) { return v - dot(f.design[i], projectedFit.coefficients); });
      if (norm(differences) > Math.max(1e-10, 64 * EPS * full.n * full.k)) return fail('The reduced model is not nested in the full model.');
    }
    if (full.constantResponse) return fail('The response is constant, so the partial F test is undefined.');
    var reducedSSE = r.scaledSSE, fullSSE = f.scaledSSE;
    // Both fits use the same response rows, hence the same response scale.
    if (reducedSSE + 1e-12 * Math.max(1, reducedSSE, fullSSE) < fullSSE) return fail('The fitted sums of squares are inconsistent with a nested-model comparison.');
    var extra = Math.max(0, reducedSSE - fullSSE);
    if (fullSSE === 0 && extra === 0) return fail('Both models fit exactly. Their partial F test is undefined.');
    var statistic = fullSSE === 0 ? Infinity : (extra / df1) / (fullSSE / df2);
    return { ok: true, error: null, f: statistic, p: fPValue(statistic, df1, df2), df1: df1, df2: df2 };
  }

  return { fit: fit, predict: predict, qq: qq, partialF: partialF,
    studentTPValue: studentTPValue, studentTQuantile: studentTQuantile, fPValue: fPValue,
    normalQuantile: normalQuantile, regularizedBeta: regularizedBeta };
}));
