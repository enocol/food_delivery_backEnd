function parseCoordinateValue(value) {
  if (value == null) return null;

  if (typeof value === "object") {
    const latitude = Number(
      value.latitude ??
        value.lat ??
        value.latitude_decimal ??
        value.lat_decimal,
    );
    const longitude = Number(
      value.longitude ??
        value.lng ??
        value.lon ??
        value.longitude_decimal ??
        value.lng_decimal,
    );

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return { latitude, longitude };
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      return parseCoordinateValue(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  const parts = trimmed.split(",");
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function toCoordinateStorageValue(value) {
  const coordinate = parseCoordinateValue(value);
  if (!coordinate) return null;

  return JSON.stringify(coordinate);
}

module.exports = {
  parseCoordinateValue,
  toCoordinateStorageValue,
};
