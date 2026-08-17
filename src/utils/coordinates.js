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

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineDistanceMiles(from, to) {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

module.exports = {
  parseCoordinateValue,
  toCoordinateStorageValue,
  haversineDistanceMiles,
};
