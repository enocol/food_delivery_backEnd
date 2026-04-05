const express = require("express");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

function toPublicUser(user) {
  return {
    id: user.firebase_uid,
    name: user.name,
    email: user.email,
    phone: user.phone,
  };
}

router.post("/register", (req, res) => {
  return res.status(410).json({
    message:
      "Deprecated endpoint. Create users in Firebase Auth and send Firebase ID token to protected endpoints.",
  });
});

router.post("/emailjs-login", (req, res) => {
  return res.status(410).json({
    message:
      "Deprecated endpoint. Authenticate with Firebase on the client and send Firebase ID token.",
  });
});

router.post("/login", (req, res) => {
  return res.status(410).json({
    message:
      "Deprecated endpoint. Authenticate with Firebase on the client and send Firebase ID token.",
  });
});

router.post("/sync", requireAuth, (req, res) => {
  return res.status(200).json({
    user: toPublicUser(req.auth.user),
  });
});

router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({
    user: toPublicUser(req.auth.user),
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  return res.status(200).json({
    message:
      "Firebase logout is handled client-side by clearing the Firebase session",
  });
});

module.exports = router;
