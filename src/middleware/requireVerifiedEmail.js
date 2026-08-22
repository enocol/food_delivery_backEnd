// Authenticated, but not permitted -> 403.
function requireVerifiedEmail(req, res, next) {
  if (!req.auth?.decodedToken?.email_verified) {
    return res.status(403).json({
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email address before placing an order.",
    });
  }
  return next();
}

module.exports = requireVerifiedEmail;
