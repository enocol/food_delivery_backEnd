const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const pool = require("../config/db");
const {
  buildIdempotencyRequestHash,
  ensureIdempotencyTable,
} = require("../utils/idempotency");
const {
  parseCoordinateValue,
  toCoordinateStorageValue,
} = require("../utils/coordinates");
const { withSchemaVersion } = require("../utils/eventPayload");

const router = express.Router();

const DRIVER_STATUS_TRANSITIONS = {
  ready_for_pickup: ["picked_up"],
  picked_up: ["on_the_way"],
  on_the_way: ["delivered"],
};

// POST /api/drivers/session
// Called when a driver logs in. Upserts the driver row:
//   - Creates the row if the driver is new
//   - Ignores fields that have not changed
//   - Updates any field that has changed (phone, current_location, status, is_online)
router.post("/session", requireAuth, async (req, res, next) => {
  const firebase_uid = req.auth.user.firebase_uid;
  const { phone, current_location, status, is_online } = req.body;
  const storedCurrentLocation =
    current_location == null
      ? null
      : toCoordinateStorageValue(current_location) || current_location;

  try {
    const result = await pool.query(
      `
      INSERT INTO drivers (firebase_uid, phone, current_location, status, is_online)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (firebase_uid) DO UPDATE SET
        phone            = COALESCE(EXCLUDED.phone,            drivers.phone),
        current_location = COALESCE(EXCLUDED.current_location, drivers.current_location),
        status           = COALESCE(EXCLUDED.status,           drivers.status),
        is_online        = COALESCE(EXCLUDED.is_online,        drivers.is_online)
      RETURNING id, firebase_uid, phone, current_location, status, is_online
      `,
      [
        firebase_uid,
        phone ?? null,
        storedCurrentLocation,
        status ?? "Offline",
        is_online ?? false,
      ],
    );

    return res.status(200).json({
      driver: {
        ...result.rows[0],
        id: String(result.rows[0].id),
        current_location:
          parseCoordinateValue(result.rows[0].current_location) ??
          result.rows[0].current_location,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/drivers/deliveries/:orderId/accept
// Assigns the authenticated driver to a delivery if unassigned.
router.post(
  "/deliveries/:orderId/accept",
  requireAuth,
  async (req, res, next) => {
    const firebase_uid = req.auth.user.firebase_uid;
    const { orderId } = req.params;
    const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
    const idempotencyScope = "drivers.deliveries.accept";
    const requestHash = buildIdempotencyRequestHash({
      orderId,
      body: req.body || {},
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        await ensureIdempotencyTable(client);

        const existingRecordResult = await client.query(
          `
          SELECT request_hash, response_status, response_body
          FROM api_idempotency_records
          WHERE idempotency_key = $1
            AND scope = $2
            AND actor_id = $3
          LIMIT 1
          `,
          [idempotencyKey, idempotencyScope, firebase_uid],
        );

        if (existingRecordResult.rowCount > 0) {
          const existingRecord = existingRecordResult.rows[0];

          if (existingRecord.request_hash !== requestHash) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              message:
                "Idempotency-Key was already used with a different request payload",
            });
          }

          await client.query("ROLLBACK");
          return res
            .status(existingRecord.response_status)
            .json(existingRecord.response_body);
        }
      }

      const driverResult = await client.query(
        `
      SELECT firebase_uid, phone, current_location
      FROM drivers
      WHERE firebase_uid = $1
      `,
        [firebase_uid],
      );

      if (driverResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message:
            "Driver profile not found. Call POST /api/drivers/session first.",
        });
      }

      const orderResult = await client.query(
        `
      SELECT id, status
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
        [orderId],
      );

      if (orderResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Order not found" });
      }

      const currentOrderStatus = orderResult.rows[0].status;
      if (
        !["ready_for_pickup", "picked_up", "on_the_way"].includes(
          currentOrderStatus,
        )
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Order cannot be accepted at its current status",
        });
      }

      const seededEtaMinutes =
        currentOrderStatus === "ready_for_pickup"
          ? 15
          : currentOrderStatus === "picked_up"
            ? 8
            : 5;

      const deliveryResult = await client.query(
        `
      SELECT order_id, assigned_driver_firebase_uid
      FROM deliveries
      WHERE order_id = $1
      FOR UPDATE
      `,
        [orderId],
      );

      if (deliveryResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Delivery is not yet available for assignment",
        });
      }

      const assignedDriverUid =
        deliveryResult.rows[0].assigned_driver_firebase_uid;
      if (assignedDriverUid && assignedDriverUid !== firebase_uid) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Delivery is already assigned to another driver",
        });
      }

      await client.query(
        `
        UPDATE deliveries
        SET
          assigned_driver_firebase_uid = $2,
          rider_phone = COALESCE($3, rider_phone),
          current_location = COALESCE($4, current_location),
          eta_minutes = COALESCE(eta_minutes, $5),
          updated_at = NOW()
        WHERE order_id = $1
        `,
        [
          orderId,
          firebase_uid,
          driverResult.rows[0].phone,
          driverResult.rows[0].current_location,
          seededEtaMinutes,
        ],
      );

      const successResponse = {
        message: "Delivery accepted",
        orderId,
        assignedDriverFirebaseUid: firebase_uid,
      };

      if (idempotencyKey) {
        const insertIdempotencyResult = await client.query(
          `
          INSERT INTO api_idempotency_records (
            idempotency_key,
            scope,
            actor_id,
            request_hash,
            response_status,
            response_body
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          ON CONFLICT (idempotency_key, scope, actor_id)
          DO NOTHING
          `,
          [
            idempotencyKey,
            idempotencyScope,
            firebase_uid,
            requestHash,
            200,
            JSON.stringify(successResponse),
          ],
        );

        if (insertIdempotencyResult.rowCount === 0) {
          const existingRecordResult = await client.query(
            `
            SELECT request_hash, response_status, response_body
            FROM api_idempotency_records
            WHERE idempotency_key = $1
              AND scope = $2
              AND actor_id = $3
            LIMIT 1
            `,
            [idempotencyKey, idempotencyScope, firebase_uid],
          );

          if (existingRecordResult.rowCount > 0) {
            const existingRecord = existingRecordResult.rows[0];
            if (existingRecord.request_hash !== requestHash) {
              await client.query("ROLLBACK");
              return res.status(409).json({
                message:
                  "Idempotency-Key was already used with a different request payload",
              });
            }

            await client.query("COMMIT");
            return res
              .status(existingRecord.response_status)
              .json(existingRecord.response_body);
          }
        }
      }

      await client.query("COMMIT");
      return res.status(200).json(successResponse);
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

// PATCH /api/drivers/deliveries/:orderId/status
// Updates order status only for the assigned driver and valid transition.
router.patch(
  "/deliveries/:orderId/status",
  requireAuth,
  async (req, res, next) => {
    const firebase_uid = req.auth.user.firebase_uid;
    const { orderId } = req.params;
    const { status } = req.body || {};
    const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
    const idempotencyScope = "drivers.deliveries.status.update";
    const requestHash = buildIdempotencyRequestHash({ orderId, status });

    if (!status || !["picked_up", "on_the_way", "delivered"].includes(status)) {
      return res.status(400).json({
        message: "status must be one of: picked_up, on_the_way, delivered",
      });
    }

    const client = await pool.connect();
    let responseBody = null;
    let customerUid = null;
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        await ensureIdempotencyTable(client);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `${idempotencyScope}:${firebase_uid}:${idempotencyKey}`,
        ]);

        const existingRecordResult = await client.query(
          `
          SELECT request_hash, response_status, response_body
          FROM api_idempotency_records
          WHERE idempotency_key = $1
            AND scope = $2
            AND actor_id = $3
          LIMIT 1
          `,
          [idempotencyKey, idempotencyScope, firebase_uid],
        );

        if (existingRecordResult.rowCount > 0) {
          const existingRecord = existingRecordResult.rows[0];

          if (existingRecord.request_hash !== requestHash) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              message:
                "Idempotency-Key was already used with a different request payload",
            });
          }

          await client.query("ROLLBACK");
          return res
            .status(existingRecord.response_status)
            .json(existingRecord.response_body);
        }
      }

      const driverResult = await client.query(
        `
      SELECT firebase_uid
      FROM drivers
      WHERE firebase_uid = $1
      `,
        [firebase_uid],
      );

      if (driverResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message:
            "Driver profile not found. Call POST /api/drivers/session first.",
        });
      }

      const authorizationResult = await client.query(
        `
      SELECT o.id, o.status, o.firebase_uid, d.assigned_driver_firebase_uid
      FROM orders o
      JOIN deliveries d ON d.order_id = o.id
      WHERE o.id = $1
      FOR UPDATE
      `,
        [orderId],
      );

      if (authorizationResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          message: "Delivery assignment not found for this order",
        });
      }

      const orderRow = authorizationResult.rows[0];
      if (orderRow.assigned_driver_firebase_uid !== firebase_uid) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message: "You are not assigned to this delivery",
        });
      }

      if (orderRow.status === status) {
        responseBody = {
          message: "Order status already set",
          orderId,
          status,
        };

        if (idempotencyKey) {
          await client.query(
            `
            INSERT INTO api_idempotency_records (
              idempotency_key,
              scope,
              actor_id,
              request_hash,
              response_status,
              response_body
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              idempotencyKey,
              idempotencyScope,
              firebase_uid,
              requestHash,
              200,
              JSON.stringify(responseBody),
            ],
          );
        }

        await client.query("COMMIT");
        return res.status(200).json(responseBody);
      }

      const allowedNextStatuses =
        DRIVER_STATUS_TRANSITIONS[orderRow.status] || [];
      if (!allowedNextStatuses.includes(status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: `Invalid status transition from ${orderRow.status} to ${status}`,
        });
      }

      await client.query(
        `
      UPDATE orders
      SET status = $1
      WHERE id = $2
      `,
        [status, orderId],
      );

      await client.query(
        `
      INSERT INTO order_status_history (order_id, status)
      VALUES ($1, $2)
      `,
        [orderId, status],
      );

      await client.query(
        `
      UPDATE deliveries
      SET updated_at = NOW()
      WHERE order_id = $1
      `,
        [orderId],
      );

      customerUid = orderRow.firebase_uid;
      responseBody = {
        message: "Order status updated",
        orderId,
        status,
      };

      if (idempotencyKey) {
        await client.query(
          `
          INSERT INTO api_idempotency_records (
            idempotency_key,
            scope,
            actor_id,
            request_hash,
            response_status,
            response_body
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            idempotencyKey,
            idempotencyScope,
            firebase_uid,
            requestHash,
            200,
            JSON.stringify(responseBody),
          ],
        );
      }

      await client.query("COMMIT");

      const io = req.app.get("io");
      if (io) {
        io.to(`customer:${customerUid}`).emit(
          "order_status_updated",
          withSchemaVersion({
            orderId,
            status,
            updatedAt: new Date().toISOString(),
          }),
        );
      }

      return res.status(200).json(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

module.exports = router;
