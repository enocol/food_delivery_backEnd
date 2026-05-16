const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.post("/", async (req, res) => {
  const { firebase_uid: firebaseUid, restaurant_id: restaurantId } =
    req.body || {};

  if (!firebaseUid || !restaurantId) {
    return res.status(400).json({
      message: "firebase_uid and restaurant_id are required",
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO likes (firebase_uid, restaurant_id)
      VALUES ($1, $2)
      ON CONFLICT (firebase_uid, restaurant_id) DO NOTHING
      RETURNING firebase_uid, restaurant_id, created_at
      `,
      [firebaseUid, restaurantId],
    );

    if (result.rowCount === 0) {
      return res.status(200).json({
        message: "Restaurant already liked by this user",
        like: {
          firebaseUid,
          restaurantId,
        },
      });
    }

    const like = result.rows[0];
    return res.status(201).json({
      message: "Like saved",
      like: {
        firebaseUid: like.firebase_uid,
        restaurantId: like.restaurant_id,
        createdAt: like.created_at,
      },
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({
        message: "User or restaurant not found",
      });
    }

    throw error;
  }
});

router.get("/:firebase_uid", async (req, res) => {
  const { firebase_uid: firebaseUid } = req.params;

  if (!firebaseUid) {
    return res.status(400).json({
      message: "firebase_uid is required",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT l.firebase_uid, l.restaurant_id, r.name, r.image_url, r.cuisine, r.rating, l.created_at
      FROM likes l
      JOIN restaurants r ON l.restaurant_id = r.id
      WHERE l.firebase_uid = $1
      ORDER BY l.created_at DESC
      `,
      [firebaseUid],
    );

    const likes = result.rows.map((row) => ({
      firebaseUid: row.firebase_uid,
      restaurantId: row.restaurant_id,
      restaurant: {
        id: row.restaurant_id,
        name: row.name,
        imageUrl: row.image_url,
        cuisine: row.cuisine,
        rating: Number(row.rating),
      },
      likedAt: row.created_at,
    }));

    return res.status(200).json({
      count: likes.length,
      likes,
    });
  } catch (error) {
    throw error;
  }
});

router.delete("/:firebase_uid/:restaurant_id", async (req, res) => {
  const { firebase_uid: firebaseUid, restaurant_id: restaurantId } = req.params;

  const result = await pool.query(
    `
    DELETE FROM likes
    WHERE firebase_uid = $1 AND restaurant_id = $2
    `,
    [firebaseUid, restaurantId],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({
      message: "Like not found",
    });
  }

  return res.status(200).json({
    message: "Like removed",
    removed: {
      firebaseUid,
      restaurantId,
    },
  });
});

module.exports = router;
