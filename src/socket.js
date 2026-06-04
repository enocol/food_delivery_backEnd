const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { getFirebaseAuth } = require("./config/firebaseAdmin");

const JWT_SECRET = process.env.JWT_SECRET;

function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Auth middleware — supports both restaurant JWTs and customer Firebase tokens
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

    // Try Firebase customer token
    try {
      const decodedFirebase = await getFirebaseAuth().verifyIdToken(token);
      socket.firebaseUid = decodedFirebase.uid;
      socket.role = "customer";
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
    }

    socket.on("disconnect", () => {
      const id = socket.restaurantId || socket.firebaseUid || socket.id;
      console.log(`${socket.role} ${id} disconnected (socket ${socket.id})`);
    });
  });

  return io;
}

module.exports = { setupSocket };
