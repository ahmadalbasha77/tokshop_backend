const { EventEmitter } = require("events");

class SocketEmitter extends EventEmitter {
  setIO(io) {
    this.io = io;
  }

  getIO() {
    if (!this.io) throw new Error("Socket.io not initialized");
    return this.io;
  }

  emitTo(room, event, payload) {
    if (!this.io) throw new Error("Socket.io not initialized");
    this.io.to(room).emit(event, payload);
  }
}

module.exports = new SocketEmitter();