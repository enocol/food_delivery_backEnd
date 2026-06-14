const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { getFirebaseAuth } = require("./config/firebaseAdmin");
const pool = require("./config/db");

const JWT_SECRET = process.env.JWT_SECRET;

function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Auth middleware — supports restaurant JWTs, driver Firebase tokens, and customer Firebase tokens
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
    if (!claimedRole || !["driver", "customer"].includes(claimedRole)) {
      return next(new Error("role must be 'driver' or 'customer'"));
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

  io.on("connection", (socket) => {
    if (socket.restaurantId) {
      const room = `restaurant:${socket.restaurantId}`;
      socket.join(room);
      console.log(
        `Restaurant ${socket.restaurantId} connected (socket ${socket.id})`,
      );
      socket.emit("connected", {
        message: "Connected to Mbole Eats notification service",
        restaurantId: socket.restaurantId,
      });
    } else if (socket.role === "driver") {
      // Join personal room so the backend can reach this specific driver
      socket.join(`driver:${socket.firebaseUid}`);
      console.log(
        `Driver ${socket.firebaseUid} connected (socket ${socket.id})`,
      );

      // Auto-rejoin available_drivers room if driver was online before reconnect
      if (socket.driverIsOnline) {
        socket.join("available_drivers");
      }

      socket.emit("connected", {
        message: "Connected to Mbole Eats notification service",
        role: "driver",
        isOnline: socket.driverIsOnline,
      });

      // Driver pressed "Go Online"
      // Frontend should emit: socket.emit("go_online", { latitude, longitude })
      socket.on("go_online", async ({ latitude, longitude } = {}) => {
        const location =
          latitude != null && longitude != null
            ? `${latitude},${longitude}`
            : null;
        try {
          await pool.query(
            `UPDATE drivers
             SET is_online = TRUE, status = 'Online',
                 current_location = COALESCE($2, current_location)
             WHERE firebase_uid = $1`,
            [socket.firebaseUid, location],
          );
          socket.join("available_drivers");
          socket.emit("status_updated", { isOnline: true, status: "Online" });
          console.log(`Driver ${socket.firebaseUid} is now online`);
        } catch (err) {
          console.error(
            `go_online DB error for driver ${socket.firebaseUid}:`,
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
          socket.leave("available_drivers");
          socket.emit("status_updated", { isOnline: false, status: "Offline" });
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
            `UPDATE drivers SET is_online = FALSE, status = 'Offline'
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
    } else if (socket.firebaseUid) {
      const room = `customer:${socket.firebaseUid}`;
      socket.join(room);
      console.log(
        `Customer ${socket.firebaseUid} connected (socket ${socket.id})`,
      );
      socket.emit("connected", {
        message: "Connected to Mbole Eats notification service",
        userId: socket.firebaseUid,
      });

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
