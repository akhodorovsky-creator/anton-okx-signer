"use strict";

const http = require("node:http");
const originalCreateServer = http.createServer;

http.createServer = function patchedCreateServer(listener) {
  return originalCreateServer.call(http, function wrappedListener(req, res) {
    if (req && req.url === "/auto") {
      const originalEnd = res.end;
      res.end = function patchedEnd(chunk, ...args) {
        try {
          const body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
          console.log("ANTON_AUTO_RESULT " + body);
        } catch (error) {
          console.log("ANTON_AUTO_RESULT_LOG_ERROR " + String(error && error.message || error));
        }
        return originalEnd.call(this, chunk, ...args);
      };
    }
    return listener(req, res);
  });
};
