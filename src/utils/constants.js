const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "driver_assigned",
  "picked_up",
  "ready_for_pickup",
  "on_the_way",
  "delivered",
  "cancelled",
];

const PAYMENT_METHODS = ["cash", "mtn-momo", "orange-mobile-money"];

module.exports = {
  ORDER_STATUSES,
  PAYMENT_METHODS,
};
