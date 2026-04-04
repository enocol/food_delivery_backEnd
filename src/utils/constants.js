const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "picked_up",
  "on_the_way",
  "delivered",
  "cancelled",
];

const PAYMENT_METHODS = ["cash", "mobile_money", "card"];

module.exports = {
  ORDER_STATUSES,
  PAYMENT_METHODS,
};
