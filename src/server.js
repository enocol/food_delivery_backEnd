require("dotenv").config();
const http = require("http");
const app = require("./app");
const { setupSocket } = require("./socket");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = setupSocket(server);

// Make io accessible to route handlers via req.app.get("io")
app.set("io", io);

server.listen(PORT, () => {
  console.log(`Mbole Eats backend running on port ${PORT}`);
});
