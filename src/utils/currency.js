function toCurrencyInt(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (!Number.isInteger(numericValue)) {
    return null;
  }

  return numericValue;
}

module.exports = {
  toCurrencyInt,
};
