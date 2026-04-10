/***************************************************
 * src/socket/socketHandler.js
 ***************************************************/
const socketIO = require("socket.io");

// If you want to break out the event logic
const registerSocketEvents = require("./socketEvents");
const socketEmitter = require("../shared/socketEmitter");

module.exports = (server) => {
  // Initialize Socket.IO
  const io = socketIO(server, {
    cors: {
      origin: "*",
    },
  });
  socketEmitter.setIO(io);
  // You can also set up any middlewares for socket.io here, e.g.:
  // io.use((socket, next) => {
  //   // do auth check, etc.
  //   next();
  // });

  // Pass `io` to a separate function that registers all the events
  registerSocketEvents(io);

  console.log("Socket.IO initialized");
};
