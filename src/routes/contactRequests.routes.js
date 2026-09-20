const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const { CONTACT_REQUEST_NEEDS } = require("../utils/constants");
const { toRfc3339Utc } = require("../utils/time");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serializeContactRequest(row) {
  return {
    id: row.id,
    name: row.full_name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    topic: row.need_type,
    message: row.project_description,
    createdAt: toRfc3339Utc(row.created_at),
  };
}

// POST /api/contact-requests
// Public endpoint the contact/quote-request form submits to.
router.post("/", async (req, res) => {
  const { name, company, email, phone, topic, message } = req.body || {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ message: "name is required" });
  }

  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ message: "A valid email is required" });
  }

  if (typeof phone !== "string" || phone.trim().length === 0) {
    return res.status(400).json({ message: "phone is required" });
  }

  if (!CONTACT_REQUEST_NEEDS.includes(topic)) {
    return res.status(400).json({
      message: `topic must be one of: ${CONTACT_REQUEST_NEEDS.join(", ")}`,
    });
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ message: "message is required" });
  }

  let companyValue = null;
  if (company != null) {
    if (typeof company !== "string") {
      return res.status(400).json({ message: "company must be a string" });
    }
    companyValue = company.trim() || null;
  }

  const id = `cr_${randomUUID()}`;

  const result = await pool.query(
    `
    INSERT INTO contact_requests (
      id,
      full_name,
      company,
      email,
      phone,
      need_type,
      project_description
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, full_name, company, email, phone, need_type, project_description, created_at
    `,
    [
      id,
      name.trim(),
      companyValue,
      email.trim(),
      phone.trim(),
      topic,
      message.trim(),
    ],
  );

  return res.status(201).json({
    message: "Contact request received",
    contactRequest: serializeContactRequest(result.rows[0]),
  });
});

// GET /api/contact-requests
// Admin-only endpoint to review submissions.
router.get("/", requireAuth, async (req, res) => {
  if (!req.auth.user.is_admin) {
    return res.status(403).json({ message: "Forbidden: admin access required" });
  }

  const result = await pool.query(
    `
    SELECT id, full_name, company, email, phone, need_type, project_description, created_at
    FROM contact_requests
    ORDER BY created_at DESC
    `,
  );

  return res.status(200).json({
    count: result.rowCount,
    contactRequests: result.rows.map(serializeContactRequest),
  });
});

module.exports = router;
