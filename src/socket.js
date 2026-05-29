const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Auth middleware — verify JWT before the connection is established
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication token required"));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.restaurantId = decoded.restaurant_id;
      socket.role = decoded.role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const room = `restaurant:${socket.restaurantId}`;
    socket.join(room);
    console.log(
      `Restaurant ${socket.restaurantId} connected (socket ${socket.id})`,
    );

    socket.emit("connected", {
      message: "Connected to Mbole Eats notification service",
      restaurantId: socket.restaurantId,
    });

    socket.on("disconnect", () => {
      console.log(
        `Restaurant ${socket.restaurantId} disconnected (socket ${socket.id})`,
      );
    });
  });

  return io;
}

module.exports = { setupSocket };
