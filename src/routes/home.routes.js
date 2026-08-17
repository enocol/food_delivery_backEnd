const express = require("express");

const router = express.Router();

const BASE = "https://api.mboloeats.com";

const endpoints = [
  {
    group: "Health",
    items: [
      {
        method: "GET",
        path: "/api/health",
        description: "Check API status and uptime.",
        auth: false,
        sample: {
          name: "Mbole Eats API",
          status: "ok",
          timestamp: "2026-05-25T10:00:00.000Z",
        },
      },
    ],
  },
  {
    group: "Auth",
    items: [
      {
        method: "POST",
        path: "/api/auth/sync",
        description:
          "Sync the authenticated Firebase user with the database. Creates or updates the user record. Requires a valid Firebase ID token in the Authorization header.",
        auth: true,
        body: null,
        sample: {
          user: {
            id: "uid_abc123",
            name: "Amara Osei",
            email: "amara@example.com",
            phone: "+233201234567",
          },
          message:
            "User data synchronized with Firebase Auth. This endpoint can be used to create or update user records in the database based on Firebase authentication.",
        },
      },
    ],
  },
  {
    group: "Restaurants",
    items: [
      {
        method: "GET",
        path: "/api/restaurants",
        description:
          "List all restaurants. Optional query params: <code>search</code> (name), <code>cuisine</code>.",
        auth: false,
        sample: {
          count: 2,
          restaurants: [
            {
              id: "r_01",
              name: "Chop Bar Central",
              imageUrl: "https://cdn.mboloeats.com/restaurants/chop-bar.jpg",
              cuisine: "Ghanaian",
              rating: 4.5,
              deliveryFee: 5,
              deliveryTimeMinutes: 25,
              isOpen: true,
              address: "12 Independence Ave, Accra",
            },
            {
              id: "r_02",
              name: "Pizza Palace",
              imageUrl:
                "https://cdn.mboloeats.com/restaurants/pizza-palace.jpg",
              cuisine: "Italian",
              rating: 4.2,
              deliveryFee: 8,
              deliveryTimeMinutes: 35,
              isOpen: true,
              address: "45 Ring Road, Accra",
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/restaurants/with-menus",
        description: "List all restaurants including their full menu items.",
        auth: false,
        sample: {
          count: 1,
          restaurants: [
            {
              id: "r_01",
              name: "Chop Bar Central",
              imageUrl: "https://cdn.mboloeats.com/restaurants/chop-bar.jpg",
              cuisine: "Ghanaian",
              rating: 4.5,
              deliveryFee: 5,
              deliveryTimeMinutes: 25,
              isOpen: true,
              address: "12 Independence Ave, Accra",
              menus: [
                {
                  id: "m_01",
                  restaurantId: "r_01",
                  name: "Waakye",
                  description: "Rice and beans with fish and shito",
                  imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
                  price: 25,
                  isAvailable: true,
                },
              ],
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/restaurants/:restaurantId",
        description: "Get a single restaurant by ID.",
        auth: false,
        sample: {
          restaurant: {
            id: "r_01",
            name: "Chop Bar Central",
            imageUrl: "https://cdn.mboloeats.com/restaurants/chop-bar.jpg",
            cuisine: "Ghanaian",
            rating: 4.5,
            deliveryFee: 5,
            deliveryTimeMinutes: 25,
            isOpen: true,
            address: "12 Independence Ave, Accra",
          },
        },
      },
      {
        method: "GET",
        path: "/api/restaurants/:restaurantId/menu",
        description: "Get a restaurant together with all its menu items.",
        auth: false,
        sample: {
          restaurant: {
            id: "r_01",
            name: "Chop Bar Central",
            cuisine: "Ghanaian",
            rating: 4.5,
            deliveryFee: 5,
            deliveryTimeMinutes: 25,
            isOpen: true,
            address: "12 Independence Ave, Accra",
          },
          count: 1,
          menu: [
            {
              id: "m_01",
              restaurantId: "r_01",
              name: "Waakye",
              description: "Rice and beans with fish and shito",
              imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
              price: 25,
              isAvailable: true,
            },
          ],
        },
      },
      {
        method: "POST",
        path: "/api/restaurants",
        description:
          "Create a new restaurant or update an existing one (matched by name + cuisine). Optionally seed menu items in the same request.",
        auth: false,
        body: {
          restaurant: {
            restaurantName: "Chop Bar Central",
            cuisine: "Ghanaian",
            rating: 4.5,
            deliveryFee: 5,
            deliveryTimeMinutes: 25,
            isOpen: true,
            address: "12 Independence Ave, Accra",
          },
          menuItems: [
            { name: "Waakye", price: 25, description: "Rice and beans" },
          ],
        },
        sample: {
          restaurant: {
            id: "r_01",
            name: "Chop Bar Central",
            imageUrl: null,
            cuisine: "Ghanaian",
            rating: 4.5,
            deliveryFee: 5,
            deliveryTimeMinutes: 25,
            isOpen: true,
            address: "12 Independence Ave, Accra",
          },
          count: 1,
          menu: [
            {
              id: "m_01",
              restaurantId: "r_01",
              name: "Waakye",
              description: "Rice and beans",
              imageUrl: null,
              price: 25,
              isAvailable: true,
            },
          ],
        },
      },
    ],
  },
  {
    group: "Menu Items",
    items: [
      {
        method: "GET",
        path: "/api/menu",
        description:
          "List menu items. Optional query param: <code>restaurant_id</code>.",
        auth: false,
        sample: {
          count: 2,
          items: [
            {
              id: "m_01",
              restaurantId: "r_01",
              name: "Waakye",
              description: "Rice and beans with fish and shito",
              imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
              price: 25,
              isAvailable: true,
            },
            {
              id: "m_02",
              restaurantId: "r_01",
              name: "Jollof Rice",
              description: "Spiced tomato rice",
              imageUrl: "https://cdn.mboloeats.com/menu/jollof.jpg",
              price: 30,
              isAvailable: true,
            },
          ],
        },
      },
      {
        method: "POST",
        path: "/api/menu",
        description: "Add a single menu item to an existing restaurant.",
        auth: false,
        body: {
          restaurant_id: "r_01",
          name: "Banku",
          description: "Fermented corn dough with pepper",
          price: 20,
          isAvailable: true,
        },
        sample: {
          message: "Menu item created",
          item: {
            id: "m_03",
            restaurantId: "r_01",
            name: "Banku",
            description: "Fermented corn dough with pepper",
            imageUrl: null,
            price: 20,
            isAvailable: true,
          },
        },
      },
    ],
  },
  {
    group: "Cart",
    items: [
      {
        method: "GET",
        path: "/api/cart/active",
        description:
          "Get the active cart for the currently authenticated user.",
        auth: true,
        sample: {
          userId: "uid_abc123",
          items: [
            {
              menuItemId: "m_01",
              restaurantId: "r_01",
              quantity: 2,
              name: "Waakye",
              unitPrice: 25,
              imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
              subtotal: 50,
            },
          ],
          subtotal: 50,
        },
      },
      {
        method: "POST",
        path: "/api/cart",
        description:
          "Ensure a cart exists for the authenticated user and return it.",
        auth: true,
        body: null,
        sample: {
          message: "Cart ready",
          cart: {
            userId: "uid_abc123",
            items: [],
            subtotal: 0,
          },
        },
      },
      {
        method: "GET",
        path: "/api/cart/:userId",
        description:
          "Get a specific user's cart. Only the owner may access their cart.",
        auth: true,
        sample: {
          userId: "uid_abc123",
          items: [
            {
              menuItemId: "m_01",
              restaurantId: "r_01",
              quantity: 1,
              name: "Waakye",
              unitPrice: 25,
              imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
              subtotal: 25,
            },
          ],
          subtotal: 25,
        },
      },
      {
        method: "POST",
        path: "/api/cart/:userId/items",
        description:
          "Add a menu item to the cart. Quantity is incremented if the item already exists.",
        auth: true,
        body: { menuItemId: "m_01", quantity: 1 },
        sample: {
          message: "Item added to cart",
          cart: {
            userId: "uid_abc123",
            items: [
              {
                menuItemId: "m_01",
                restaurantId: "r_01",
                quantity: 1,
                name: "Waakye",
                unitPrice: 25,
                imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
                subtotal: 25,
              },
            ],
            subtotal: 25,
          },
        },
      },
      {
        method: "PATCH",
        path: "/api/cart/:userId/items/:menuItemId",
        description: "Update the quantity of a specific cart item.",
        auth: true,
        body: { quantity: 3 },
        sample: {
          message: "Cart item updated",
          cart: {
            userId: "uid_abc123",
            items: [
              {
                menuItemId: "m_01",
                restaurantId: "r_01",
                quantity: 3,
                name: "Waakye",
                unitPrice: 25,
                imageUrl: "https://cdn.mboloeats.com/menu/waakye.jpg",
                subtotal: 75,
              },
            ],
            subtotal: 75,
          },
        },
      },
      {
        method: "DELETE",
        path: "/api/cart/:userId/items/:menuItemId",
        description: "Remove a specific item from the cart.",
        auth: true,
        sample: {
          message: "Item removed from cart",
          cart: { userId: "uid_abc123", items: [], subtotal: 0 },
        },
      },
      {
        method: "DELETE",
        path: "/api/cart/:userId",
        description: "Clear all items from the cart.",
        auth: true,
        sample: {
          message: "Cart cleared",
          cart: { userId: "uid_abc123", items: [], subtotal: 0 },
        },
      },
    ],
  },
  {
    group: "Orders",
    items: [
      {
        method: "POST",
        path: "/api/orders",
        description:
          "Place an order from the current cart. Cart is cleared after a successful order. deliveryFee is calculated automatically from the distance between each restaurant's location and deliveryAddress, at 500 francs per mile (using the farthest restaurant when the cart spans multiple restaurants).",
        auth: true,
        body: {
          deliveryAddress: { latitude: 5.6037, longitude: -0.187 },
          paymentMethod: "cash_on_delivery",
        },
        sample: {
          message: "Order created",
          order: {
            id: "o_xyz789",
            userId: "uid_abc123",
            items: [
              {
                menuItemId: "m_01",
                quantity: 2,
                name: "Waakye",
                unitPrice: 25,
                subtotal: 50,
              },
            ],
            subtotal: 50,
            deliveryFee: 1450,
            total: 1500,
            deliveryAddress: { latitude: 5.6037, longitude: -0.187 },
            paymentMethod: "cash_on_delivery",
            status: "pending",
            createdAt: "2026-05-25T10:05:00.000Z",
            statusHistory: [
              { status: "pending", timestamp: "2026-05-25T10:05:00.000Z" },
            ],
          },
        },
      },
      {
        method: "GET",
        path: "/api/orders/user/:userId",
        description: "Get all orders for the authenticated user.",
        auth: true,
        sample: {
          count: 1,
          orders: [
            {
              id: "o_xyz789",
              created_at: "2026-05-25T10:05:00.000Z",
              total: 70,
              status: "pending",
              totals: { itemCount: 2, cartTotal: 70 },
              items: [
                {
                  name: "Waakye",
                  qty: 2,
                  price: 25,
                  restaurantName: "Chop Bar Central",
                },
              ],
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/orders/all",
        description: "Get all orders across all users (admin use).",
        auth: true,
        sample: {
          count: 1,
          orders: [
            {
              orderId: "o_xyz789",
              subtotal: 50,
              deliveryFee: 20,
              deliveryAddress: "12 Independence Ave, Accra",
              paymentMethod: "cash_on_delivery",
              status: "pending",
              createdAt: "2026-05-25T10:05:00.000Z",
              user: {
                id: "uid_abc123",
                name: "Amara Osei",
                email: "amara@example.com",
                phone: "+233201234567",
              },
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/orders/:orderId",
        description: "Get full details of a single order.",
        auth: true,
        sample: {
          order: {
            id: "o_xyz789",
            userId: "uid_abc123",
            items: [
              {
                menuItemId: "m_01",
                quantity: 2,
                name: "Waakye",
                unitPrice: 25,
                subtotal: 50,
              },
            ],
            subtotal: 50,
            deliveryFee: 20,
            total: 70,
            deliveryAddress: "12 Independence Ave, Accra",
            paymentMethod: "cash_on_delivery",
            status: "confirmed",
            createdAt: "2026-05-25T10:05:00.000Z",
            statusHistory: [
              { status: "pending", timestamp: "2026-05-25T10:05:00.000Z" },
              { status: "confirmed", timestamp: "2026-05-25T10:07:00.000Z" },
            ],
          },
        },
      },
      {
        method: "GET",
        path: "/api/orders/:orderId/restaurant-summary",
        description:
          "Get an order summary formatted for the restaurant (includes customer info).",
        auth: false,
        sample: {
          order: {
            orderId: "o_xyz789",
            subtotal: 50,
            deliveryFee: 20,
            deliveryAddress: "12 Independence Ave, Accra",
            paymentMethod: "cash_on_delivery",
            user: {
              id: "uid_abc123",
              name: "Amara Osei",
              email: "amara@example.com",
              phone: "+233201234567",
            },
          },
        },
      },
      {
        method: "PATCH",
        path: "/api/orders/:orderId/status",
        description:
          "Update an order's status. Valid values: <code>pending</code>, <code>confirmed</code>, <code>preparing</code>, <code>picked_up</code>, <code>on_the_way</code>, <code>delivered</code>, <code>cancelled</code>.",
        auth: false,
        body: { status: "confirmed" },
        sample: {
          message: "Order status updated",
          order: {
            id: "o_xyz789",
            status: "confirmed",
            statusHistory: [
              { status: "pending", timestamp: "2026-05-25T10:05:00.000Z" },
              { status: "confirmed", timestamp: "2026-05-25T10:07:00.000Z" },
            ],
          },
        },
      },
    ],
  },
  {
    group: "Delivery",
    items: [
      {
        method: "GET",
        path: "/api/delivery/:orderId/tracking",
        description:
          "Get real-time tracking info for an order, including ETA and status history.",
        auth: true,
        sample: {
          orderId: "o_xyz789",
          status: "on_the_way",
          etaMinutes: 8,
          history: [
            { status: "pending", timestamp: "2026-05-25T10:05:00.000Z" },
            { status: "confirmed", timestamp: "2026-05-25T10:07:00.000Z" },
            { status: "preparing", timestamp: "2026-05-25T10:10:00.000Z" },
            { status: "picked_up", timestamp: "2026-05-25T10:25:00.000Z" },
            { status: "on_the_way", timestamp: "2026-05-25T10:28:00.000Z" },
          ],
        },
      },
    ],
  },
  {
    group: "Likes",
    items: [
      {
        method: "POST",
        path: "/api/likes",
        description: "Like a restaurant on behalf of a user.",
        auth: false,
        body: { firebase_uid: "uid_abc123", restaurant_id: "r_01" },
        sample: {
          message: "Like saved",
          like: {
            firebaseUid: "uid_abc123",
            restaurantId: "r_01",
            createdAt: "2026-05-25T10:00:00.000Z",
          },
        },
      },
      {
        method: "GET",
        path: "/api/likes/:firebase_uid",
        description: "Get all restaurants liked by a user.",
        auth: false,
        sample: {
          count: 1,
          likes: [
            {
              firebaseUid: "uid_abc123",
              restaurantId: "r_01",
              restaurant: {
                id: "r_01",
                name: "Chop Bar Central",
                imageUrl: "https://cdn.mboloeats.com/restaurants/chop-bar.jpg",
                cuisine: "Ghanaian",
                rating: 4.5,
              },
              likedAt: "2026-05-25T10:00:00.000Z",
            },
          ],
        },
      },
      {
        method: "DELETE",
        path: "/api/likes/:firebase_uid/:restaurant_id",
        description: "Remove a like from a restaurant.",
        auth: false,
        sample: {
          message: "Like removed",
          like: { firebaseUid: "uid_abc123", restaurantId: "r_01" },
        },
      },
    ],
  },
];

const METHOD_COLORS = {
  GET: "#10b981",
  POST: "#3b82f6",
  PATCH: "#f59e0b",
  DELETE: "#ef4444",
};

function buildHtml() {
  const groupsHtml = endpoints
    .map((group) => {
      const itemsHtml = group.items
        .map((ep) => {
          const color = METHOD_COLORS[ep.method] || "#6b7280";
          const authBadge = ep.auth
            ? `<span class="badge auth">🔒 Auth required</span>`
            : "";
          const bodyHtml = ep.body
            ? `<div class="subsection"><span class="label">Request body</span><pre>${JSON.stringify(ep.body, null, 2)}</pre></div>`
            : "";
          return `
          <div class="endpoint">
            <div class="ep-header">
              <span class="method" style="background:${color}">${ep.method}</span>
              <code class="path">${ep.path}</code>
              ${authBadge}
            </div>
            <p class="ep-desc">${ep.description}</p>
            ${bodyHtml}
            <div class="subsection">
              <span class="label">Sample response</span>
              <pre>${JSON.stringify(ep.sample, null, 2)}</pre>
            </div>
          </div>`;
        })
        .join("\n");

      return `
      <section>
        <h2>${group.group}</h2>
        ${itemsHtml}
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mbole Eats API</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --border: #2a2d3a;
      --text: #e2e8f0;
      --muted: #8892a4;
      --accent: #f97316;
      --radius: 10px;
      --font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    /* ── Header ── */
    header {
      background: linear-gradient(135deg, #1a1d27 0%, #0f1117 100%);
      border-bottom: 1px solid var(--border);
      padding: 48px 32px 40px;
      text-align: center;
    }
    header .logo {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    header .logo-icon {
      width: 48px; height: 48px;
      background: var(--accent);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
    }
    header h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #fff;
    }
    header p.subtitle {
      color: var(--muted);
      font-size: 1rem;
      max-width: 540px;
      margin: 0 auto 20px;
    }
    .base-url {
      display: inline-block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 16px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--accent);
    }

    /* ── Auth note ── */
    .auth-note {
      max-width: 860px;
      margin: 24px auto 0;
      background: #1e2130;
      border: 1px solid #2a3050;
      border-left: 3px solid #3b82f6;
      border-radius: var(--radius);
      padding: 14px 18px;
      font-size: 0.875rem;
      color: #93c5fd;
    }

    /* ── Layout ── */
    main {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px 80px;
    }

    /* ── Group sections ── */
    section {
      margin-bottom: 48px;
    }
    section h2 {
      font-size: 1.1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }

    /* ── Endpoint card ── */
    .endpoint {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 22px;
      margin-bottom: 16px;
      transition: border-color 0.15s;
    }
    .endpoint:hover { border-color: #3a3f54; }

    .ep-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 10px;
    }
    .method {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #fff;
      padding: 3px 10px;
      border-radius: 5px;
      flex-shrink: 0;
    }
    .path {
      font-family: var(--font-mono);
      font-size: 0.93rem;
      color: #e2e8f0;
    }
    .badge {
      font-size: 0.72rem;
      border-radius: 4px;
      padding: 2px 8px;
    }
    .badge.auth {
      background: #1e3a5f;
      color: #93c5fd;
      border: 1px solid #2563eb44;
    }

    .ep-desc {
      color: var(--muted);
      font-size: 0.875rem;
      margin-bottom: 14px;
    }
    .ep-desc code {
      background: #2a2d3a;
      border-radius: 3px;
      padding: 1px 5px;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: #f9a8d4;
    }

    .subsection { margin-top: 12px; }
    .label {
      display: block;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin-bottom: 6px;
    }
    pre {
      background: #0d0f17;
      border: 1px solid #1f2235;
      border-radius: 7px;
      padding: 14px 16px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.6;
      color: #a5f3fc;
      max-height: 340px;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 24px;
      color: #3d4258;
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 3px; }
  </style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">🍽️</div>
    <h1>Mbole Eats API</h1>
  </div>
  <p class="subtitle">REST API for the Mbole Eats food delivery platform. All responses are JSON.</p>
  <span class="base-url">${BASE}</span>
  <div class="auth-note">
    🔒 Endpoints marked <strong>Auth required</strong> expect a Firebase ID token as a
    <code>Bearer</code> token in the <code>Authorization</code> header:
    <code>Authorization: Bearer &lt;firebase-id-token&gt;</code>
  </div>
</header>

<main>
  ${groupsHtml}
</main>

<footer>
  &copy; ${new Date().getFullYear()} Mbole Eats &mdash; api.mboloeats.com
</footer>

</body>
</html>`;
}

router.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildHtml());
});

module.exports = router;
