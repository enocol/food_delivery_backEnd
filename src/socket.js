const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { getFirebaseAuth } = require("./config/firebaseAdmin");
const pool = require("./config/db");
const {
  parseCoordinateValue,
  toCoordinateStorageValue,
} = require("./utils/coordinates");
const { withSchemaVersion } = require("./utils/eventPayload");

const JWT_SECRET = process.env.JWT_SECRET;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineDistanceKm(from, to) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Auth middleware — supports restaurant JWTs and Firebase tokens for admin, driver, and customer
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication token required"));
    }

    // Try restaurant JWT first
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.restaurant_id) {
        socket.restaurantId = decoded.restaurant_id;
        socket.role = decoded.role;
        return next();
      }
    } catch {
      // Not a restaurant JWT — fall through to Firebase check
    }

    // Try Firebase token — role must be declared by the client in handshake auth
    const claimedRole = socket.handshake.auth?.role;
    if (
      !claimedRole ||
      !["admin", "driver", "customer"].includes(claimedRole)
    ) {
      return next(new Error("role must be 'admin', 'driver' or 'customer'"));
    }

    try {
      const decodedFirebase = await getFirebaseAuth().verifyIdToken(token);
      const uid = decodedFirebase.uid;

      if (claimedRole === "driver") {
        const driverResult = await pool.query(
          "SELECT id, is_online FROM drivers WHERE firebase_uid = $1 LIMIT 1",
          [uid],
        );
        if (driverResult.rowCount === 0) {
          return next(new Error("Driver account not found"));
        }
        socket.firebaseUid = uid;
        socket.role = "driver";
        socket.driverIsOnline = driverResult.rows[0].is_online;
      } else if (claimedRole === "admin") {
        const adminResult = await pool.query(
          "SELECT firebase_uid FROM users WHERE firebase_uid = $1 AND is_admin = TRUE LIMIT 1",
          [uid],
        );
        if (adminResult.rowCount === 0) {
          return next(new Error("Admin account not found"));
        }
        socket.firebaseUid = uid;
        socket.role = "admin";
      } else {
        // claimedRole === "customer"
        const customerResult = await pool.query(
          "SELECT firebase_uid FROM users WHERE firebase_uid = $1 LIMIT 1",
          [uid],
        );
        if (customerResult.rowCount === 0) {
          return next(new Error("Customer account not found"));
        }
        socket.firebaseUid = uid;
        socket.role = "customer";
      }

      return next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  async function buildDriverAdminProfile(firebaseUid) {
    const driverResult = await pool.query(
      `
      SELECT d.firebase_uid, d.phone, d.is_online, d.status, d.current_location, u.name
      FROM drivers d
      LEFT JOIN users u ON u.firebase_uid = d.firebase_uid
      WHERE d.firebase_uid = $1
      LIMIT 1
      `,
      [firebaseUid],
    );

    if (driverResult.rowCount === 0) {
      return null;
    }

    const driver = driverResult.rows[0];

    const activeDeliveryResult = await pool.query(
      `
      SELECT
        o.id AS order_id,
        o.status AS order_status,
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        r.location AS restaurant_location
      FROM deliveries d
      JOIN orders o ON o.id = d.order_id
      LEFT JOIN LATERAL (
        SELECT oi.restaurant_id
        FROM order_items oi
        WHERE oi.order_id = o.id
        ORDER BY oi.id ASC
        LIMIT 1
      ) first_item ON TRUE
      LEFT JOIN restaurants r ON r.id = first_item.restaurant_id
      WHERE d.assigned_driver_firebase_uid = $1
        AND o.status IN ('ready_for_pickup', 'picked_up', 'on_the_way')
      ORDER BY o.created_at DESC
      LIMIT 1
      `,
      [firebaseUid],
    );

    const activeDelivery =
      activeDeliveryResult.rowCount > 0 ? activeDeliveryResult.rows[0] : null;
    const availability = driver.is_online ? "available" : "not available";

    const driverCoordinates = parseCoordinateValue(driver.current_location);
    const restaurantCoordinates = activeDelivery
      ? parseCoordinateValue(activeDelivery.restaurant_location)
      : null;

    let distanceFromRestaurantKm = null;
    if (driverCoordinates && restaurantCoordinates) {
      distanceFromRestaurantKm = Number(
        haversineDistanceKm(driverCoordinates, restaurantCoordinates).toFixed(
          2,
        ),
      );
    }

    return {
      firebaseUid: driver.firebase_uid,
      name: driver.name || null,
      phone: driver.phone || null,
      isOnline: Boolean(driver.is_online),
      onlineStatus: driver.status,
      availability,
      currentLocation:
        parseCoordinateValue(driver.current_location) ??
        driver.current_location,
      distanceFromRestaurantKm,
      activeDelivery: activeDelivery
        ? {
            orderId: activeDelivery.order_id,
            orderStatus: activeDelivery.order_status,
            restaurantId: activeDelivery.restaurant_id,
            restaurantName: activeDelivery.restaurant_name,
          }
        : null,
    };
  }

  async function emitDriverUpdateToAdmins(firebaseUid, reason) {
    try {
      const profile = await buildDriverAdminProfile(firebaseUid);
      if (!profile) return;
      const payload = {
        reason,
        driver: profile,
        timestamp: new Date().toISOString(),
      };
      console.log("driver_status_changed payload -> admin room:", payload);
      io.to("admin").emit("driver_status_changed", withSchemaVersion(payload));
    } catch (error) {
      console.error(
        `Failed to emit driver update for ${firebaseUid} to admin room:`,
        error.message,
      );
    }
  }

  async function emitDriversSnapshotToAdminSocket(adminSocket) {
    try {
      const allDriversResult = await pool.query(
        `
        SELECT firebase_uid
        FROM drivers
        ORDER BY is_online DESC, status ASC, firebase_uid ASC
        `,
      );

      const profiles = await Promise.all(
        allDriversResult.rows.map((row) =>
          buildDriverAdminProfile(row.firebase_uid),
        ),
      );

      adminSocket.emit(
        "drivers_snapshot",
        withSchemaVersion({
          drivers: profiles.filter(Boolean),
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      console.error(
        "Failed to emit drivers snapshot to admin socket:",
        error.message,
      );
    }
  }

  io.on("connection", (socket) => {
    if (socket.restaurantId) {
      const room = `restaurant:${socket.restaurantId}`;
      socket.join(room);
      console.log(
        `Restaurant ${socket.restaurantId} connected (socket ${socket.id})`,
      );
      socket.emit(
        "connected",
        withSchemaVersion({
          message: "Connected to Mbole Eats notification service",
          restaurantId: socket.restaurantId,
        }),
      );
    } else if (socket.role === "driver") {
      // Join personal room so the backend can reach this specific driver
      socket.join(`driver:${socket.firebaseUid}`);
      console.log(
        `Driver ${socket.firebaseUid} connected (socket ${socket.id})`,
      );

      socket.emit(
        "connected",
        withSchemaVersion({
          message: "Connected to Mbole Eats notification service",
          role: "driver",
          isOnline: socket.driverIsOnline,
        }),
      );

      // Driver pressed "Go Online"
      // Frontend should emit: socket.emit("go_online", { latitude, longitude })
      socket.on("go_online", async ({ latitude, longitude } = {}) => {
        const location =
          latitude != null && longitude != null
            ? toCoordinateStorageValue({
                latitude: Number(latitude),
                longitude: Number(longitude),
              })
            : null;
        try {
          socket.join(`driver:${socket.firebaseUid}`);
          await pool.query(
            `UPDATE drivers
             SET is_online = TRUE, status = 'Online',
                 current_location = COALESCE($2, current_location),
                 socket_id = $3
             WHERE firebase_uid = $1`,
            [socket.firebaseUid, location, socket.id],
          );
          socket.emit(
            "status_updated",
            withSchemaVersion({ isOnline: true, status: "Online" }),
          );
          emitDriverUpdateToAdmins(socket.firebaseUid, "go_online");
          console.log(`Driver ${socket.firebaseUid} is now online`);
        } catch (err) {
          console.error(
            `go_online DB error for driver ${socket.firebaseUid}:`,
            err.message,
          );
        }
      });

      // Driver sends periodic location updates while active
      // Frontend should emit: socket.emit("update_location", { latitude, longitude })
      socket.on("update_location", async ({ latitude, longitude } = {}) => {
        if (latitude == null || longitude == null) return;
        const parsedLat = Number(latitude);
        const parsedLng = Number(longitude);
        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return;
        const location = toCoordinateStorageValue({
          latitude: parsedLat,
          longitude: parsedLng,
        });
        // Log the location update for debugging purposes
        console.log(
          `update_location received from driver ${socket.firebaseUid}: ${location}`,
        );
        try {
          await pool.query(
            `UPDATE drivers SET current_location = $2 WHERE firebase_uid = $1`,
            [socket.firebaseUid, location],
          );
        } catch (err) {
          console.error(
            `update_location DB error for driver ${socket.firebaseUid}:`,
            err.message,
          );
        }
      });

      // Driver pressed "Go Offline"
      socket.on("go_offline", async () => {
        try {
          await pool.query(
            `UPDATE drivers SET is_online = FALSE, status = 'Offline'
             WHERE firebase_uid = $1`,
            [socket.firebaseUid],
          );
          socket.emit(
            "status_updated",
            withSchemaVersion({ isOnline: false, status: "Offline" }),
          );
          emitDriverUpdateToAdmins(socket.firebaseUid, "go_offline");
          console.log(`Driver ${socket.firebaseUid} is now offline`);
        } catch (err) {
          console.error(
            `go_offline DB error for driver ${socket.firebaseUid}:`,
            err.message,
          );
        }
      });

      socket.on("disconnect", async () => {
        console.log(
          `Driver ${socket.firebaseUid} disconnected (socket ${socket.id})`,
        );
        try {
          await pool.query(
            `UPDATE drivers SET is_online = FALSE, status = 'Offline', socket_id = NULL
             WHERE firebase_uid = $1`,
            [socket.firebaseUid],
          );
        } catch (err) {
          console.error(
            `disconnect DB error for driver ${socket.firebaseUid}:`,
            err.message,
          );
        }
      });
    } else if (socket.role === "admin") {
      socket.join("admin");
      console.log(
        `Admin ${socket.firebaseUid} connected (socket ${socket.id})`,
      );
      socket.emit(
        "connected",
        withSchemaVersion({
          message: "Connected to Mbole Eats notification service",
          role: "admin",
          userId: socket.firebaseUid,
        }),
      );

      emitDriversSnapshotToAdminSocket(socket);

      socket.on("disconnect", () => {
        console.log(
          `Admin ${socket.firebaseUid} disconnected (socket ${socket.id})`,
        );
      });
    } else if (socket.firebaseUid) {
      const room = `customer:${socket.firebaseUid}`;
      socket.join(room);
      console.log(
        `Customer ${socket.firebaseUid} connected (socket ${socket.id})`,
      );
      socket.emit(
        "connected",
        withSchemaVersion({
          message: "Connected to Mbole Eats notification service",
          userId: socket.firebaseUid,
        }),
      );

      socket.on("disconnect", () => {
        console.log(
          `Customer ${socket.firebaseUid} disconnected (socket ${socket.id})`,
        );
      });
    }

    if (socket.role !== "driver") {
      socket.on("disconnect", () => {
        const id = socket.restaurantId || socket.firebaseUid || socket.id;
        console.log(`${socket.role} ${id} disconnected (socket ${socket.id})`);
      });
    }
  });

  return io;
}

module.exports = { setupSocket };
