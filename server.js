const path = require("path");
const express = require("express");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static('public'));

app.get('/old', (req, res) => {
  res.redirect(302, '/legacy/');
});

app.use(
  '/legacy',
  express.static(path.join(__dirname, 'legacy'), { index: 'index.html' })
);

const server = app.listen(PORT, () => {
  console.log("Server Running");
  console.log(
    process.env.RENDER
      ? `Listening on port ${PORT} (Render)`
      : `http://localhost:${PORT}`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  throw err;
});
