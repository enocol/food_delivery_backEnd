function toRfc3339Utc(value) {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

module.exports = {
  toRfc3339Utc,
};
