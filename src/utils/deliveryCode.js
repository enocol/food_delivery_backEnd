const { randomInt } = require("crypto");

const DELIVERY_CODE_LENGTH = 5;

// 5-digit numeric code the customer shares with the driver to confirm
// delivery. Zero-padded so it is always DELIVERY_CODE_LENGTH characters.
function generateDeliveryCode() {
  const max = 10 ** DELIVERY_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(DELIVERY_CODE_LENGTH, "0");
}

module.exports = {
  DELIVERY_CODE_LENGTH,
  generateDeliveryCode,
};
