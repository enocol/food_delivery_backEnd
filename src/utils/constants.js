const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "picked_up",
  "ready_for_pickup",
  "on_the_way",
  "delivered",
  "cancelled",
];

const PAYMENT_METHODS = ["cash", "mtn-momo", "orange-mobile-money"];

const DELIVERY_FEE_PER_MILE = 500;

const CONTACT_REQUEST_NEEDS = [
  "New Product Build",
  "Existing System Upgrade",
  "Mobile Application",
  "Payment/Mobile Money Integration",
  "Support and Maintenance",
  "Something Else",
];

module.exports = {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  DELIVERY_FEE_PER_MILE,
  CONTACT_REQUEST_NEEDS,
};
