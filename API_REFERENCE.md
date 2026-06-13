# Stealz Backend — API Reference

> Auto-generated analysis of all REST endpoints.  
> Base URL: `http://<host>:<port>`  
> Auth: JWT via `Authorization: Bearer <token>` unless noted as **Public**.

---

## Table of Contents

1. [Authentication](#1-authentication--auth)
2. [Users](#2-users--users)
3. [Products](#3-products--products)
4. [Orders](#4-orders--orders)
5. [Categories](#5-categories--category)
6. [Addresses](#6-addresses--address)
7. [Auctions](#7-auctions--auction)
8. [Rooms / Shows](#8-rooms--shows--rooms)
9. [Transactions](#9-transactions--transactions)
10. [Activities](#10-activities--activities)
11. [Notifications](#11-notifications--notifications)
12. [Giveaways](#12-giveaways--giveaways)
13. [Shipping](#13-shipping--shipping)
14. [Stripe](#14-stripe--stripe)
15. [Admin](#15-admin--admin)
16. [Offers](#16-offers--offers)
17. [Articles (Help Center)](#17-articles--articles)
18. [Page Content](#18-page-content--content)
19. [App Settings](#19-app-settings--settings)
20. [Theme & Translations](#20-theme--translations--themes)
21. [Email Templates](#21-email-templates--templates)
22. [Recordings](#22-recordings--recording)
23. [LiveKit](#23-livekit--livekit)
24. [PayPal](#24-paypal--paypal)
25. [Webhooks](#25-webhooks--webhook)
26. [Integrations (WooCommerce / Shopify)](#26-integrations--api)

---

## 1. Authentication — `/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | Public | Register new user |
| POST | `/auth/login` | Public | Login with email & password |
| POST | `/auth/forgot-password` | Public | Request password reset email |
| POST | `/auth/reset-password` | Public | Reset password using token |
| POST | `/auth/register/request-email-verification` | Public | Send email verification code |
| POST | `/auth/register/resend-email-code` | Public | Resend verification code |
| POST | `/auth/register/verify-email-code` | Public | Verify email with code |

### Details

**POST /auth/signup**
- Body: `{ email, firstName, lastName, password }`
- Response: `{ success, user, token }`

**POST /auth/login**
- Body: `{ email, password }`
- Response: `{ success, user, token }`

**POST /auth/forgot-password**
- Body: `{ email }`
- Response: `{ success, message }`

**POST /auth/reset-password**
- Body: `{ token, password }`
- Response: `{ success, user }`

**POST /auth/register/request-email-verification**
- Body: `{ email, firstName }`
- Response: `{ success }`

**POST /auth/register/resend-email-code**
- Body: `{ email }`
- Response: `{ success }`

**POST /auth/register/verify-email-code**
- Body: `{ email, code }`
- Response: `{ success, user }`

---

## 2. Users — `/users`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/` | JWT | Get all users (paginated) |
| POST | `/users/` | JWT | Create user with profile picture |
| GET | `/users/public/profile/:id` | Public | Get public profile |
| GET | `/users/:userId` | Public | Get user by ID |
| PUT | `/users/:userId` | JWT | Update user |
| DELETE | `/users/:userId` | JWT | Delete user |
| POST | `/users/seller/application` | JWT | Submit seller application |
| POST | `/users/seller/application/:id` | JWT | Submit seller application for user ID |
| GET | `/users/followers/:userId` | Public | Get followers list |
| GET | `/users/following/:userId` | Public | Get following list |
| GET | `/users/followersfollowing/:userId` | JWT | Get followers & following combined |
| GET | `/users/followersfollowing/search/:userId/:name` | JWT | Search followers/following by name |
| PUT | `/users/follow/:myUid/:toFollowUid` | JWT | Follow a user |
| PUT | `/users/unfollow/:myUid/:toFollowUid` | JWT | Unfollow a user |
| PUT | `/users/block/:myUid/:toBlockUid` | JWT | Block a user |
| PUT | `/users/unblock/:myUid/:toBlockUid` | JWT | Unblock a user |
| PUT | `/users/updateWallet/:userId` | JWT | Update wallet balance |
| GET | `/users/profile/summary/:shopid` | JWT | Get seller profile summary |
| GET | `/users/paymentmethod/:id` | JWT | Get payment methods |
| POST | `/users/paymentmethod/:id` | JWT | Add payment method |
| DELETE | `/users/paymentmethod/:id` | JWT | Delete payment method |
| PATCH | `/users/paymentmethod/:id` | JWT | Update payment method |
| GET | `/users/payoutmethod/:id` | JWT | Get payout methods |
| POST | `/users/payoutmethod/:id` | JWT | Add payout method |
| DELETE | `/users/payoutmethod/:id` | JWT | Delete payout method |
| POST | `/users/review/:id` | JWT | Add review for user |
| GET | `/users/review/:id` | JWT | Get user reviews |
| POST | `/users/canreview/:id` | JWT | Check if can review user |
| DELETE | `/users/review/delete/review/:id` | JWT | Delete review |
| PATCH | `/users/approveseller/:id` | JWT | Approve seller (admin) |
| POST | `/users/tip` | JWT | Send tip to user |
| GET | `/users/friends/:id` | JWT | Get user friends |
| GET | `/users/bank/:id` | JWT | Get bank info |
| DELETE | `/users/bank/:id` | JWT | Delete bank info |
| POST | `/users/report/:id` | JWT | Report a user |
| DELETE | `/users/delete/user/:id` | JWT | Delete user account |
| GET | `/users/reports/cases` | JWT | Get all reported cases (admin) |
| PUT | `/users/shipping/:id` | JWT | Update shipping settings |
| GET | `/users/account/statistics/:id` | JWT | Get account statistics |
| GET | `/users/stats/all` | JWT | Get all user stats (admin) |
| GET | `/users/payouts/pending` | JWT | Get pending payouts |
| GET | `/users/referalstats/:userId` | JWT | Get referral count stats |
| GET | `/users/referal/stats/logs` | JWT | Get referral logs (paginated) |

### Key Details

**GET /users/** — Query: `page, limit`  
Response: `[...users]`

**GET /users/public/profile/:id**  
Response: `{ success, user: { _id, userName, profilePhoto } }`

**POST /users/seller/application**  
Body: `{ seller_guidelines_accepted, address_line_1, address_line_2, city, state, zip, country, ... }`  
Response: `{ success, application }`

**PUT /users/updateWallet/:userId**  
Body: `{ amount, type }`  
Response: Updated user with new wallet balance

**GET /users/profile/summary/:shopid**  
Response: `{ sales, followers, rating, ... }`

**POST /users/tip**  
Body: `{ toUserId, amount, fromUserId }`  
Response: `{ success, transaction }`

**POST /users/report/:id**  
Body: `{ reason, description, reporterId }`  
Response: `{ success, report }`

**GET /users/referal/stats/logs** — Query: `userId, page, limit, username`  
Response: `{ logs: [], currentPage, totalPages, totalRecords }`

---

## 3. Products — `/products`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/products/` | Public | Get all products (filtered) |
| POST | `/products/:userId` | JWT | Create product |
| GET | `/products/products/:productId` | Public | Get product by ID |
| PUT | `/products/products/:productId` | JWT | Update product |
| DELETE | `/products/products/:productId` | JWT | Delete product |
| PUT | `/products/images/:productId` | JWT | Update product images |
| POST | `/products/product/product/qtycheck/:productId` | Public | Check product quantity |
| POST | `/products/review/:id` | JWT | Add product review |
| GET | `/products/review/:id` | Public | Get product reviews |
| GET | `/products/review/:userId/:id` | Public | Get reviews by user for product |
| DELETE | `/products/review/delete/review/:id` | JWT | Delete product review |
| PUT | `/products/update` | JWT | Update multiple products |
| POST | `/products/favorite/:userId` | JWT | Add to favorites |
| GET | `/products/favorite/:userId` | JWT | Get favorites |
| DELETE | `/products/favorite/:userId` | JWT | Remove from favorites (query: productId) |
| DELETE | `/products/deletemany` | JWT | Delete multiple products |
| POST | `/products/products/bulkadd` | JWT | Bulk add products |
| PUT | `/products/products/bulkedit/all` | JWT | Bulk update products |
| GET | `/products/search` | Public | Advanced search (products/shows/users) |

### Key Details

**GET /products/** — Query: `title, status, price, page, limit, userid, featured, roomid, category, saletype`  
Response: `{ products: [], total, pages }`

**POST /products/:userId**  
Body: `{ name, description, price, category, images, ... }`  
Response: Created product object

**GET /products/search** — Query: `q, page, limit, type (products|shows|users)`  
Response: `{ query, pagination, results: { products, shows, users } }`

**POST /products/product/product/qtycheck/:productId**  
Body: `{ quantity }`  
Response: `{ available: boolean }`

---

## 4. Orders — `/orders`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/orders/` | Public | Get all orders (paginated) |
| POST | `/orders/:userId` | Public | Create order |
| GET | `/orders/:orderId` | Public | Get order by ID |
| PUT | `/orders/:orderId` | JWT | Update order |
| DELETE | `/orders/:orderId` | JWT | Delete order (soft) |
| GET | `/orders/dashboard/orders` | JWT | Dashboard order overview (admin) |
| GET | `/orders/dashboard/orders/best-seller/chart` | JWT | Best-seller chart data |
| POST | `/orders/dispute/:orderId` | JWT | Open dispute |
| PUT | `/orders/dispute/:orderId` | JWT | Update dispute |
| GET | `/orders/dispute/:orderId` | JWT | Get dispute |
| GET | `/orders/all/disputes` | JWT | Get all disputes (admin) |
| POST | `/orders/close/dispute/:id` | JWT | Close dispute (admin) |
| GET | `/orders/shipments/metrics/:userId` | JWT | Shipment metrics |
| GET | `/orders/metrics/:userId` | JWT | Order metrics |
| POST | `/orders/bundle/orders` | JWT | Bundle orders |
| POST | `/orders/unbundle/orders` | JWT | Unbundle orders |
| PUT | `/orders/refund/order/transaction/:id` | JWT | Refund order |
| POST | `/orders/cancel/order` | JWT | Cancel order |
| PUT | `/orders/rejectorder/order` | JWT | Reject cancellation request |
| GET | `/orders/items/all` | JWT | All order items (admin) |
| GET | `/orders/stats/all` | JWT | Order statistics (admin) |
| GET | `/orders/retrypayment/:orderid` | JWT | Retry payment |

### Key Details

**POST /orders/:userId**  
Body: `{ items: [], shippingAddress, paymentMethod, ... }`  
Response: Created order

**GET /orders/** — Query: `page, limit, userId, status`  
Response: `{ orders: [], total, pages }`

**POST /orders/dispute/:orderId**  
Body: `{ reason, description, initiatorId }`  
Response: Created dispute

**GET /orders/metrics/:userId**  
Response: `{ total, completed, pending, refunded, ... }`

**PUT /orders/refund/order/transaction/:id**  
Body: `{ amount, reason }`  
Response: Refund transaction

**POST /orders/cancel/order**  
Body: `{ orderId, reason }`  
Response: Cancelled order

---

## 5. Categories — `/category`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/category/` | JWT | Get all categories |
| POST | `/category/` | JWT | Create category (with image upload) |
| GET | `/category/:id` | JWT | Get category by ID |
| PUT | `/category/:id` | JWT | Update category |
| DELETE | `/category/:id` | JWT | Delete category |
| PUT | `/category/follow/:id` | JWT | Follow category |
| PUT | `/category/unfollow/:id` | JWT | Unfollow category |
| GET | `/category/subcategory/:id` | JWT | Get subcategories |
| POST | `/category/bulk/add` | JWT | Bulk add categories |
| POST | `/category/subcategory/bulk/:id` | JWT | Bulk add subcategories |

### Key Details

**GET /category/** — Query: `title, page, limit, type (a-z|recommended|popular)`  
Response: `{ categories: [], totalDoc, limits, pages }`

**POST /category/** — Form data (max 5 images)  
Body: `{ name, description, icon, commission, ... }`  
Response: Created category

**PUT /category/follow/:id**  
Body: `{ userid }`  
Response: Updated category

---

## 6. Addresses — `/address`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/address/` | JWT | Add address |
| GET | `/address/:addressId` | JWT | Get address by ID |
| PUT | `/address/:addressId` | JWT | Update address |
| PATCH | `/address/:addressId` | JWT | Set address as primary |
| DELETE | `/address/:addressId` | JWT | Delete address |
| GET | `/address/default/address/:userId` | JWT | Get primary address |
| GET | `/address/all/:userId` | JWT | Get all addresses for user |
| POST | `/address/validate` | JWT | Validate address via Shippo |

### Key Details

**POST /address/**  
Body: `{ userId, name, email, phone, addrress1, addrress2, city, state, zipcode, countryCode }`  
Response: `{ success: true }`

**PATCH /address/:addressId** (make primary)  
Body: `{ userId }`  
Response: `{ success: true, data: updatedAddress }`

**POST /address/validate**  
Body: address fields  
Response: `{ success: boolean, error?: string }`

---

## 7. Auctions — `/auction`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auction/` | JWT | Get auctions (filtered) |
| POST | `/auction/` | JWT | Create auction |
| GET | `/auction/room/aution/:id` | JWT | Get single auction |
| PUT | `/auction/:id` | JWT | Update auction |
| DELETE | `/auction/:id` | JWT | Delete auction |
| GET | `/auction/:roomid` | JWT | Get active auction in room |
| GET | `/auction/all/:roomid` | JWT | Get all auctions in room |
| POST | `/auction/bid` | JWT | Place bid |
| PUT | `/auction/bid/:id` | JWT | Update bid / setup autobid |

### Key Details

**GET /auction/** — Query: `tokshow, status, page, limit`  
Response: `{ auctions: [], totalDoc, limits, pages }`

**POST /auction/**  
Body: `{ product, tokshow, startPrice, endDate, ... }`  
Response: Created auction

**POST /auction/bid**  
Body: `{ auction, user, amount, custom_bid }`  
Response: Bid object

**PUT /auction/bid/:id** (autobid)  
Body: `{ user, amount, autobid, autobidamount }`  
Response: Updated bid

---

## 8. Rooms / Shows — `/rooms`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rooms/` | JWT | Get shows (paginated) |
| POST | `/rooms/` | JWT | Create show/room |
| GET | `/rooms/:roomId` | JWT | Get room by ID |
| PUT | `/rooms/:roomId` | JWT | Update room |
| DELETE | `/rooms/:roomId` | JWT | Delete room |
| PUT | `/rooms/user/add/:roomId` | JWT | Add user to room |
| POST | `/rooms/bulkupdate/data` | JWT | Bulk update rooms |
| GET | `/rooms/analytics/:roomId` | JWT | Room analytics |
| PUT | `/rooms/features/:roomId` | JWT | Feature/unfeature room |
| GET | `/rooms/stats/all` | JWT | All room stats (admin) |
| POST | `/rooms/roomnotifications` | JWT | Send room notifications |

### Key Details

**GET /rooms/** — Query: `page, limit, category, type`  
Response: `{ rooms: [], total, pages }`

**POST /rooms/**  
Body: `{ userId, title, description, category, date, repeat, repeat_count, roomType, ... }`  
Response: `{ room: {}, ids: [] }`

**GET /rooms/analytics/:roomId**  
Response: `{ itemsSold, giveaways, shipments, totalSales, tipsReceived, viewers, newFollowers }`

**POST /rooms/roomnotifications**  
Body: `{ roomId, title, message, userIds }`  
Response: `{ success }`

---

## 9. Transactions — `/transactions`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/transactions/` | JWT | Create transaction |
| GET | `/transactions/` | JWT | Get all transactions (filtered) |
| GET | `/transactions/:userId` | JWT | Get transactions for user (last 20) |
| GET | `/transactions/transactions/:transId` | JWT | Get transaction by ID |
| PUT | `/transactions/:transId` | JWT | Update transaction |

### Key Details

**GET /transactions/** — Query: `userId, page, limit, status, username, usertype`  
Response: `{ data: [], totalPages, currentPage, totalDocuments }`

**POST /transactions/**  
Body: `{ from, to, amount, reason, type, status, ... }`  
Response: Created transaction

---

## 10. Activities — `/activities`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/activities/` | JWT | Get latest 20 activities |
| GET | `/activities/to/:uid/:pagenumber` | JWT | Get user activities (paginated) |
| GET | `/activities/:id` | JWT | Get activity by ID |
| POST | `/activities/` | JWT | Create activity |
| PATCH | `/activities/:id` | JWT | Update activity |
| DELETE | `/activities/:id` | JWT | Delete activity |
| DELETE | `/activities/` | JWT | Delete all activities for user |

### Key Details

**GET /activities/to/:uid/:pagenumber**  
Response: `{ metadata: { total, page }, data: [] }`

**DELETE /activities/**  
Body: `{ userId }`  
Response: `{ success }`

---

## 11. Notifications — `/notifications`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/notifications/` | JWT | Send push notifications to users |
| GET | `/notifications/settings/:id` | JWT | Get notification settings |
| PUT | `/notifications/settings/:id` | JWT | Update notification settings |

### Key Details

**POST /notifications/**  
Body: `{ ids: [], title, message, screen, id, sender, senderName, senderphoto }`  
Response: `{ success: true }`

---

## 12. Giveaways — `/giveaways`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/giveaways/` | Public | Get giveaways (filtered) |
| POST | `/giveaways/` | JWT | Create giveaway |
| GET | `/giveaways/:id` | JWT | Get giveaway by ID |
| PUT | `/giveaways/:id` | JWT | Update giveaway |
| DELETE | `/giveaways/:id` | JWT | Delete giveaway |
| PUT | `/giveaways/bulkedit/all` | JWT | Bulk update giveaways |
| POST | `/giveaways/:id/bookmark` | JWT | Bookmark giveaway |
| POST | `/giveaways/:id/join` | JWT | Join giveaway |

### Key Details

**GET /giveaways/** — Query: `page, limit, room, status, type`  
Response: `{ giveaways: [], totalDocuments, totalPages }`

**POST /giveaways/**  
Body: `{ name, quantity, category, tokshow, user, status, type, ... }`  
Response: `{ data: [], success: true }` — creates one entry per quantity unit

**POST /giveaways/:id/join**  
Body: `{ userId }`  
Response: Updated giveaway

---

## 13. Shipping — `/shipping`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shipping/` | JWT | Get all shipping options |
| POST | `/shipping/` | JWT | Add shipping option |
| PUT | `/shipping/:id` | JWT | Update user shipping settings |
| GET | `/shipping/user/:id` | JWT | Get user's shipping settings |
| DELETE | `/shipping/:id` | JWT | Delete shipping option |
| PUT | `/shipping/admin/:id` | JWT | Update shipping (admin) |
| GET | `/shipping/admin/:id` | JWT | Get shipping by ID (admin) |
| POST | `/shipping/profiles/:id` | JWT | Create shipping profile for user |
| POST | `/shipping/general/profiles` | JWT | Create general shipping profile |
| GET | `/shipping/general/profiles` | JWT | Get general shipping profiles |
| GET | `/shipping/profiles/:id` | JWT | Get shipping profile by ID |
| GET | `/shipping/profiles/user/:id` | JWT | Get user's shipping profiles |
| PUT | `/shipping/profiles/:id` | JWT | Update shipping profile |
| DELETE | `/shipping/profiles/:id` | JWT | Delete shipping profile |
| GET | `/shipping/profiles/estimate/rates` | JWT | Get estimated shipping rates |
| POST | `/shipping/profiles/buy/label` | JWT | Purchase shipping label |
| POST | `/shipping/generate/manifest` | JWT | Generate USPS scan form manifest |
| GET | `/shipping/generate/manifest` | JWT | Get manifest |
| POST | `/shipping/refund/label/shippo` | JWT | Refund shipping label |

### Key Details

**GET /shipping/profiles/estimate/rates** — Query: `weight, origin, destination`  
Response: `{ rates: [] }`

**POST /shipping/profiles/buy/label**  
Body: `{ orderId, rateId }`  
Response: Label details with tracking number

**POST /shipping/refund/label/shippo**  
Body: `{ shipment_id, seller, tokshow }`  
Response: Refund confirmation

---

## 14. Stripe — `/stripe`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/stripe/payouts/:userId` | JWT | Process payout |
| POST | `/stripe/connect/:id` | JWT | Connect Stripe account (OAuth) |
| GET | `/stripe/transactions/:userId` | JWT | Get payout transactions |
| GET | `/stripe/transactions/all/payouts` | JWT | All payouts (admin) |
| GET | `/stripe/banks/:userId` | JWT | Get bank accounts |
| POST | `/stripe/setupitent` | JWT | Create setup intent |
| POST | `/stripe/savepaymentmethod` | JWT | Save payment method |
| PUT | `/stripe/default` | JWT | Set default payment method |
| DELETE | `/stripe/remove` | JWT | Remove payment method |
| GET | `/stripe/application/fees` | JWT | Get application fees |
| GET | `/stripe/refunds/list/all` | JWT | All refunds (paginated) |
| GET | `/stripe/default/paymentmethod/default/:id` | JWT | Get default payment method |
| POST | `/stripe/tax/estimate` | JWT | Estimate tax |
| GET | `/stripe/revenue` | JWT | Platform revenue (admin) |
| POST | `/stripe/transfer` | JWT | Create transfer |

### Key Details

**POST /stripe/connect/:id**  
Body: `{ code }` (Stripe OAuth code)  
Response: `{ success, account }`

**POST /stripe/setupitent**  
Body: `{ userId }`  
Response: `{ clientSecret }`

**POST /stripe/tax/estimate**  
Body: `{ amount, address }`  
Response: `{ tax: number }`

**GET /stripe/revenue** — Query: `from, to, page, limit`  
Response: `{ available, pending, transactions: [], serviceFees }`

---

## 15. Admin — `/admin`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/` | JWT | Get all admins |
| POST | `/admin/` | JWT | Create admin |
| POST | `/admin/register` | Public | Register first admin |
| POST | `/admin/login` | Public | Admin login |
| GET | `/admin/exists` | Public | Check if admin role exists |
| GET | `/admin/profile/:id` | JWT | Get admin by ID |
| PATCH | `/admin/:id` | JWT | Update admin |
| DELETE | `/admin/:id` | JWT | Delete admin |
| POST | `/admin/impersonate/user` | JWT | Impersonate user |

### Key Details

**POST /admin/login**  
Body: `{ email, password }`  
Response: `{ success, admin, token }`

**GET /admin/exists** — Query: `role` (default: "admin")  
Response: `{ success, exists, message }`

**POST /admin/impersonate/user**  
Body: `{ userId }`  
Response: `{ token, user }`

---

## 16. Offers — `/offers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/offers/` | JWT | List offers/products |
| POST | `/offers/` | JWT | Create offer |
| GET | `/offers/:id` | JWT | Get offer by ID |
| POST | `/offers/counter` | JWT | Send counter offer |
| POST | `/offers/accept` | JWT | Accept offer (creates order) |
| POST | `/offers/reject` | JWT | Reject offer |
| POST | `/offers/cancel` | JWT | Cancel offer |

### Key Details

**POST /offers/**  
Body: `{ product, buyer, seller, quantity, subtotal, offeredPrice, shippingFee, tax, ... }`  
Response: `{ message, offer, success }`

**POST /offers/accept**  
Body: `{ offerId, usertype }`  
Response: `{ message, offer, newOrder, success }`

**GET /offers/** — Query: `tokshowId, user, role, page, limit`  
Response: `{ message, pagination, products/offers }`

---

## 17. Articles — `/articles`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/articles/` | Public | Get all articles |
| POST | `/articles/` | JWT | Create article |
| GET | `/articles/published/articles/` | Public | Get published articles |
| GET | `/articles/published/articles/:slug` | Public | Get article by slug |
| GET | `/articles/:id` | Public | Get article by ID |
| PUT | `/articles/:id` | JWT | Update article |
| DELETE | `/articles/:id` | JWT | Delete article |

### Key Details

**GET /articles/** — Query: `category, published, sortBy, limit, page`  
Response: `{ success, data: [], total, page, limit }`

**POST /articles/**  
Body: `{ title, slug, excerpt, content, category, published, order }`  
Response: `{ success, data: {} }`

---

## 18. Page Content — `/content`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/content/:pageType` | Public | Get page content |
| PUT | `/content/:pageType` | JWT | Update page content |
| POST | `/content/:pageType/reset` | JWT | Reset page to defaults |

**pageType values:** `landing`, `faq`, `about`, `privacy`, `terms`, `contact`

**GET /content/:pageType**  
Response: `{ success: true, data: {} }`

---

## 19. App Settings — `/settings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings/` | JWT | Get app settings |
| POST | `/settings/` | JWT | Save app settings |
| GET | `/settings/keys` | JWT | Get Firebase keys |

**GET /settings/keys**  
Response: `{ firebase_api_key, firebase_auth_domain, firebase_project_id }`

---

## 20. Theme & Translations — `/themes`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/themes/` | Public | Get theme settings |
| POST | `/themes/` | Public | Update theme settings |
| POST | `/themes/upload-logo` | Public | Upload app logo |
| POST | `/themes/upload-resource` | Public | Upload resource image |
| GET | `/themes/translations` | Public | Get translations |
| POST | `/themes/translations` | Public | Sync translations |

### Key Details

**POST /themes/upload-logo** — Multipart form (field: `logo`)  
Response: `{ success, logoUrl }`

**POST /themes/upload-resource** — Multipart form (field: `resource`) + Body: `{ key }`  
Response: `{ success, resourceUrl }`

**POST /themes/translations**  
Body: `{ translations: {} }`  
Response: `{ success }`

---

## 21. Email Templates — `/templates`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/templates/` | Public | Get all email templates |
| POST | `/templates/` | Public | Create or update template |
| GET | `/templates/:id` | Public | Get template by ID |
| PUT | `/templates/:id` | Public | Update template |
| DELETE | `/templates/:id` | Public | Delete template |

**POST /templates/**  
Body: `{ slug, name, subject, html, text }`  
Response: Created/updated template

---

## 22. Recordings — `/recording`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/recording/user/:userId` | JWT | Get recordings by user |
| GET | `/recording/room/:roomId` | JWT | Get recordings for room |
| GET | `/recording/id/:recordingId` | JWT | Get recording by ID |
| DELETE | `/recording/:recordingId` | JWT | Delete recording |

### Key Details

**GET /recording/user/:userId** — Query: `title, page, limit`  
Response: `{ recordings: [], totalDoc, limits, pages }`

---

## 23. LiveKit — `/livekit`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/livekit/token/dynamic` | JWT | Get room token |
| PUT | `/livekit/upload` | Bearer (upload auth) | Upload recording file |
| POST | `/livekit/start/record` | JWT | Start recording |
| POST | `/livekit/stop/record` | JWT | Stop recording |
| GET | `/livekit/test-ffmpeg` | Public | Test FFmpeg availability |
| POST | `/livekit/webhook` | Webhook signature | LiveKit event webhook |

### Key Details

**POST /livekit/token/dynamic**  
Body: `{ room, userId, uuid }`  
Response: `{ url, token, piptoken, canPublish, sessionId, publishingSession }`

**POST /livekit/start/record**  
Body: `{ room }`  
Response: `{ room, egressId, file, startedAt }`

**POST /livekit/stop/record**  
Body: `{ egressId }`  
Response: `{ egressId, stopped, stoppedAt }`

---

## 24. PayPal — `/paypal`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/paypal/connect` | Public | Initialize PayPal connection |
| POST | `/paypal/confirm` | Public | Confirm PayPal connection |

**POST /paypal/connect**  
Response: `{ setupToken, approvalUrl }`

**POST /paypal/confirm**  
Body: `{ setupToken }`  
Response: `{ paymentToken, customerId, status }`

---

## 25. Webhooks — `/webhook`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhook/stripe` | Stripe signature | Stripe event webhook |
| POST | `/webhook/stripe/platform` | Stripe signature | Stripe platform webhook |

Both endpoints verify the Stripe webhook signature and respond with `{ received: true }`.

---

## 26. Integrations — `/api`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/wc/orders` | JWT | Adjust product qty from WooCommerce order |
| POST | `/api/wc/keys` | JWT | Import WooCommerce API keys |
| POST | `/api/wc/products/:id` | JWT | Import WooCommerce products |
| POST | `/api/wc/app/import` | JWT | Fetch & save WooCommerce products |
| POST | `/api/shopify/import` | JWT | Import Shopify products |
| POST | `/api/shopify/auth` | JWT | Shopify authentication |
| GET | `/api/setup-required` | JWT | Check if setup is needed |
| POST | `/api/setup` | JWT | Setup integration |
| GET | `/api/settings` | JWT | Get meta settings |
| PUT | `/api/settings` | JWT | Remove meta settings |
| PUT | `/api/settings/update` | JWT | Update meta settings |

### Key Details

**POST /api/wc/keys**  
Body: `{ id, consumer_key, consumer_secret, site_url, auto_sync_orders, site_name, auto_sync_products }`  
Response: `{ success, message, user_id }`

**POST /api/wc/app/import**  
Body: `{ userId, consumer_key, consumer_secret, site_url }`  
Response: `{ imported: number }`

**PUT /api/settings/update** — Query: `user, key, auto_sync_products, auto_sync_orders`  
Body: `{ consumer_key, consumer_secret, site_url, site_name }`  
Response: Updated settings object

---

## Authentication Summary

All protected endpoints require:
```
Authorization: Bearer <jwt_token>
```

Tokens are obtained from:
- `POST /auth/login` → `token`
- `POST /admin/login` → `token`
- `POST /auth/signup` → `token`
