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

// How long a driver has to accept/decline a delivery offer before it's
// automatically returned to "pending" by the offer expiry sweep.
const OFFER_TIMEOUT_SECONDS = Number(process.env.OFFER_TIMEOUT_SECONDS) || 60;

module.exports = {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  DELIVERY_FEE_PER_MILE,
  CONTACT_REQUEST_NEEDS,
  OFFER_TIMEOUT_SECONDS,
};
