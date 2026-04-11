const express = require("express");

const app = express();

const startPort = Number(process.env.PORT) || 3000;
const maxAttempts = 50;

app.get("/", (req, res) => {
  res.send("HRMS Portal Running");
});

function listen(port) {
  const server = app.listen(port, () => {
    console.log("Server Running");
    console.log(`http://localhost:${port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port - startPort < maxAttempts) {
      server.close(() => listen(port + 1));
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

listen(startPort);
