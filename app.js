const express = require("express");
const path = require("path");
require("./src/services/authenticate");
const connect = require("./src/services/dbConnect");
const http = require("http");
require("./src/models/bid");
const initSocket = require("./src/socket/socketHandler");
require("./src/shared/send_notification");
 
/*****************
 *SERVER INITILIZATIONS
 *****************/
const app = express();
const webhookRoutes = require("./src/routes/webhook");

// Stripe webhook first, raw body
app.use("/webhook", express.raw({ type: "application/json" }), webhookRoutes);
app.get("/open", (req, res) => {
  const ua = req.headers["user-agent"] || "";

  if (/iPhone|iPad|iPod/i.test(ua)) {
    return res.redirect(
      "https://testflight.apple.com/join/QYUpVXFs"
    );
  }

  if (/Android/i.test(ua)) {
    return res.redirect(
      "https://play.google.com/store/apps/details?id=com.tokshop.live&hl=en"
    );
  }

  return res.redirect("https://www.stealz.live");
})

// Password Reset Page
app.get("/reset-password", async (req, res) => {
  try {
    const fs = require("fs");
    const ThemeSettings = require("./src/models/themes");
    const themesettings = await ThemeSettings.findOne({});

    let html = fs.readFileSync(
      path.join(__dirname, "src/views/reset-password.html"),
      "utf8"
    );

    // Inject theme settings
    const appName = themesettings?.app_name || themesettings?.seo_title || "Stealz";
    const appLogo = themesettings?.app_logo || "";
    const primaryColor = themesettings?.primary_color
      ? (themesettings.primary_color.startsWith("#")
          ? themesettings.primary_color
          : "#" + themesettings.primary_color.replace(/^FF/i, ""))
      : "#F43F5E";

    html = html
      .replace(/\{\{app_name\}\}/g, appName)
      .replace(/\{\{app_logo\}\}/g, appLogo)
      .replace(/\{\{primary_color\}\}/g, primaryColor);

    res.send(html);
  } catch (error) {
    console.error("Reset password page error:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

/*****************
 *VIEW ENGINE CONFIG
 *****************/
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

/*****************
 *MIDDLEWARE
 *****************/

app.use(require("./src/services/middleware"));

app.use(require("./src/routes/ROUTE_MOUNTER"));
app.use("/public/img", express.static(path.join(__dirname, "public/img")));
app.use(
  "/images/category",
  express.static(path.join(__dirname, "/images/category"))
);
app.use(
  "/uploads",
  express.static(path.join(__dirname, "src/public/uploads"))
);
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    console.log("RAW TOKEN:", authHeader);
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled request error:", err);
  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});
/*****************
 *SERVER INSTANTIATION
 *****************/
var server = http.createServer(app);
initSocket(server);

server.listen(process.env.PORT, async function (){
  console.log("Stealz server listening on port " + process.env.PORT);
});

connect();

const fs = require("fs");
const Users = require("./src/models/user");

async function exportUsersCSV() {
  const filePath = "./users.csv"; // file will be created here

  const users = await Users.find({}, { email: 1, firstName: 1, lastName: 1 });

  let csv = "email,name\n";

  users.forEach(u => {
    const email = u.email || "";
    const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
    csv += `${email},${name}\n`;
  });

  fs.writeFileSync(filePath, csv);

  return filePath; // <-- So you know where the file is
}

// exportUsersCSV()
module.exports = app;
