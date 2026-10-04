const pool = require("../config/db");
const { withSchemaVersion } = require("../utils/eventPayload");
const { OFFER_TIMEOUT_SECONDS } = require("../utils/constants");

const SWEEP_INTERVAL_MS = 15_000;

// Expires a single offer if it's still actually stale at the moment we get
// the row lock — a concurrent accept/decline/reassign may have already
// resolved it since the sweep's initial scan.
async function expireOneOffer(orderId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deliveryResult = await client.query(
      `
      SELECT status, offered_driver_firebase_uid, offered_at
      FROM deliveries
      WHERE order_id = $1
      FOR UPDATE
      `,
      [orderId],
    );

    const delivery = deliveryResult.rows[0];
    if (
      !delivery ||
      delivery.status !== "offered" ||
      !delivery.offered_driver_firebase_uid
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    const offerAgeSeconds =
      (Date.now() - new Date(delivery.offered_at).getTime()) / 1000;
    if (offerAgeSeconds < OFFER_TIMEOUT_SECONDS) {
      await client.query("ROLLBACK");
      return null;
    }

    const driverFirebaseUid = delivery.offered_driver_firebase_uid;

    await client.query(
      `
      UPDATE deliveries
      SET
        status = 'pending',
        offered_driver_firebase_uid = NULL,
        offered_at = NULL,
        updated_at = NOW()
      WHERE order_id = $1
      `,
      [orderId],
    );

    await client.query(
      `
      UPDATE delivery_offers
      SET responded_at = NOW(), response = 'expired'
      WHERE order_id = $1
        AND driver_firebase_uid = $2
        AND responded_at IS NULL
      `,
      [orderId, driverFirebaseUid],
    );

    await client.query(
      `UPDATE drivers SET status = 'Online' WHERE firebase_uid = $1`,
      [driverFirebaseUid],
    );

    await client.query("COMMIT");
    return driverFirebaseUid;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      `Offer expiry sweep failed to expire order ${orderId}:`,
      error.message,
    );
    return null;
  } finally {
    client.release();
  }
}

async function sweepExpiredOffers(io) {
  let staleOrderIds;
  try {
    const result = await pool.query(
      `
      SELECT order_id
      FROM deliveries
      WHERE status = 'offered'
        AND offered_at < NOW() - make_interval(secs => $1)
      `,
      [OFFER_TIMEOUT_SECONDS],
    );
    staleOrderIds = result.rows.map((row) => row.order_id);
  } catch (error) {
    console.error(
      "Offer expiry sweep failed to query stale offers:",
      error.message,
    );
    return;
  }

  for (const orderId of staleOrderIds) {
    const expiredDriverFirebaseUid = await expireOneOffer(orderId);
    if (!expiredDriverFirebaseUid) {
      continue;
    }

    console.log(
      `Delivery offer expired for order ${orderId} (driver ${expiredDriverFirebaseUid})`,
    );

    if (io) {
      const payload = withSchemaVersion({
        orderId,
        driverFirebaseUid: expiredDriverFirebaseUid,
        timestamp: new Date().toISOString(),
      });
      io.to(`driver:${expiredDriverFirebaseUid}`).emit(
        "delivery_offer_expired",
        payload,
      );
      io.to("admin").emit("delivery_offer_expired", payload);
    }
  }
}

function startOfferExpirySweep(io) {
  const timer = setInterval(() => {
    sweepExpiredOffers(io).catch((error) => {
      console.error("Offer expiry sweep crashed:", error.message);
    });
  }, SWEEP_INTERVAL_MS);

  // Don't let this background timer keep the process alive on its own.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

module.exports = { startOfferExpirySweep, sweepExpiredOffers };
